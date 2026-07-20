#![cfg(test)]

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Events, Ledger},
    token, vec, Address, Env, Event, IntoVal, String, Symbol,
};

const DAY: u64 = 86_400;
const WEEK: u64 = 7 * DAY;

const CONTRIBUTION: i128 = 100;
const COLLATERAL: i128 = 100;
const SIZE: u32 = 3;

struct Setup {
    env: Env,
    contract: CircleClient<'static>,
    token: token::TokenClient<'static>,
    organizer: Address,
    alice: Address,
    bob: Address,
    carol: Address,
    dave: Address,
    fill_deadline: u64,
}

fn setup() -> Setup {
    setup_with(CONTRIBUTION, COLLATERAL)
}

fn setup_with(contribution: i128, collateral: i128) -> Setup {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(1_000_000);

    let sac = env.register_stellar_asset_contract_v2(Address::generate(&env));
    let token = token::TokenClient::new(&env, &sac.address());
    let mint = token::StellarAssetClient::new(&env, &sac.address());

    let organizer = Address::generate(&env);
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    let carol = Address::generate(&env);
    let dave = Address::generate(&env);
    for who in [&alice, &bob, &carol, &dave] {
        mint.mint(who, &10_000);
    }

    let fill_deadline = env.ledger().timestamp() + 7 * DAY;
    let id = env.register(
        Circle,
        (
            sac.address(),
            organizer.clone(),
            String::from_str(&env, "Family sandoq"),
            contribution,
            WEEK,
            SIZE,
            collateral,
            fill_deadline,
            false, // public
        ),
    );

    Setup {
        contract: CircleClient::new(&env, &id),
        env,
        token,
        organizer,
        alice,
        bob,
        carol,
        dave,
        fill_deadline,
    }
}

/// Join alice, bob and carol — fills the circle and starts round 0.
fn fill(s: &Setup) {
    s.contract.join(&s.alice);
    s.contract.join(&s.bob);
    s.contract.join(&s.carol);
}

/// The contract must always hold exactly the collateral it still owes plus the
/// contributions of the round it has not settled yet.
fn assert_money_invariant(s: &Setup) {
    let state = s.contract.state();
    let mut expected: i128 = 0;
    for member in s.contract.members().iter() {
        expected += s.contract.member(&member).unwrap().collateral;
        if s.contract.has_paid(&state.round, &member) {
            expected += state.contribution;
        }
    }
    assert_eq!(s.token.balance(&s.contract.address), expected);
}

// ---------------------------------------------------------------- lifecycle

#[test]
fn state_reports_the_terms_it_was_created_with() {
    let s = setup();
    let state = s.contract.state();

    assert_eq!(state.name, String::from_str(&s.env, "Family sandoq"));
    assert_eq!(state.organizer, s.organizer);
    assert_eq!(state.contribution, CONTRIBUTION);
    assert_eq!(state.period, WEEK);
    assert_eq!(state.size, SIZE);
    assert_eq!(state.collateral, COLLATERAL);
    assert_eq!(state.fill_deadline, s.fill_deadline);
    assert_eq!(state.status, Status::Filling);
    assert_eq!(state.members, 0);
    assert_eq!(state.start, 0);
    assert_eq!(state.round, 0);
}

#[test]
fn join_escrows_collateral_and_counts_members() {
    let s = setup();

    assert_eq!(s.contract.join(&s.alice), 1);
    assert_eq!(s.token.balance(&s.alice), 10_000 - COLLATERAL);
    assert_eq!(s.token.balance(&s.contract.address), COLLATERAL);

    let member = s.contract.member(&s.alice).unwrap();
    assert_eq!(member.collateral, COLLATERAL);
    assert!(!member.received);
    assert!(!member.defaulted);

    let state = s.contract.state();
    assert_eq!(state.members, 1);
    assert_eq!(state.status, Status::Filling);
}

#[test]
fn joining_the_last_seat_starts_the_circle() {
    let s = setup();
    fill(&s);

    let state = s.contract.state();
    assert_eq!(state.status, Status::Active);
    assert_eq!(state.start, s.env.ledger().timestamp());
    assert_eq!(state.round, 0);
    assert_eq!(state.members, SIZE);
}

#[test]
fn join_rejects_a_second_seat_for_the_same_member() {
    let s = setup();
    s.contract.join(&s.alice);
    assert_eq!(s.contract.try_join(&s.alice), Err(Ok(Error::AlreadyMember)));
}

#[test]
fn join_rejects_once_the_fill_deadline_passed() {
    let s = setup();
    s.env.ledger().set_timestamp(s.fill_deadline);
    assert_eq!(s.contract.try_join(&s.alice), Err(Ok(Error::FillExpired)));
}

#[test]
fn join_rejects_once_the_circle_started() {
    let s = setup();
    fill(&s);
    assert_eq!(s.contract.try_join(&s.dave), Err(Ok(Error::NotFilling)));
}

#[test]
fn leave_returns_the_collateral_while_filling() {
    let s = setup();
    s.contract.join(&s.alice);
    s.contract.join(&s.bob);

    assert_eq!(s.contract.leave(&s.alice), COLLATERAL);
    assert_eq!(s.token.balance(&s.alice), 10_000);
    assert_eq!(s.contract.state().members, 1);
    assert!(s.contract.member(&s.alice).is_none());

    // The seat is free again — alice can rejoin.
    assert_eq!(s.contract.join(&s.alice), 2);
}

#[test]
fn leave_rejects_non_members_and_running_circles() {
    let s = setup();
    s.contract.join(&s.alice);
    assert_eq!(s.contract.try_leave(&s.bob), Err(Ok(Error::NotMember)));

    fill_remaining(&s);
    assert_eq!(s.contract.try_leave(&s.alice), Err(Ok(Error::NotFilling)));
}

fn fill_remaining(s: &Setup) {
    s.contract.join(&s.bob);
    s.contract.join(&s.carol);
}

// ------------------------------------------------------------ contributing

#[test]
fn contribute_moves_the_money_and_marks_the_round_paid() {
    let s = setup();
    fill(&s);

    assert_eq!(s.contract.contribute(&s.alice), 1);
    assert_eq!(
        s.token.balance(&s.alice),
        10_000 - COLLATERAL - CONTRIBUTION
    );
    assert!(s.contract.has_paid(&0, &s.alice));
    assert!(!s.contract.has_paid(&0, &s.bob));
    assert_eq!(s.contract.state().paid_this_round, 1);
    assert_money_invariant(&s);
}

#[test]
fn contribute_emits_the_event_the_frontend_indexes() {
    let s = setup();
    fill(&s);
    s.contract.contribute(&s.alice);

    let expected = Contributed {
        member: s.alice.clone(),
        round: 0,
        amount: CONTRIBUTION,
    };
    assert_eq!(
        s.env.events().all().filter_by_contract(&s.contract.address),
        vec![
            &s.env,
            (
                s.contract.address.clone(),
                expected.topics(&s.env),
                expected.data(&s.env)
            )
        ]
    );

    // Pin the topics the frontend subscribes to; renaming them breaks the UI.
    assert_eq!(
        expected.topics(&s.env),
        vec![
            &s.env,
            Symbol::new(&s.env, "contributed").into_val(&s.env),
            s.alice.clone().into_val(&s.env)
        ]
    );
}

#[test]
fn contribute_rejects_paying_twice() {
    let s = setup();
    fill(&s);
    s.contract.contribute(&s.alice);
    assert_eq!(
        s.contract.try_contribute(&s.alice),
        Err(Ok(Error::AlreadyPaid))
    );
}

#[test]
fn contribute_rejects_outsiders_and_idle_circles() {
    let s = setup();
    assert_eq!(
        s.contract.try_contribute(&s.alice),
        Err(Ok(Error::NotActive))
    );

    fill(&s);
    assert_eq!(
        s.contract.try_contribute(&s.dave),
        Err(Ok(Error::NotMember))
    );
}

#[test]
fn contribute_rejects_after_the_round_window() {
    let s = setup();
    fill(&s);
    s.env
        .ledger()
        .set_timestamp(s.env.ledger().timestamp() + WEEK);
    assert_eq!(
        s.contract.try_contribute(&s.alice),
        Err(Ok(Error::RoundEnded))
    );
}

// ---------------------------------------------------------------- settling

#[test]
fn settle_pays_the_first_member_once_everyone_paid() {
    let s = setup();
    fill(&s);
    s.contract.contribute(&s.alice);
    s.contract.contribute(&s.bob);
    s.contract.contribute(&s.carol);

    // Everyone paid, so the round can settle early — no waiting on the clock.
    assert_eq!(s.contract.settle(), 3 * CONTRIBUTION);
    assert_eq!(
        s.token.balance(&s.alice),
        10_000 - COLLATERAL - CONTRIBUTION + 3 * CONTRIBUTION
    );
    assert!(s.contract.member(&s.alice).unwrap().received);

    let state = s.contract.state();
    assert_eq!(state.round, 1);
    assert_eq!(state.paid_this_round, 0);
    assert_eq!(state.status, Status::Active);
    assert_money_invariant(&s);
}

#[test]
fn settle_rejects_while_the_round_is_still_open() {
    let s = setup();
    fill(&s);
    s.contract.contribute(&s.alice);
    assert_eq!(s.contract.try_settle(), Err(Ok(Error::SettleTooEarly)));
}

#[test]
fn settle_rejects_idle_circles() {
    let s = setup();
    assert_eq!(s.contract.try_settle(), Err(Ok(Error::NotActive)));
}

#[test]
fn settle_covers_a_miss_from_collateral() {
    let s = setup();
    fill(&s);
    s.contract.contribute(&s.alice);
    s.contract.contribute(&s.carol);
    // bob pays nothing; his collateral covers him exactly once.

    s.env
        .ledger()
        .set_timestamp(s.env.ledger().timestamp() + WEEK);
    assert_eq!(s.contract.settle(), 3 * CONTRIBUTION);

    let bob = s.contract.member(&s.bob).unwrap();
    assert_eq!(bob.collateral, 0);
    // The slash covered the full contribution, so bob is not defaulted yet.
    assert!(!bob.defaulted);
    assert_money_invariant(&s);
}

#[test]
fn settle_marks_a_default_once_collateral_runs_dry() {
    let s = setup();
    fill(&s);

    // Round 0: bob misses, collateral covers it.
    s.contract.contribute(&s.alice);
    s.contract.contribute(&s.carol);
    let start = s.env.ledger().timestamp();
    s.env.ledger().set_timestamp(start + WEEK);
    s.contract.settle();

    // Round 1: bob misses again with nothing left — the pot shrinks.
    s.contract.contribute(&s.alice);
    s.contract.contribute(&s.carol);
    s.env.ledger().set_timestamp(start + 2 * WEEK);
    assert_eq!(s.contract.settle(), 2 * CONTRIBUTION);

    let bob = s.contract.member(&s.bob).unwrap();
    assert_eq!(bob.collateral, 0);
    assert!(bob.defaulted);
    // bob keeps his turn: round 1's (smaller) pot went to him.
    assert!(bob.received);
    assert_money_invariant(&s);
}

#[test]
fn a_defaulted_member_may_still_receive_and_contribute() {
    let s = setup_with(CONTRIBUTION, 0);
    fill(&s);

    // No collateral at all: any miss is an immediate default.
    s.contract.contribute(&s.alice);
    s.contract.contribute(&s.carol);
    let start = s.env.ledger().timestamp();
    s.env.ledger().set_timestamp(start + WEEK);
    assert_eq!(s.contract.settle(), 2 * CONTRIBUTION);
    assert!(s.contract.member(&s.bob).unwrap().defaulted);

    // bob shows up again in round 1 — cash still welcome.
    assert_eq!(s.contract.contribute(&s.bob), 1);
    assert!(s.contract.has_paid(&1, &s.bob));
}

// ------------------------------------------------------------ full circles

#[test]
fn a_full_circle_pays_everyone_once_and_returns_all_collateral() {
    let s = setup();
    fill(&s);
    let start = s.env.ledger().timestamp();

    for round in 0..SIZE as u64 {
        s.contract.contribute(&s.alice);
        s.contract.contribute(&s.bob);
        s.contract.contribute(&s.carol);
        s.env.ledger().set_timestamp(start + (round + 1) * WEEK);
        assert_eq!(s.contract.settle(), 3 * CONTRIBUTION);
        assert_money_invariant(&s);
    }

    let state = s.contract.state();
    assert_eq!(state.status, Status::Complete);
    assert_eq!(state.round, SIZE);
    for who in [&s.alice, &s.bob, &s.carol] {
        assert!(s.contract.member(who).unwrap().received);
    }

    for who in [&s.alice, &s.bob, &s.carol] {
        assert_eq!(s.contract.reclaim(who), COLLATERAL);
        // Everyone paid three and received three: only the collateral moved.
        assert_eq!(s.token.balance(who), 10_000);
    }
    assert_eq!(s.token.balance(&s.contract.address), 0);
}

#[test]
fn a_circle_with_a_deadbeat_stays_solvent_to_the_last_token() {
    let s = setup();
    fill(&s);
    let start = s.env.ledger().timestamp();

    // bob never pays a single round.
    for round in 0..SIZE as u64 {
        s.contract.contribute(&s.alice);
        s.contract.contribute(&s.carol);
        s.env.ledger().set_timestamp(start + (round + 1) * WEEK);
        s.contract.settle();
        assert_money_invariant(&s);
    }

    assert_eq!(s.contract.state().status, Status::Complete);

    // Rounds paid 300 (bob's collateral covered him once), then 200, 200.
    assert_eq!(s.token.balance(&s.alice), 10_000 - 100 - 300 + 300);
    assert_eq!(s.token.balance(&s.bob), 10_000 - 100 + 200);
    assert_eq!(s.token.balance(&s.carol), 10_000 - 100 - 300 + 200);

    assert_eq!(s.contract.reclaim(&s.alice), COLLATERAL);
    assert_eq!(s.contract.reclaim(&s.carol), COLLATERAL);
    assert_eq!(
        s.contract.try_reclaim(&s.bob),
        Err(Ok(Error::NothingToReclaim))
    );

    // Every token is accounted for: the circle ends empty.
    assert_eq!(s.token.balance(&s.contract.address), 0);
}

#[test]
fn reclaim_rejects_before_the_circle_completes() {
    let s = setup();
    fill(&s);
    assert_eq!(
        s.contract.try_reclaim(&s.alice),
        Err(Ok(Error::NotComplete))
    );
}

// ------------------------------------------------------------- constructor

#[test]
#[should_panic(expected = "Error(Contract, #5)")]
fn constructor_rejects_a_circle_of_one() {
    let env = Env::default();
    env.ledger().set_timestamp(1_000_000);
    let sac = env.register_stellar_asset_contract_v2(Address::generate(&env));
    env.register(
        Circle,
        (
            sac.address(),
            Address::generate(&env),
            String::from_str(&env, "Solo"),
            CONTRIBUTION,
            WEEK,
            1u32,
            COLLATERAL,
            env.ledger().timestamp() + DAY,
            false,
        ),
    );
}

#[test]
#[should_panic(expected = "Error(Contract, #3)")]
fn constructor_rejects_a_zero_contribution() {
    let env = Env::default();
    env.ledger().set_timestamp(1_000_000);
    let sac = env.register_stellar_asset_contract_v2(Address::generate(&env));
    env.register(
        Circle,
        (
            sac.address(),
            Address::generate(&env),
            String::from_str(&env, "Zero"),
            0i128,
            WEEK,
            SIZE,
            COLLATERAL,
            env.ledger().timestamp() + DAY,
            false,
        ),
    );
}

#[test]
#[should_panic(expected = "Error(Contract, #7)")]
fn constructor_rejects_a_fill_deadline_in_the_past() {
    let env = Env::default();
    env.ledger().set_timestamp(1_000_000);
    let sac = env.register_stellar_asset_contract_v2(Address::generate(&env));
    env.register(
        Circle,
        (
            sac.address(),
            Address::generate(&env),
            String::from_str(&env, "Late"),
            CONTRIBUTION,
            WEEK,
            SIZE,
            COLLATERAL,
            env.ledger().timestamp(),
            false,
        ),
    );
}

#[test]
#[should_panic(expected = "Error(Contract, #1)")]
fn constructor_rejects_an_empty_name() {
    let env = Env::default();
    env.ledger().set_timestamp(1_000_000);
    let sac = env.register_stellar_asset_contract_v2(Address::generate(&env));
    env.register(
        Circle,
        (
            sac.address(),
            Address::generate(&env),
            String::from_str(&env, ""),
            CONTRIBUTION,
            WEEK,
            SIZE,
            COLLATERAL,
            env.ledger().timestamp() + DAY,
            false,
        ),
    );
}

// ------------------------------------------------------------ private circles

/// A private circle of `SIZE` seats, organized by a fresh address, with the
/// same members funded as `setup`.
fn setup_private() -> Setup {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(1_000_000);

    let sac = env.register_stellar_asset_contract_v2(Address::generate(&env));
    let token = token::TokenClient::new(&env, &sac.address());
    let mint = token::StellarAssetClient::new(&env, &sac.address());

    let organizer = Address::generate(&env);
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    let carol = Address::generate(&env);
    let dave = Address::generate(&env);
    for who in [&organizer, &alice, &bob, &carol, &dave] {
        mint.mint(who, &10_000);
    }

    let fill_deadline = env.ledger().timestamp() + 7 * DAY;
    let id = env.register(
        Circle,
        (
            sac.address(),
            organizer.clone(),
            String::from_str(&env, "Family sandoq"),
            CONTRIBUTION,
            WEEK,
            SIZE,
            COLLATERAL,
            fill_deadline,
            true, // private
        ),
    );

    Setup {
        contract: CircleClient::new(&env, &id),
        env,
        token,
        organizer,
        alice,
        bob,
        carol,
        dave,
        fill_deadline,
    }
}

#[test]
fn private_circle_reports_itself_private() {
    let s = setup_private();
    assert!(s.contract.state().private);
    assert!(!setup().contract.state().private);
}

#[test]
fn private_circle_rejects_an_uninvited_joiner() {
    let s = setup_private();
    assert_eq!(s.contract.try_join(&s.alice), Err(Ok(Error::NotAllowed)));
    assert!(!s.contract.can_join(&s.alice));
}

#[test]
fn the_organizer_can_always_join_their_own_private_circle() {
    let s = setup_private();
    assert!(s.contract.can_join(&s.organizer));
    assert_eq!(s.contract.join(&s.organizer), 1);
}

#[test]
fn an_invited_address_can_join_a_private_circle() {
    let s = setup_private();
    s.contract
        .allow(&vec![&s.env, s.alice.clone(), s.bob.clone()]);

    assert!(s.contract.can_join(&s.alice));
    assert_eq!(s.contract.join(&s.alice), 1);
    assert_eq!(s.contract.join(&s.bob), 2);
    // Carol was never invited.
    assert_eq!(s.contract.try_join(&s.carol), Err(Ok(Error::NotAllowed)));
}

#[test]
fn allow_emits_an_event_per_invite() {
    let s = setup_private();
    s.contract.allow(&vec![&s.env, s.alice.clone()]);

    let expected = Allowed {
        member: s.alice.clone(),
    };
    assert_eq!(
        s.env.events().all().filter_by_contract(&s.contract.address),
        vec![
            &s.env,
            (
                s.contract.address.clone(),
                expected.topics(&s.env),
                expected.data(&s.env)
            )
        ]
    );
    assert_eq!(
        expected.topics(&s.env),
        vec![
            &s.env,
            Symbol::new(&s.env, "allowed").into_val(&s.env),
            s.alice.clone().into_val(&s.env)
        ]
    );
}

#[test]
fn a_public_circle_admits_anyone() {
    let s = setup();
    // No invite needed; can_join is always true and join succeeds.
    assert!(s.contract.can_join(&s.dave));
    assert_eq!(s.contract.join(&s.dave), 1);
}
