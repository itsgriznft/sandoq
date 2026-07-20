import { nativeToScVal, rpc, scValToNative, xdr } from '@stellar/stellar-sdk';

import { NATIVE_SAC } from '../config';
import { statusFrom, type CircleStatus } from './factory';
import { addressArg, invoke, server, simulate, type Signer, type TxProgress } from './rpc';

/** A circle's full state, as returned by `Circle::state`. */
export interface CircleState {
  token: string;
  organizer: string;
  name: string;
  contribution: bigint;
  period: bigint;
  size: number;
  collateral: bigint;
  fillDeadline: bigint;
  private: boolean;
  status: CircleStatus;
  members: number;
  start: bigint;
  round: number;
  paidThisRound: number;
}

/** One member's standing, as returned by `Circle::member`. */
export interface MemberState {
  collateral: bigint;
  received: boolean;
  defaulted: boolean;
}

/** A seat on the detail page: the address plus everything known about it. */
export interface Seat {
  address: string;
  state: MemberState;
  paidThisRound: boolean;
}

export async function readCircleState(circle: string): Promise<CircleState> {
  const raw = (await simulate(circle, 'state')) as Record<string, unknown>;
  return {
    token: String(raw.token),
    organizer: String(raw.organizer),
    name: String(raw.name),
    contribution: BigInt(raw.contribution as bigint),
    period: BigInt(raw.period as bigint),
    size: Number(raw.size),
    collateral: BigInt(raw.collateral as bigint),
    fillDeadline: BigInt(raw.fill_deadline as bigint),
    private: Boolean(raw.private),
    status: statusFrom(raw.status),
    members: Number(raw.members),
    start: BigInt(raw.start as bigint),
    round: Number(raw.round),
    paidThisRound: Number(raw.paid_this_round),
  };
}

/** Join order — which is also the payout order. */
export async function readMembers(circle: string): Promise<string[]> {
  const raw = (await simulate(circle, 'members')) as unknown[];
  return raw.map(String);
}

/**
 * Every seat in one round trip's worth of parallel simulations: the member
 * list, then per member their standing and whether the current round is paid.
 */
export async function readSeats(circle: string, round: number): Promise<Seat[]> {
  const members = await readMembers(circle);
  return Promise.all(
    members.map(async (address) => {
      const [state, paid] = await Promise.all([
        simulate(circle, 'member', addressArg(address)) as Promise<Record<string, unknown> | null>,
        simulate(
          circle,
          'has_paid',
          nativeToScVal(round, { type: 'u32' }),
          addressArg(address),
        ) as Promise<boolean>,
      ]);
      return {
        address,
        state: {
          collateral: BigInt((state?.collateral ?? 0n) as bigint),
          received: Boolean(state?.received),
          defaulted: Boolean(state?.defaulted),
        },
        paidThisRound: Boolean(paid),
      };
    }),
  );
}

/** Native XLM balance of an account, in stroops, read through the token contract. */
export async function readBalance(address: string): Promise<bigint> {
  return BigInt((await simulate(NATIVE_SAC, 'balance', addressArg(address))) as bigint);
}

// ---------------------------------------------------------------- writes

export async function join(
  circle: string,
  member: string,
  sign: Signer,
  onStage: (progress: TxProgress) => void,
): Promise<string> {
  const { hash } = await invoke(member, circle, 'join', [addressArg(member)], sign, onStage);
  return hash;
}

export async function leave(
  circle: string,
  member: string,
  sign: Signer,
  onStage: (progress: TxProgress) => void,
): Promise<string> {
  const { hash } = await invoke(member, circle, 'leave', [addressArg(member)], sign, onStage);
  return hash;
}

/** Whether an address may join — always true on a public circle. */
export async function readCanJoin(circle: string, address: string): Promise<boolean> {
  return Boolean(await simulate(circle, 'can_join', addressArg(address)));
}

/** Organizer-only: invite addresses to a private circle. */
export async function allow(
  circle: string,
  organizer: string,
  members: string[],
  sign: Signer,
  onStage: (progress: TxProgress) => void,
): Promise<string> {
  const arg = xdr.ScVal.scvVec(members.map((m) => addressArg(m)));
  const { hash } = await invoke(organizer, circle, 'allow', [arg], sign, onStage);
  return hash;
}

export async function contribute(
  circle: string,
  member: string,
  sign: Signer,
  onStage: (progress: TxProgress) => void,
): Promise<string> {
  const { hash } = await invoke(member, circle, 'contribute', [addressArg(member)], sign, onStage);
  return hash;
}

/**
 * Close the round and pay the pot out. Deliberately callable by anyone — the
 * connected wallet only pays the fee, the pot goes to the round's recipient.
 */
export async function settle(
  circle: string,
  caller: string,
  sign: Signer,
  onStage: (progress: TxProgress) => void,
): Promise<string> {
  const { hash } = await invoke(caller, circle, 'settle', [], sign, onStage);
  return hash;
}

export async function reclaim(
  circle: string,
  member: string,
  sign: Signer,
  onStage: (progress: TxProgress) => void,
): Promise<string> {
  const { hash } = await invoke(member, circle, 'reclaim', [addressArg(member)], sign, onStage);
  return hash;
}

// ---------------------------------------------------------------- events

export type CircleEventType =
  | 'joined'
  | 'left'
  | 'started'
  | 'contributed'
  | 'slashed'
  | 'paid_out'
  | 'completed'
  | 'reclaimed';

/** Any event a circle emits, flattened for the activity feed. */
export interface CircleEvent {
  id: string;
  txHash: string;
  ledger: number;
  at: Date;
  circle: string;
  type: CircleEventType;
  /** The address in the event's topic, when it has one. */
  member?: string;
  amount?: bigint;
  round?: number;
}

const EVENT_TYPES: ReadonlySet<string> = new Set([
  'joined',
  'left',
  'started',
  'contributed',
  'slashed',
  'paid_out',
  'completed',
  'reclaimed',
]);

/** Roughly 24 hours at ~5s per ledger — what the activity feed backfills. */
const FEED_WINDOW_LEDGERS = 17_280;

/**
 * A single `getEvents` call scans about 10k ledgers before stopping and
 * handing back a cursor, so the feed window takes two pages. The cap is slack
 * for a client that fell behind, not a normal cost.
 */
const MAX_PAGES = 8;

/** The RPC accepts at most 5 event filters, each naming at most 5 contracts. */
const IDS_PER_FILTER = 5;
const MAX_FILTERS = 5;
export const MAX_WATCHED_CIRCLES = IDS_PER_FILTER * MAX_FILTERS;

/**
 * Every event across the given circles, newest first.
 *
 * Pass the `cursor` from the previous call to fetch only what happened since;
 * omit it to backfill the recent window. Either way this pages forward until
 * it catches up with the current ledger.
 *
 * The feed deliberately does not backfill the RPC's full retention window:
 * that is ~120k ledgers, a dozen round trips, and seconds of latency before
 * anything renders. Circle state comes from `state()`, which is always exact.
 */
export async function readCircleEvents(
  circles: string[],
  cursor?: string,
): Promise<{ events: CircleEvent[]; cursor: string; watched: number }> {
  if (circles.length === 0) return { events: [], cursor: cursor ?? '', watched: 0 };

  const watched = circles.slice(0, MAX_WATCHED_CIRCLES);
  const filters = eventFilters(watched);
  let next = cursor;
  let startLedger = next ? undefined : await feedStartLedger(filters);
  const collected: CircleEvent[] = [];

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const response = next
      ? await server.getEvents({ cursor: next, filters, limit: 200 })
      : await server.getEvents({ startLedger: startLedger!, filters, limit: 200 });

    collected.push(
      ...response.events
        .map(toCircleEvent)
        .filter((event): event is CircleEvent => event !== null),
    );

    if (!response.cursor) break;
    next = response.cursor;
    startLedger = undefined;

    // Caught up with the head of the chain; nothing more to page through.
    if (ledgerOfCursor(response.cursor) >= response.latestLedger) break;
  }

  return { events: collected, cursor: next ?? '', watched: watched.length };
}

/** Split the contract ids across as many filters as the RPC will accept. */
function eventFilters(circles: string[]): rpc.Api.EventFilter[] {
  const filters: rpc.Api.EventFilter[] = [];
  for (let index = 0; index < circles.length; index += IDS_PER_FILTER) {
    filters.push({ type: 'contract', contractIds: circles.slice(index, index + IDS_PER_FILTER) });
  }
  return filters;
}

function toCircleEvent(event: rpc.Api.EventResponse): CircleEvent | null {
  const type = topicSymbol(event.topic[0]);
  if (!type || !EVENT_TYPES.has(type)) return null;

  let data: Record<string, unknown> = {};
  try {
    const native = scValToNative(event.value);
    if (native && typeof native === 'object') data = native as Record<string, unknown>;
  } catch {
    // An event this client cannot decode still deserves a feed line.
  }

  const member = event.topic[1] ? topicAddress(event.topic[1]) : undefined;
  return {
    id: event.id,
    txHash: event.txHash,
    ledger: event.ledger,
    at: new Date(event.ledgerClosedAt),
    circle: String(event.contractId),
    type: type as CircleEventType,
    member,
    amount: data.amount !== undefined ? BigInt(data.amount as bigint) : undefined,
    round: data.round !== undefined ? Number(data.round) : undefined,
  };
}

function topicSymbol(topic: xdr.ScVal | undefined): string | undefined {
  if (!topic) return undefined;
  try {
    return String(scValToNative(topic));
  } catch {
    return undefined;
  }
}

function topicAddress(topic: xdr.ScVal): string | undefined {
  try {
    const value = String(scValToNative(topic));
    return value.startsWith('G') || value.startsWith('C') ? value : undefined;
  } catch {
    return undefined;
  }
}

/**
 * A cursor is `<toid>-<index>`, and the ledger sits in the toid's high 32
 * bits.
 *
 * Reading this wrong makes the feed page forever or stop early, so it is
 * exported for tests.
 */
export function ledgerOfCursor(cursor: string): number {
  try {
    return Number(BigInt(cursor.split('-')[0]) >> 32n);
  } catch {
    return 0;
  }
}

/**
 * Where the feed starts reading.
 *
 * The RPC rejects a `startLedger` older than its retention window, and only
 * reveals that window's bounds inside a `getEvents` response — so ask about
 * the current ledger first and read `oldestLedger` off the reply, then walk
 * back at most one feed window from the head.
 */
async function feedStartLedger(filters: rpc.Api.EventFilter[]): Promise<number> {
  const latest = await server.getLatestLedger();
  const probe = await server.getEvents({ startLedger: latest.sequence, filters, limit: 1 });
  return Math.max(probe.oldestLedger, latest.sequence - FEED_WINDOW_LEDGERS, 1);
}
