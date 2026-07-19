import { nativeToScVal } from '@stellar/stellar-sdk';

import { FEEDBACK_ID } from '../config';
import { addressArg, invoke, simulate, type Signer, type TxProgress } from './rpc';

/**
 * User feedback, kept on-chain in the feedback registry contract.
 *
 * A submission is a signed transaction, so every response is a public,
 * timestamped, address-attributed record on Stellar testnet — the community
 * summary is verifiable on the ledger, not asserted by the team. Reads go
 * through simulation (no signature, no fee); a submission rides the same
 * simulate → sign → submit → confirm pipeline as every other write.
 */

export type Role = 'organizer' | 'member' | 'exploring';
export type Sentiment = 1 | 2 | 3 | 4 | 5;

const ROLE_TO_U32: Record<Role, number> = { organizer: 0, member: 1, exploring: 2 };
const U32_TO_ROLE: Role[] = ['organizer', 'member', 'exploring'];

export const SENTIMENT_LABELS: Record<Sentiment, string> = {
  1: 'Confusing',
  2: 'Rough',
  3: 'Okay',
  4: 'Good',
  5: 'Loved it',
};

export const ROLE_LABELS: Record<Role, string> = {
  organizer: 'Started a circle',
  member: 'Joined a circle',
  exploring: 'Just exploring',
};

/** One entry as returned by `Feedback::entry` / `list`. */
export interface FeedbackEntry {
  author: string;
  sentiment: Sentiment;
  role: Role;
  note: string;
  at: Date;
}

/** Totals as returned by `Feedback::summary`. */
export interface FeedbackSummary {
  count: number;
  aggregated: number;
  /** Sum of sentiments over the aggregated entries; divide by `aggregated`. */
  sentimentSum: number;
  organizers: number;
  members: number;
  exploring: number;
  /** Convenience: the mean sentiment, or null when there is nothing yet. */
  average: number | null;
}

/** The maximum note length the contract accepts. */
export const MAX_NOTE_LEN = 280;

function toEntry(raw: Record<string, unknown>): FeedbackEntry {
  return {
    author: String(raw.author),
    sentiment: Number(raw.sentiment) as Sentiment,
    role: U32_TO_ROLE[Number(raw.role)] ?? 'exploring',
    note: String(raw.note ?? ''),
    at: new Date(Number(raw.at) * 1000),
  };
}

export async function readFeedbackSummary(): Promise<FeedbackSummary> {
  const raw = (await simulate(FEEDBACK_ID, 'summary')) as Record<string, unknown>;
  const aggregated = Number(raw.aggregated);
  const sentimentSum = Number(raw.sentiment_sum);
  return {
    count: Number(raw.count),
    aggregated,
    sentimentSum,
    organizers: Number(raw.organizers),
    members: Number(raw.members),
    exploring: Number(raw.exploring),
    average: aggregated > 0 ? sentimentSum / aggregated : null,
  };
}

export async function readFeedbackList(start = 0, limit = 50): Promise<FeedbackEntry[]> {
  const rows = (await simulate(
    FEEDBACK_ID,
    'list',
    nativeToScVal(start, { type: 'u32' }),
    nativeToScVal(limit, { type: 'u32' }),
  )) as Record<string, unknown>[];
  return rows.map(toEntry);
}

/** The connected wallet's own entry, if they have left feedback before. */
export async function readMyFeedback(address: string): Promise<FeedbackEntry | null> {
  const raw = (await simulate(FEEDBACK_ID, 'entry', addressArg(address))) as
    | Record<string, unknown>
    | null;
  return raw ? toEntry(raw) : null;
}

/**
 * Submit feedback as a signed transaction. Returns the tx hash — a permanent,
 * public receipt of the response on testnet.
 */
export async function submitFeedback(
  author: string,
  sentiment: Sentiment,
  role: Role,
  note: string,
  sign: Signer,
  onStage: (progress: TxProgress) => void,
): Promise<string> {
  const { hash } = await invoke(
    author,
    FEEDBACK_ID,
    'submit',
    [
      addressArg(author),
      nativeToScVal(sentiment, { type: 'u32' }),
      nativeToScVal(ROLE_TO_U32[role], { type: 'u32' }),
      nativeToScVal(note, { type: 'string' }),
    ],
    sign,
    onStage,
  );
  return hash;
}
