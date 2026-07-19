#![cfg(test)]

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Events, Ledger},
    vec, Address, Env, Event, IntoVal, String, Symbol,
};

struct Setup {
    env: Env,
    contract: FeedbackClient<'static>,
    alice: Address,
    bob: Address,
    carol: Address,
}

fn setup() -> Setup {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(1_700_000_000);

    let id = env.register(Feedback, ());
    Setup {
        contract: FeedbackClient::new(&env, &id),
        alice: Address::generate(&env),
        bob: Address::generate(&env),
        carol: Address::generate(&env),
        env,
    }
}

fn note(env: &Env, text: &str) -> String {
    String::from_str(env, text)
}

#[test]
fn submit_records_an_entry_and_counts_the_author() {
    let s = setup();

    assert_eq!(
        s.contract.submit(&s.alice, &4, &1, &note(&s.env, "smooth")),
        1
    );

    assert_eq!(s.contract.count(), 1);
    let entry = s.contract.entry(&s.alice).unwrap();
    assert_eq!(entry.author, s.alice);
    assert_eq!(entry.sentiment, 4);
    assert_eq!(entry.role, 1);
    assert_eq!(entry.note, note(&s.env, "smooth"));
    assert_eq!(entry.at, 1_700_000_000);
}

#[test]
fn counts_only_distinct_authors() {
    let s = setup();
    s.contract.submit(&s.alice, &5, &0, &note(&s.env, ""));
    s.contract.submit(&s.bob, &3, &1, &note(&s.env, ""));
    s.contract.submit(&s.carol, &4, &2, &note(&s.env, ""));

    assert_eq!(s.contract.count(), 3);
    assert_eq!(s.contract.authors().len(), 3);
}

#[test]
fn resubmitting_updates_in_place_without_inflating_the_count() {
    let s = setup();
    s.contract
        .submit(&s.alice, &2, &2, &note(&s.env, "confused"));

    s.env.ledger().set_timestamp(1_700_000_500);
    s.contract
        .submit(&s.alice, &5, &1, &note(&s.env, "got it now"));

    // Still one author, but the entry reflects the latest submission.
    assert_eq!(s.contract.count(), 1);
    let entry = s.contract.entry(&s.alice).unwrap();
    assert_eq!(entry.sentiment, 5);
    assert_eq!(entry.role, 1);
    assert_eq!(entry.note, note(&s.env, "got it now"));
    assert_eq!(entry.at, 1_700_000_500);
}

#[test]
fn submit_emits_the_event_the_frontend_indexes() {
    let s = setup();
    s.contract
        .submit(&s.alice, &5, &0, &note(&s.env, "love it"));

    let expected = Submitted {
        author: s.alice.clone(),
        sentiment: 5,
        role: 0,
        note: note(&s.env, "love it"),
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
            Symbol::new(&s.env, "submitted").into_val(&s.env),
            s.alice.clone().into_val(&s.env)
        ]
    );
}

#[test]
fn submit_rejects_a_sentiment_out_of_range() {
    let s = setup();
    assert_eq!(
        s.contract.try_submit(&s.alice, &0, &1, &note(&s.env, "")),
        Err(Ok(Error::InvalidSentiment))
    );
    assert_eq!(
        s.contract.try_submit(&s.alice, &6, &1, &note(&s.env, "")),
        Err(Ok(Error::InvalidSentiment))
    );
    assert_eq!(s.contract.count(), 0);
}

#[test]
fn submit_rejects_an_unknown_role() {
    let s = setup();
    assert_eq!(
        s.contract.try_submit(&s.alice, &3, &3, &note(&s.env, "")),
        Err(Ok(Error::InvalidRole))
    );
}

#[test]
fn submit_rejects_a_note_past_the_limit() {
    let s = setup();
    // 281 chars — one past MAX_NOTE_LEN.
    let long = String::from_str(&s.env, &"x".repeat(281));
    assert_eq!(
        s.contract.try_submit(&s.alice, &3, &1, &long),
        Err(Ok(Error::NoteTooLong))
    );

    // Exactly at the limit is accepted.
    let at_limit = String::from_str(&s.env, &"x".repeat(280));
    assert_eq!(s.contract.submit(&s.alice, &3, &1, &at_limit), 1);
}

#[test]
fn list_pages_through_entries() {
    let s = setup();
    s.contract.submit(&s.alice, &5, &0, &note(&s.env, "a"));
    s.contract.submit(&s.bob, &4, &1, &note(&s.env, "b"));
    s.contract.submit(&s.carol, &3, &2, &note(&s.env, "c"));

    assert_eq!(s.contract.list(&0, &2).len(), 2);
    assert_eq!(s.contract.list(&2, &2).len(), 1);
    assert_eq!(s.contract.list(&3, &2).len(), 0);

    let page = s.contract.list(&1, &1);
    assert_eq!(page.get(0).unwrap().note, note(&s.env, "b"));
}

#[test]
fn summary_aggregates_sentiment_and_roles() {
    let s = setup();
    s.contract.submit(&s.alice, &5, &0, &note(&s.env, "")); // organizer
    s.contract.submit(&s.bob, &3, &1, &note(&s.env, "")); // member
    s.contract.submit(&s.carol, &4, &1, &note(&s.env, "")); // member

    let summary = s.contract.summary();
    assert_eq!(summary.count, 3);
    assert_eq!(summary.aggregated, 3);
    assert_eq!(summary.sentiment_sum, 12); // avg 4.0
    assert_eq!(summary.organizers, 1);
    assert_eq!(summary.members, 2);
    assert_eq!(summary.exploring, 0);
}

#[test]
fn summary_of_an_empty_registry_is_zero() {
    let s = setup();
    let summary = s.contract.summary();
    assert_eq!(summary.count, 0);
    assert_eq!(summary.aggregated, 0);
    assert_eq!(summary.sentiment_sum, 0);
}
