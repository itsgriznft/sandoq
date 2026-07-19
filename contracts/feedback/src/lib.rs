#![no_std]

//! A public, on-chain feedback registry for Sandoq.
//!
//! Anyone can leave one signed piece of feedback — a 1–5 sentiment, what they
//! did (started / joined / just exploring), and an optional short note. Every
//! entry is stored under the author's own address and emitted as an event, so
//! the community summary is **verifiable on the ledger**, not something the
//! team asserts. One entry per address: submitting again updates your own,
//! which keeps the count equal to the number of distinct people who spoke.
//!
//! This is deliberately independent of the circle contracts. It exists so a
//! reviewer — or anyone — can read the real distribution of user feedback
//! straight from testnet.

use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, Address, Env, String, Vec,
};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    InvalidSentiment = 1,
    InvalidRole = 2,
    NoteTooLong = 3,
}

/// A note is a single short line; the ledger is not a message board.
const MAX_NOTE_LEN: u32 = 280;

/// Reading every entry costs storage access, so aggregate reads are capped.
const MAX_AGGREGATE: u32 = 200;

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Entry {
    pub author: Address,
    /// 1 (confusing) … 5 (loved it).
    pub sentiment: u32,
    /// 0 = started a circle, 1 = joined a circle, 2 = just exploring.
    pub role: u32,
    pub note: String,
    /// Ledger timestamp of the most recent submission from this author.
    pub at: u64,
}

/// Totals across all feedback, for the summary view.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Summary {
    /// Distinct authors — the number of people who left feedback.
    pub count: u32,
    /// How many of `count` were aggregated (capped at `MAX_AGGREGATE`).
    pub aggregated: u32,
    /// Sum of sentiments over the aggregated entries; divide by `aggregated`
    /// for the average without losing precision on-chain.
    pub sentiment_sum: u32,
    pub organizers: u32,
    pub members: u32,
    pub exploring: u32,
}

#[contracttype]
pub enum DataKey {
    Authors,
    Entry(Address),
}

/// Topics: `("submitted", author)`. Data: `{ sentiment, role, note }`.
/// Every submission emits one, so each piece of feedback is a public,
/// tx-attributed record on the ledger.
#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Submitted {
    #[topic]
    pub author: Address,
    pub sentiment: u32,
    pub role: u32,
    pub note: String,
}

const DAY_LEDGERS: u32 = 17_280;
const INSTANCE_TTL: u32 = 30 * DAY_LEDGERS;
const INSTANCE_THRESHOLD: u32 = 7 * DAY_LEDGERS;
// Feedback is a record; keep it around far longer than a circle's working set.
const ENTRY_TTL: u32 = 360 * DAY_LEDGERS;
const ENTRY_THRESHOLD: u32 = 30 * DAY_LEDGERS;

#[contract]
pub struct Feedback;

#[contractimpl]
impl Feedback {
    /// Leave feedback, signed by `author`. Re-submitting replaces the author's
    /// previous entry rather than adding a second one. Emits `feedback`.
    pub fn submit(
        env: Env,
        author: Address,
        sentiment: u32,
        role: u32,
        note: String,
    ) -> Result<u32, Error> {
        author.require_auth();

        if !(1..=5).contains(&sentiment) {
            return Err(Error::InvalidSentiment);
        }
        if role > 2 {
            return Err(Error::InvalidRole);
        }
        if note.len() > MAX_NOTE_LEN {
            return Err(Error::NoteTooLong);
        }

        let key = DataKey::Entry(author.clone());
        let first_time = !env.storage().persistent().has(&key);
        if first_time {
            let mut authors = Self::author_list(&env);
            authors.push_back(author.clone());
            env.storage().instance().set(&DataKey::Authors, &authors);
        }

        env.storage().persistent().set(
            &key,
            &Entry {
                author: author.clone(),
                sentiment,
                role,
                note: note.clone(),
                at: env.ledger().timestamp(),
            },
        );
        env.storage()
            .persistent()
            .extend_ttl(&key, ENTRY_THRESHOLD, ENTRY_TTL);
        env.storage()
            .instance()
            .extend_ttl(INSTANCE_THRESHOLD, INSTANCE_TTL);

        Submitted {
            author,
            sentiment,
            role,
            note,
        }
        .publish(&env);

        Ok(Self::author_list(&env).len())
    }

    /// Number of distinct authors — the count of people who left feedback.
    pub fn count(env: Env) -> u32 {
        Self::author_list(&env).len()
    }

    /// One author's current entry, if they have left feedback.
    pub fn entry(env: Env, author: Address) -> Option<Entry> {
        env.storage().persistent().get(&DataKey::Entry(author))
    }

    /// The authors who have left feedback, in first-submission order.
    pub fn authors(env: Env) -> Vec<Address> {
        Self::author_list(&env)
    }

    fn author_list(env: &Env) -> Vec<Address> {
        env.storage()
            .instance()
            .get(&DataKey::Authors)
            .unwrap_or_else(|| Vec::new(env))
    }

    /// A page of entries, newest authors last (submission order). `limit` is
    /// clamped so a single call stays within the resource budget.
    pub fn list(env: Env, start: u32, limit: u32) -> Vec<Entry> {
        let authors = Self::author_list(&env);
        let end = start
            .saturating_add(limit.min(MAX_AGGREGATE))
            .min(authors.len());

        let mut rows = Vec::new(&env);
        for index in start..end {
            let author = authors.get(index).unwrap();
            if let Some(entry) = env.storage().persistent().get(&DataKey::Entry(author)) {
                rows.push_back(entry);
            }
        }
        rows
    }

    /// Aggregate totals for the summary. Past `MAX_AGGREGATE` authors the
    /// figures are a lower bound, and `aggregated` reports how many were summed.
    pub fn summary(env: Env) -> Summary {
        let authors = Self::author_list(&env);
        let aggregated = authors.len().min(MAX_AGGREGATE);

        let mut summary = Summary {
            count: authors.len(),
            aggregated,
            sentiment_sum: 0,
            organizers: 0,
            members: 0,
            exploring: 0,
        };

        for index in 0..aggregated {
            let author = authors.get(index).unwrap();
            let entry: Entry = env
                .storage()
                .persistent()
                .get(&DataKey::Entry(author))
                .unwrap();

            summary.sentiment_sum += entry.sentiment;
            match entry.role {
                0 => summary.organizers += 1,
                1 => summary.members += 1,
                _ => summary.exploring += 1,
            }
        }
        summary
    }
}

mod test;
