#![no_std]

//! One rotating savings circle (a ROSCA — sandoq, esusu, chit fund, tanda).
//!
//! A fixed group of members each stake collateral to join. Once the circle is
//! full it starts automatically: every round, every member owes one
//! contribution, and the whole pot goes to one member — rotating in join order
//! until everyone has been paid once.
//!
//! Missed contributions are covered from the absentee's collateral, so the
//! round's recipient is made whole first and trust comes last. A member whose
//! collateral can no longer cover a miss is marked defaulted; the shortfall
//! then reduces that round's pot — exactly the loss an informal circle would
//! socialise, except here it is bounded, visible, and rule-based.
//!
//! Nobody — not even the organizer — has custody: payouts are a permissionless
//! crank (`settle`) anyone can turn once a round is over, and leftover
//! collateral goes back to its owner when the circle completes.
//!
//! Circles are normally created by the factory, which deploys one instance of
//! this wasm per circle. Nothing here depends on the factory, so a circle can
//! also be deployed on its own.

use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, panic_with_error, token,
    Address, Env, String, Vec,
};

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
    NotFilling = 8,
    FillExpired = 9,
    AlreadyMember = 10,
    NotMember = 11,
    NotActive = 12,
    RoundEnded = 13,
    AlreadyPaid = 14,
    SettleTooEarly = 15,
    NotComplete = 16,
    NothingToReclaim = 17,
    NotAllowed = 18,
}

const MAX_NAME_LEN: u32 = 64;

/// Every member is one cross-contract token transfer per settle, so the group
/// size is capped to keep a settle inside the resource budget.
const MAX_MEMBERS: u32 = 24;
const MIN_MEMBERS: u32 = 2;

#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum Status {
    /// Waiting for members. Joining and leaving are both open.
    Filling = 0,
    /// Full and running rounds. One payout per period.
    Active = 1,
    /// Every round has been paid out. Collateral can be reclaimed.
    Complete = 2,
}

#[contracttype]
#[derive(Clone)]
pub struct Config {
    pub token: Address,
    pub organizer: Address,
    pub name: String,
    /// What every member owes, per round, in token units.
    pub contribution: i128,
    /// Round length in seconds.
    pub period: u64,
    /// Number of members — and therefore number of rounds.
    pub size: u32,
    /// Stake escrowed at join time; the buffer misses are covered from.
    pub collateral: i128,
    /// If the circle has not filled by then, everyone can walk away.
    pub fill_deadline: u64,
    /// When true, only the organizer and addresses they allow may join.
    pub private: bool,
}

/// A member's standing, kept per address.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MemberState {
    /// Collateral still held for this member.
    pub collateral: i128,
    /// Whether their payout round has already happened.
    pub received: bool,
    /// Set when a miss could not be fully covered from collateral. Purely a
    /// flag — a defaulted member may keep contributing and keeps their payout
    /// turn; the circle just stops trusting them for coverage.
    pub defaulted: bool,
}

/// Everything a caller — a frontend, or the factory — needs, in one read.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct State {
    pub token: Address,
    pub organizer: Address,
    pub name: String,
    pub contribution: i128,
    pub period: u64,
    pub size: u32,
    pub collateral: i128,
    pub fill_deadline: u64,
    /// Only the organizer and allowed addresses may join when true.
    pub private: bool,
    pub status: Status,
    /// Members joined so far (equals `size` once active).
    pub members: u32,
    /// When the circle started; 0 while filling.
    pub start: u64,
    /// Next round to settle, 0-based. Equals `size` once complete.
    pub round: u32,
    /// Contributions received for the current round.
    pub paid_this_round: u32,
}

#[contracttype]
pub enum DataKey {
    Config,
    Status,
    Members,
    Start,
    Round,
    PaidCount,
    Member(Address),
    Paid(u32, Address),
    Allowed(Address),
}

/// Topics: `("joined", member)`. Data: `{ members }`.
#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Joined {
    #[topic]
    pub member: Address,
    pub members: u32,
}

/// Topics: `("left", member)`. Data: `{ members }`.
#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Left {
    #[topic]
    pub member: Address,
    pub members: u32,
}

/// Topics: `("started",)`. Data: `{ start }`.
#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Started {
    pub start: u64,
}

/// Topics: `("allowed", member)`. Data: `{}`. The organizer invited an address.
#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Allowed {
    #[topic]
    pub member: Address,
}

/// Topics: `("contributed", member)`. Data: `{ round, amount }`.
#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Contributed {
    #[topic]
    pub member: Address,
    pub round: u32,
    pub amount: i128,
}

/// Topics: `("slashed", member)`. Data: `{ round, amount, remaining }`.
#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Slashed {
    #[topic]
    pub member: Address,
    pub round: u32,
    pub amount: i128,
    pub remaining: i128,
}

/// Topics: `("paid_out", recipient)`. Data: `{ round, amount }`.
#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PaidOut {
    #[topic]
    pub recipient: Address,
    pub round: u32,
    pub amount: i128,
}

/// Topics: `("completed",)`. Data: `{ rounds }`.
#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Completed {
    pub rounds: u32,
}

/// Topics: `("reclaimed", member)`. Data: `{ amount }`.
#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Reclaimed {
    #[topic]
    pub member: Address,
    pub amount: i128,
}

// Instance TTL: bump to ~30 days whenever it drops below ~7 days.
const DAY_LEDGERS: u32 = 17_280;
const INSTANCE_TTL: u32 = 30 * DAY_LEDGERS;
const INSTANCE_THRESHOLD: u32 = 7 * DAY_LEDGERS;

#[contract]
pub struct Circle;

#[contractimpl]
impl Circle {
    #[allow(clippy::too_many_arguments)]
    pub fn __constructor(
        env: Env,
        token: Address,
        organizer: Address,
        name: String,
        contribution: i128,
        period: u64,
        size: u32,
        collateral: i128,
        fill_deadline: u64,
        private: bool,
    ) {
        if name.len() == 0 {
            panic_with_error!(&env, Error::NameEmpty);
        }
        if name.len() > MAX_NAME_LEN {
            panic_with_error!(&env, Error::NameTooLong);
        }
        if contribution <= 0 {
            panic_with_error!(&env, Error::InvalidContribution);
        }
        if period == 0 {
            panic_with_error!(&env, Error::InvalidPeriod);
        }
        if !(MIN_MEMBERS..=MAX_MEMBERS).contains(&size) {
            panic_with_error!(&env, Error::InvalidSize);
        }
        if collateral < 0 {
            panic_with_error!(&env, Error::InvalidCollateral);
        }
        if fill_deadline <= env.ledger().timestamp() {
            panic_with_error!(&env, Error::InvalidDeadline);
        }

        let storage = env.storage().instance();
        storage.set(
            &DataKey::Config,
            &Config {
                token,
                organizer,
                name,
                contribution,
                period,
                size,
                collateral,
                fill_deadline,
                private,
            },
        );
        storage.set(&DataKey::Status, &Status::Filling);
        storage.set(&DataKey::Members, &Vec::<Address>::new(&env));
        storage.set(&DataKey::Start, &0u64);
        storage.set(&DataKey::Round, &0u32);
        storage.set(&DataKey::PaidCount, &0u32);
        storage.extend_ttl(INSTANCE_THRESHOLD, INSTANCE_TTL);
    }

    /// Stake the collateral and take a seat. Joining the last free seat starts
    /// the circle. Emits `joined`, and `started` when it fills.
    pub fn join(env: Env, member: Address) -> Result<u32, Error> {
        member.require_auth();
        Self::bump(&env);

        if Self::status(&env) != Status::Filling {
            return Err(Error::NotFilling);
        }
        let config = Self::config(&env);
        if env.ledger().timestamp() >= config.fill_deadline {
            return Err(Error::FillExpired);
        }
        // A private circle admits only the organizer and addresses they invited.
        if config.private && member != config.organizer && !Self::allowed(&env, &member) {
            return Err(Error::NotAllowed);
        }
        let mut members = Self::members_list(&env);
        if members.contains(&member) {
            return Err(Error::AlreadyMember);
        }

        if config.collateral > 0 {
            token::TokenClient::new(&env, &config.token).transfer(
                &member,
                &env.current_contract_address(),
                &config.collateral,
            );
        }

        members.push_back(member.clone());
        env.storage().instance().set(&DataKey::Members, &members);
        Self::set_member(
            &env,
            &member,
            &MemberState {
                collateral: config.collateral,
                received: false,
                defaulted: false,
            },
        );

        Joined {
            member,
            members: members.len(),
        }
        .publish(&env);

        if members.len() == config.size {
            let start = env.ledger().timestamp();
            env.storage()
                .instance()
                .set(&DataKey::Status, &Status::Active);
            env.storage().instance().set(&DataKey::Start, &start);
            Started { start }.publish(&env);
        }

        Ok(members.len())
    }

    /// Invite one or more addresses to a private circle. Organizer-only, and
    /// only while filling. A no-op on a public circle beyond recording intent.
    /// Emits `allowed` per address.
    pub fn allow(env: Env, members: Vec<Address>) -> Result<(), Error> {
        let config = Self::config(&env);
        config.organizer.require_auth();
        Self::bump(&env);

        if Self::status(&env) != Status::Filling {
            return Err(Error::NotFilling);
        }

        for member in members.iter() {
            let key = DataKey::Allowed(member.clone());
            env.storage().persistent().set(&key, &true);
            env.storage()
                .persistent()
                .extend_ttl(&key, INSTANCE_THRESHOLD, INSTANCE_TTL);
            Allowed { member }.publish(&env);
        }
        Ok(())
    }

    /// Whether `member` may join: always on a public circle, and on a private
    /// one only the organizer and invited addresses.
    pub fn can_join(env: Env, member: Address) -> bool {
        let config = Self::config(&env);
        !config.private || member == config.organizer || Self::allowed(&env, &member)
    }

    /// Walk away with the collateral — only while the circle is still filling,
    /// so seats are never abandoned mid-game. Emits `left`.
    pub fn leave(env: Env, member: Address) -> Result<i128, Error> {
        member.require_auth();
        Self::bump(&env);

        if Self::status(&env) != Status::Filling {
            return Err(Error::NotFilling);
        }
        let mut members = Self::members_list(&env);
        let Some(index) = members.first_index_of(&member) else {
            return Err(Error::NotMember);
        };

        let state = Self::member_state(&env, &member);
        members.remove(index);
        env.storage().instance().set(&DataKey::Members, &members);
        env.storage()
            .persistent()
            .remove(&DataKey::Member(member.clone()));

        if state.collateral > 0 {
            let config = Self::config(&env);
            token::TokenClient::new(&env, &config.token).transfer(
                &env.current_contract_address(),
                &member,
                &state.collateral,
            );
        }

        Left {
            member,
            members: members.len(),
        }
        .publish(&env);

        Ok(state.collateral)
    }

    /// Pay this round's contribution into the pot. Only the current round can
    /// be paid, and only inside its window. Emits `contributed`.
    pub fn contribute(env: Env, member: Address) -> Result<u32, Error> {
        member.require_auth();
        Self::bump(&env);

        if Self::status(&env) != Status::Active {
            return Err(Error::NotActive);
        }
        if !Self::members_list(&env).contains(&member) {
            return Err(Error::NotMember);
        }

        let config = Self::config(&env);
        let round: u32 = Self::get(&env, &DataKey::Round, 0u32);
        if env.ledger().timestamp() >= Self::round_end(&env, &config, round) {
            return Err(Error::RoundEnded);
        }
        let paid_key = DataKey::Paid(round, member.clone());
        if env.storage().persistent().get(&paid_key).unwrap_or(false) {
            return Err(Error::AlreadyPaid);
        }

        token::TokenClient::new(&env, &config.token).transfer(
            &member,
            &env.current_contract_address(),
            &config.contribution,
        );

        env.storage().persistent().set(&paid_key, &true);
        env.storage()
            .persistent()
            .extend_ttl(&paid_key, INSTANCE_THRESHOLD, INSTANCE_TTL);
        let paid: u32 = Self::get(&env, &DataKey::PaidCount, 0u32) + 1;
        env.storage().instance().set(&DataKey::PaidCount, &paid);

        Contributed {
            member,
            round,
            amount: config.contribution,
        }
        .publish(&env);

        Ok(paid)
    }

    /// Close the current round and pay the pot out — a permissionless crank.
    ///
    /// Callable by anyone once every member has paid, or once the round's
    /// window has ended. Every miss is covered from the absentee's collateral;
    /// what cannot be covered is marked as a default and simply shrinks the
    /// pot. Emits `slashed` per miss, `paid_out`, and `completed` after the
    /// last round.
    pub fn settle(env: Env) -> Result<i128, Error> {
        Self::bump(&env);

        if Self::status(&env) != Status::Active {
            return Err(Error::NotActive);
        }
        let config = Self::config(&env);
        let round: u32 = Self::get(&env, &DataKey::Round, 0u32);
        let members = Self::members_list(&env);
        let paid: u32 = Self::get(&env, &DataKey::PaidCount, 0u32);

        let window_over = env.ledger().timestamp() >= Self::round_end(&env, &config, round);
        if !window_over && paid < config.size {
            return Err(Error::SettleTooEarly);
        }

        // Pot = everyone who paid, plus whatever collateral covers of the rest.
        let mut pot: i128 = 0;
        for member in members.iter() {
            let paid_key = DataKey::Paid(round, member.clone());
            if env.storage().persistent().get(&paid_key).unwrap_or(false) {
                pot += config.contribution;
                continue;
            }

            let mut state = Self::member_state(&env, &member);
            let slash = state.collateral.min(config.contribution);
            if slash > 0 {
                state.collateral -= slash;
                pot += slash;
            }
            if slash < config.contribution {
                state.defaulted = true;
            }
            Self::set_member(&env, &member, &state);

            Slashed {
                member,
                round,
                amount: slash,
                remaining: state.collateral,
            }
            .publish(&env);
        }

        // Rotation order is join order; the recipient keeps their turn even if
        // they defaulted — their misses were already taken out of the pot.
        let recipient = members.get(round).unwrap();
        let mut recipient_state = Self::member_state(&env, &recipient);
        recipient_state.received = true;
        Self::set_member(&env, &recipient, &recipient_state);

        if pot > 0 {
            token::TokenClient::new(&env, &config.token).transfer(
                &env.current_contract_address(),
                &recipient,
                &pot,
            );
        }

        let next = round + 1;
        env.storage().instance().set(&DataKey::Round, &next);
        env.storage().instance().set(&DataKey::PaidCount, &0u32);

        PaidOut {
            recipient,
            round,
            amount: pot,
        }
        .publish(&env);

        if next == config.size {
            env.storage()
                .instance()
                .set(&DataKey::Status, &Status::Complete);
            Completed { rounds: next }.publish(&env);
        }

        Ok(pot)
    }

    /// Take back whatever collateral survived the circle. Emits `reclaimed`.
    pub fn reclaim(env: Env, member: Address) -> Result<i128, Error> {
        member.require_auth();
        Self::bump(&env);

        if Self::status(&env) != Status::Complete {
            return Err(Error::NotComplete);
        }
        if !Self::members_list(&env).contains(&member) {
            return Err(Error::NotMember);
        }
        let mut state = Self::member_state(&env, &member);
        if state.collateral <= 0 {
            return Err(Error::NothingToReclaim);
        }

        let amount = state.collateral;
        state.collateral = 0;
        Self::set_member(&env, &member, &state);

        let config = Self::config(&env);
        token::TokenClient::new(&env, &config.token).transfer(
            &env.current_contract_address(),
            &member,
            &amount,
        );

        Reclaimed { member, amount }.publish(&env);

        Ok(amount)
    }

    pub fn state(env: Env) -> State {
        let config = Self::config(&env);
        State {
            token: config.token,
            organizer: config.organizer,
            name: config.name,
            contribution: config.contribution,
            period: config.period,
            size: config.size,
            collateral: config.collateral,
            fill_deadline: config.fill_deadline,
            private: config.private,
            status: Self::status(&env),
            members: Self::members_list(&env).len(),
            start: Self::get(&env, &DataKey::Start, 0u64),
            round: Self::get(&env, &DataKey::Round, 0u32),
            paid_this_round: Self::get(&env, &DataKey::PaidCount, 0u32),
        }
    }

    pub fn members(env: Env) -> Vec<Address> {
        Self::members_list(&env)
    }

    pub fn member(env: Env, member: Address) -> Option<MemberState> {
        env.storage().persistent().get(&DataKey::Member(member))
    }

    pub fn has_paid(env: Env, round: u32, member: Address) -> bool {
        env.storage()
            .persistent()
            .get(&DataKey::Paid(round, member))
            .unwrap_or(false)
    }

    fn allowed(env: &Env, member: &Address) -> bool {
        env.storage()
            .persistent()
            .get(&DataKey::Allowed(member.clone()))
            .unwrap_or(false)
    }

    fn config(env: &Env) -> Config {
        env.storage().instance().get(&DataKey::Config).unwrap()
    }

    fn status(env: &Env) -> Status {
        Self::get(env, &DataKey::Status, Status::Filling)
    }

    fn members_list(env: &Env) -> Vec<Address> {
        env.storage()
            .instance()
            .get(&DataKey::Members)
            .unwrap_or_else(|| Vec::new(env))
    }

    fn member_state(env: &Env, member: &Address) -> MemberState {
        env.storage()
            .persistent()
            .get(&DataKey::Member(member.clone()))
            .unwrap()
    }

    fn set_member(env: &Env, member: &Address, state: &MemberState) {
        let key = DataKey::Member(member.clone());
        env.storage().persistent().set(&key, state);
        env.storage()
            .persistent()
            .extend_ttl(&key, INSTANCE_THRESHOLD, INSTANCE_TTL);
    }

    /// End of `round`'s contribution window.
    fn round_end(env: &Env, config: &Config, round: u32) -> u64 {
        let start: u64 = Self::get(env, &DataKey::Start, 0u64);
        start + (round as u64 + 1) * config.period
    }

    fn get<T>(env: &Env, key: &DataKey, default: T) -> T
    where
        T: soroban_sdk::TryFromVal<Env, soroban_sdk::Val>
            + soroban_sdk::IntoVal<Env, soroban_sdk::Val>,
    {
        env.storage().instance().get(key).unwrap_or(default)
    }

    fn bump(env: &Env) {
        env.storage()
            .instance()
            .extend_ttl(INSTANCE_THRESHOLD, INSTANCE_TTL);
    }
}

mod test;
