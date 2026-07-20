#![no_std]

//! The sandoq registry: deploys and tracks savings circles.
//!
//! Three kinds of inter-contract communication happen here:
//!
//! 1. **Deployment** — `create` deploys a fresh instance of the circle wasm
//!    and calls its constructor, all in one transaction.
//! 2. **Cross-contract reads** — `listing` and `stats` call `state()` on every
//!    deployed circle and aggregate the results.
//! 3. **Nested token calls** — each circle, in turn, calls the token contract
//!    to escrow collateral and move contributions.
//!
//! Only the circle's *wasm hash* is stored here, so a circle the factory
//! deployed is an ordinary independent contract afterwards — the factory has
//! no reach into its funds.

use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, vec, xdr::ToXdr, Address,
    Bytes, BytesN, Env, String, Vec,
};

mod circle {
    // Generates `Client` and `State` from the built circle wasm. Run
    // `make circle` (or `stellar contract build --package circle`) first.
    soroban_sdk::contractimport!(file = "../../target/wasm32v1-none/release/circle.wasm");
}

pub use circle::Status;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    NameEmpty = 1,
    NameTooLong = 2,
    InvalidContribution = 3,
    InvalidPeriod = 4,
    InvalidSize = 5,
    InvalidCollateral = 6,
    InvalidDeadline = 7,
}

const MAX_NAME_LEN: u32 = 64;

/// The circle takes these bounds too; checking here as well fails a bad
/// `create` before paying for a deployment.
const MIN_MEMBERS: u32 = 2;
const MAX_MEMBERS: u32 = 24;

/// Reading every circle costs one cross-contract call each, so aggregate
/// reads are capped rather than growing without bound as the registry fills.
const MAX_AGGREGATE: u32 = 50;

#[contracttype]
#[derive(Clone)]
pub struct Config {
    pub admin: Address,
    pub token: Address,
    pub circle_wasm: BytesN<32>,
}

/// One row of the registry listing: where the circle lives, plus its state.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Row {
    pub address: Address,
    pub name: String,
    pub organizer: Address,
    pub contribution: i128,
    pub period: u64,
    pub size: u32,
    pub collateral: i128,
    pub fill_deadline: u64,
    pub private: bool,
    pub status: Status,
    pub members: u32,
    pub start: u64,
    pub round: u32,
}

/// Totals across the circles the factory has deployed.
///
/// Each circle costs one cross-contract call to read, so only the first
/// `MAX_AGGREGATE` are visited. `aggregated` says how many were actually
/// summed — when it is smaller than `circles`, the totals are a lower bound.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Stats {
    pub circles: u32,
    pub aggregated: u32,
    pub filling: u32,
    pub active: u32,
    pub complete: u32,
    pub members: u32,
    /// Contributions committed per full rotation, summed over aggregated
    /// circles: contribution × size × size.
    pub committed: i128,
}

#[contracttype]
pub enum DataKey {
    Config,
    Circles,
}

/// Topics: `("created", organizer, circle)`. Data: `{ name, contribution, size }`.
#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Created {
    #[topic]
    pub organizer: Address,
    #[topic]
    pub circle: Address,
    pub name: String,
    pub contribution: i128,
    pub size: u32,
}

/// Topics: `("wasm_set", admin)`. Data: `{ wasm }`.
#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct WasmSet {
    #[topic]
    pub admin: Address,
    pub wasm: BytesN<32>,
}

const DAY_LEDGERS: u32 = 17_280;
const INSTANCE_TTL: u32 = 30 * DAY_LEDGERS;
const INSTANCE_THRESHOLD: u32 = 7 * DAY_LEDGERS;

#[contract]
pub struct Factory;

#[contractimpl]
impl Factory {
    pub fn __constructor(env: Env, admin: Address, token: Address, circle_wasm: BytesN<32>) {
        env.storage().instance().set(
            &DataKey::Config,
            &Config {
                admin,
                token,
                circle_wasm,
            },
        );
        env.storage()
            .instance()
            .set(&DataKey::Circles, &Vec::<Address>::new(&env));
        env.storage()
            .instance()
            .extend_ttl(INSTANCE_THRESHOLD, INSTANCE_TTL);
    }

    /// Deploy a new circle contract and remember its address.
    ///
    /// The deployed address is derived from this contract plus a salt, so it
    /// is deterministic and cannot collide with another circle.
    #[allow(clippy::too_many_arguments)]
    pub fn create(
        env: Env,
        organizer: Address,
        name: String,
        contribution: i128,
        period: u64,
        size: u32,
        collateral: i128,
        fill_deadline: u64,
        private: bool,
    ) -> Result<Address, Error> {
        organizer.require_auth();
        Self::bump(&env);

        if name.len() == 0 {
            return Err(Error::NameEmpty);
        }
        if name.len() > MAX_NAME_LEN {
            return Err(Error::NameTooLong);
        }
        if contribution <= 0 {
            return Err(Error::InvalidContribution);
        }
        if period == 0 {
            return Err(Error::InvalidPeriod);
        }
        if !(MIN_MEMBERS..=MAX_MEMBERS).contains(&size) {
            return Err(Error::InvalidSize);
        }
        if collateral < 0 {
            return Err(Error::InvalidCollateral);
        }
        if fill_deadline <= env.ledger().timestamp() {
            return Err(Error::InvalidDeadline);
        }

        let config = Self::read_config(&env);
        let mut circles = Self::circle_list(&env);

        let address = env
            .deployer()
            .with_current_contract(Self::salt(&env, &organizer, circles.len()))
            .deploy_v2(
                config.circle_wasm.clone(),
                (
                    config.token.clone(),
                    organizer.clone(),
                    name.clone(),
                    contribution,
                    period,
                    size,
                    collateral,
                    fill_deadline,
                    private,
                ),
            );

        circles.push_back(address.clone());
        env.storage().instance().set(&DataKey::Circles, &circles);

        Created {
            organizer,
            circle: address.clone(),
            name,
            contribution,
            size,
        }
        .publish(&env);

        Ok(address)
    }

    /// Point future deployments at a new circle wasm. Existing circles keep
    /// running the code they were deployed with.
    pub fn set_circle_wasm(env: Env, wasm: BytesN<32>) {
        let mut config = Self::read_config(&env);
        config.admin.require_auth();

        config.circle_wasm = wasm.clone();
        env.storage().instance().set(&DataKey::Config, &config);

        WasmSet {
            admin: config.admin,
            wasm,
        }
        .publish(&env);
    }

    pub fn circles(env: Env) -> Vec<Address> {
        Self::circle_list(&env)
    }

    pub fn config(env: Env) -> Config {
        Self::read_config(&env)
    }

    /// The registry listing: one cross-contract `state()` call per circle.
    ///
    /// `start` and `limit` page through the circles; `limit` is clamped so a
    /// single call can never exceed the contract's resource budget.
    pub fn listing(env: Env, start: u32, limit: u32) -> Vec<Row> {
        let circles = Self::circle_list(&env);
        let end = (start.saturating_add(limit.min(MAX_AGGREGATE))).min(circles.len());

        let mut rows = vec![&env];
        for index in start..end {
            let address = circles.get(index).unwrap();
            let state = circle::Client::new(&env, &address).state();
            rows.push_back(Row {
                address,
                name: state.name,
                organizer: state.organizer,
                contribution: state.contribution,
                period: state.period,
                size: state.size,
                collateral: state.collateral,
                fill_deadline: state.fill_deadline,
                private: state.private,
                status: state.status,
                members: state.members,
                start: state.start,
                round: state.round,
            });
        }
        rows
    }

    /// Totals across the circles, aggregated by calling `state()` on each.
    ///
    /// See [`Stats`]: past `MAX_AGGREGATE` circles the totals are a lower
    /// bound, and `aggregated` reports how many were summed.
    pub fn stats(env: Env) -> Stats {
        let circles = Self::circle_list(&env);
        let aggregated = circles.len().min(MAX_AGGREGATE);

        let mut stats = Stats {
            circles: circles.len(),
            aggregated,
            filling: 0,
            active: 0,
            complete: 0,
            members: 0,
            committed: 0,
        };

        for index in 0..aggregated {
            let address = circles.get(index).unwrap();
            let state = circle::Client::new(&env, &address).state();

            match state.status {
                Status::Filling => stats.filling += 1,
                Status::Active => stats.active += 1,
                Status::Complete => stats.complete += 1,
            }
            stats.members += state.members;
            stats.committed += state.contribution * (state.size as i128) * (state.size as i128);
        }
        stats
    }

    /// Whether this factory deployed the given address.
    pub fn is_circle(env: Env, address: Address) -> bool {
        Self::circle_list(&env).contains(&address)
    }

    fn read_config(env: &Env) -> Config {
        env.storage().instance().get(&DataKey::Config).unwrap()
    }

    fn circle_list(env: &Env) -> Vec<Address> {
        env.storage()
            .instance()
            .get(&DataKey::Circles)
            .unwrap_or_else(|| Vec::new(env))
    }

    /// Salt from the organizer and the circle index, so two organizers — and
    /// one organizer twice — always land on different addresses.
    fn salt(env: &Env, organizer: &Address, index: u32) -> BytesN<32> {
        let mut seed = Bytes::new(env);
        seed.append(&organizer.clone().to_xdr(env));
        seed.extend_from_array(&index.to_be_bytes());
        env.crypto().sha256(&seed).into()
    }

    fn bump(env: &Env) {
        env.storage()
            .instance()
            .extend_ttl(INSTANCE_THRESHOLD, INSTANCE_TTL);
    }
}

mod test;
