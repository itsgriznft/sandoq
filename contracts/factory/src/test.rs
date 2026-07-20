#![cfg(test)]

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token, Address, BytesN, Env, String,
};

const DAY: u64 = 86_400;
const WEEK: u64 = 7 * DAY;

/// Exactly `MAX_NAME_LEN` characters, and one past it.
const NAME_AT_LIMIT: &str = "0123456789012345678901234567890123456789012345678901234567890123";
const NAME_OVER_LIMIT: &str = "01234567890123456789012345678901234567890123456789012345678901234";

struct Setup {
    env: Env,
    factory: FactoryClient<'static>,
    token: token::TokenClient<'static>,
    admin: Address,
    alice: Address,
    bob: Address,
    fill_deadline: u64,
}

fn setup() -> Setup {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(1_000_000);

    let admin = Address::generate(&env);
    let sac = env.register_stellar_asset_contract_v2(admin.clone());

    // The factory can only deploy wasm the ledger already knows about.
    let wasm_hash = env.deployer().upload_contract_wasm(circle::WASM);
    let id = env.register(Factory, (admin.clone(), sac.address(), wasm_hash));

    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    let mint = token::StellarAssetClient::new(&env, &sac.address());
    mint.mint(&alice, &10_000);
    mint.mint(&bob, &10_000);

    Setup {
        factory: FactoryClient::new(&env, &id),
        token: token::TokenClient::new(&env, &sac.address()),
        fill_deadline: env.ledger().timestamp() + 7 * DAY,
        env,
        admin,
        alice,
        bob,
    }
}

fn name(env: &Env, text: &str) -> String {
    String::from_str(env, text)
}

/// `create` with sane defaults, varying only what a test cares about.
fn create(s: &Setup, organizer: &Address, label: &str, size: u32) -> Address {
    s.factory.create(
        organizer,
        &name(&s.env, label),
        &100,
        &WEEK,
        &size,
        &50,
        &s.fill_deadline,
        &false,
    )
}

#[test]
fn create_deploys_a_live_circle_contract() {
    let s = setup();

    let address = create(&s, &s.alice, "Family sandoq", 3);

    assert!(s.factory.is_circle(&address));
    assert_eq!(
        s.factory.circles(),
        soroban_sdk::vec![&s.env, address.clone()]
    );

    // The deployed contract is a real, independently callable circle.
    let state = circle::Client::new(&s.env, &address).state();
    assert_eq!(state.name, name(&s.env, "Family sandoq"));
    assert_eq!(state.organizer, s.alice);
    assert_eq!(state.contribution, 100);
    assert_eq!(state.size, 3);
    assert_eq!(state.status, Status::Filling);
    assert_eq!(state.members, 0);
}

#[test]
fn each_circle_gets_its_own_address_even_from_one_organizer() {
    let s = setup();

    let first = create(&s, &s.alice, "One", 3);
    let second = create(&s, &s.alice, "Two", 3);
    let third = create(&s, &s.bob, "Three", 3);

    assert_ne!(first, second);
    assert_ne!(second, third);
    assert_eq!(s.factory.circles().len(), 3);
}

/// The whole point of the factory: money flows through a circle it deployed —
/// join, contribute, settle, reclaim — while the factory holds nothing.
#[test]
fn a_factory_deployed_circle_runs_a_full_rotation() {
    let s = setup();
    let address = create(&s, &s.alice, "Two of us", 2);
    let c = circle::Client::new(&s.env, &address);

    c.join(&s.alice);
    c.join(&s.bob);
    assert_eq!(c.state().status, Status::Active);

    // Round 0 → alice; round 1 → bob. Everyone pays every round.
    for _ in 0..2 {
        c.contribute(&s.alice);
        c.contribute(&s.bob);
        c.settle();
    }
    assert_eq!(c.state().status, Status::Complete);

    c.reclaim(&s.alice);
    c.reclaim(&s.bob);

    // Paid two rounds, received one pot of two contributions each: all square.
    assert_eq!(s.token.balance(&s.alice), 10_000);
    assert_eq!(s.token.balance(&s.bob), 10_000);
    assert_eq!(s.token.balance(&address), 0);
    assert_eq!(s.token.balance(&s.factory.address), 0);
}

#[test]
fn create_validates_its_arguments() {
    let s = setup();

    let bad = |result: Result<Result<Address, _>, Result<Error, _>>, expected: Error| {
        assert_eq!(result, Err(Ok(expected)));
    };

    bad(
        s.factory.try_create(
            &s.alice,
            &name(&s.env, ""),
            &100,
            &WEEK,
            &3,
            &50,
            &s.fill_deadline,
            &false,
        ),
        Error::NameEmpty,
    );
    bad(
        s.factory.try_create(
            &s.alice,
            &name(&s.env, NAME_OVER_LIMIT),
            &100,
            &WEEK,
            &3,
            &50,
            &s.fill_deadline,
            &false,
        ),
        Error::NameTooLong,
    );
    bad(
        s.factory.try_create(
            &s.alice,
            &name(&s.env, "Zero pay"),
            &0,
            &WEEK,
            &3,
            &50,
            &s.fill_deadline,
            &false,
        ),
        Error::InvalidContribution,
    );
    bad(
        s.factory.try_create(
            &s.alice,
            &name(&s.env, "No clock"),
            &100,
            &0,
            &3,
            &50,
            &s.fill_deadline,
            &false,
        ),
        Error::InvalidPeriod,
    );
    bad(
        s.factory.try_create(
            &s.alice,
            &name(&s.env, "Solo"),
            &100,
            &WEEK,
            &1,
            &50,
            &s.fill_deadline,
            &false,
        ),
        Error::InvalidSize,
    );
    bad(
        s.factory.try_create(
            &s.alice,
            &name(&s.env, "Crowd"),
            &100,
            &WEEK,
            &25,
            &50,
            &s.fill_deadline,
            &false,
        ),
        Error::InvalidSize,
    );
    bad(
        s.factory.try_create(
            &s.alice,
            &name(&s.env, "Anti stake"),
            &100,
            &WEEK,
            &3,
            &-1,
            &s.fill_deadline,
            &false,
        ),
        Error::InvalidCollateral,
    );
    bad(
        s.factory.try_create(
            &s.alice,
            &name(&s.env, "Yesterday"),
            &100,
            &WEEK,
            &3,
            &50,
            &s.env.ledger().timestamp(),
            &false,
        ),
        Error::InvalidDeadline,
    );

    assert_eq!(s.factory.circles().len(), 0);
}

#[test]
fn create_accepts_a_name_at_the_length_limit() {
    let s = setup();
    let address = s.factory.create(
        &s.alice,
        &name(&s.env, NAME_AT_LIMIT),
        &100,
        &WEEK,
        &3,
        &50,
        &s.fill_deadline,
        &false,
    );
    assert!(s.factory.is_circle(&address));
}

#[test]
fn listing_reads_state_from_every_circle() {
    let s = setup();
    let first = create(&s, &s.alice, "First", 2);
    create(&s, &s.bob, "Second", 3);

    // Move the first circle along so the listing shows live state, not config.
    let c = circle::Client::new(&s.env, &first);
    c.join(&s.alice);
    c.join(&s.bob);

    let rows = s.factory.listing(&0, &10);
    assert_eq!(rows.len(), 2);

    let row = rows.get(0).unwrap();
    assert_eq!(row.address, first);
    assert_eq!(row.name, name(&s.env, "First"));
    assert_eq!(row.status, Status::Active);
    assert_eq!(row.members, 2);

    let row = rows.get(1).unwrap();
    assert_eq!(row.name, name(&s.env, "Second"));
    assert_eq!(row.status, Status::Filling);
    assert_eq!(row.members, 0);
}

#[test]
fn listing_pages_through_circles() {
    let s = setup();
    for label in ["A", "B", "C"] {
        create(&s, &s.alice, label, 3);
    }

    assert_eq!(s.factory.listing(&0, &2).len(), 2);
    assert_eq!(s.factory.listing(&2, &2).len(), 1);
    assert_eq!(s.factory.listing(&3, &2).len(), 0);

    let page = s.factory.listing(&1, &1);
    assert_eq!(page.get(0).unwrap().name, name(&s.env, "B"));
}

#[test]
fn stats_aggregate_across_circles() {
    let s = setup();
    let first = create(&s, &s.alice, "Running", 2);
    create(&s, &s.bob, "Waiting", 3);

    let c = circle::Client::new(&s.env, &first);
    c.join(&s.alice);
    c.join(&s.bob);

    let stats = s.factory.stats();
    assert_eq!(stats.circles, 2);
    assert_eq!(stats.aggregated, 2);
    assert_eq!(stats.filling, 1);
    assert_eq!(stats.active, 1);
    assert_eq!(stats.complete, 0);
    assert_eq!(stats.members, 2);
    // 100 × 2 × 2 for the running circle, 100 × 3 × 3 for the waiting one.
    assert_eq!(stats.committed, 400 + 900);
}

#[test]
fn stats_on_an_empty_factory_are_zero() {
    let s = setup();
    let stats = s.factory.stats();
    assert_eq!(stats.circles, 0);
    assert_eq!(stats.aggregated, 0);
    assert_eq!(stats.members, 0);
    assert_eq!(stats.committed, 0);
}

#[test]
fn is_circle_rejects_addresses_the_factory_did_not_deploy() {
    let s = setup();
    create(&s, &s.alice, "Ours", 3);
    assert!(!s.factory.is_circle(&s.factory.address));
    assert!(!s.factory.is_circle(&Address::generate(&s.env)));
}

#[test]
fn set_circle_wasm_redirects_future_deployments() {
    let s = setup();
    let garbage = BytesN::from_array(&s.env, &[7u8; 32]);

    s.factory.set_circle_wasm(&garbage);
    assert_eq!(s.factory.config().circle_wasm, garbage);

    // The next deployment now points at wasm the ledger has never seen, so it
    // fails — proof that `create` really uses the updated hash. Circles
    // deployed before the switch are untouched.
    assert!(s
        .factory
        .try_create(
            &s.alice,
            &name(&s.env, "After the switch"),
            &100,
            &WEEK,
            &3,
            &50,
            &s.fill_deadline,
            &false,
        )
        .is_err());
}

#[test]
fn create_can_deploy_a_private_circle() {
    let s = setup();
    let address = s.factory.create(
        &s.alice,
        &name(&s.env, "Invite only"),
        &100,
        &WEEK,
        &3,
        &50,
        &s.fill_deadline,
        &true, // private
    );

    let c = circle::Client::new(&s.env, &address);
    assert!(c.state().private);
    // A stranger cannot join; the organizer can.
    assert!(!c.can_join(&s.bob));
    assert!(c.can_join(&s.alice));
}
