import { nativeToScVal } from '@stellar/stellar-sdk';

import { FACTORY_ID } from '../config';
import { addressArg, invoke, simulate, type Signer, type TxProgress } from './rpc';

/** Circle lifecycle, as the contracts' `Status` enum (u32 on the wire). */
export type CircleStatus = 'filling' | 'active' | 'complete';

const STATUSES: CircleStatus[] = ['filling', 'active', 'complete'];
export const statusFrom = (raw: unknown): CircleStatus => STATUSES[Number(raw)] ?? 'filling';

/** One row of the registry, as returned by `Factory::listing`. */
export interface Row {
  address: string;
  name: string;
  organizer: string;
  contribution: bigint;
  period: bigint;
  size: number;
  collateral: bigint;
  fillDeadline: bigint;
  status: CircleStatus;
  members: number;
  start: bigint;
  round: number;
}

/**
 * Totals across the circles, as returned by `Factory::stats`.
 *
 * The contract caps how many circles it visits per call. When `aggregated`
 * is below `circles`, the totals cover only that many — a lower bound.
 */
export interface Stats {
  circles: number;
  aggregated: number;
  filling: number;
  active: number;
  complete: number;
  members: number;
  committed: bigint;
}

/** Every circle, as one cross-contract `state()` call per circle. */
export async function readListing(start = 0, limit = 50): Promise<Row[]> {
  const rows = (await simulate(
    FACTORY_ID,
    'listing',
    nativeToScVal(start, { type: 'u32' }),
    nativeToScVal(limit, { type: 'u32' }),
  )) as Record<string, unknown>[];

  return rows.map((row) => ({
    address: String(row.address),
    name: String(row.name),
    organizer: String(row.organizer),
    contribution: BigInt(row.contribution as bigint),
    period: BigInt(row.period as bigint),
    size: Number(row.size),
    collateral: BigInt(row.collateral as bigint),
    fillDeadline: BigInt(row.fill_deadline as bigint),
    status: statusFrom(row.status),
    members: Number(row.members),
    start: BigInt(row.start as bigint),
    round: Number(row.round),
  }));
}

export async function readStats(): Promise<Stats> {
  const raw = (await simulate(FACTORY_ID, 'stats')) as Record<string, unknown>;
  return {
    circles: Number(raw.circles),
    aggregated: Number(raw.aggregated),
    filling: Number(raw.filling),
    active: Number(raw.active),
    complete: Number(raw.complete),
    members: Number(raw.members),
    committed: BigInt(raw.committed as bigint),
  };
}

/**
 * Deploy a new circle contract through the factory.
 *
 * Returns the address of the circle the factory just created — the value the
 * `create` call itself returned, not a guess.
 */
export async function createCircle(
  organizer: string,
  name: string,
  contributionStroops: bigint,
  periodSeconds: bigint,
  size: number,
  collateralStroops: bigint,
  fillDeadlineSeconds: bigint,
  sign: Signer,
  onStage: (progress: TxProgress) => void,
): Promise<{ hash: string; address: string }> {
  const { hash, returnValue } = await invoke(
    organizer,
    FACTORY_ID,
    'create',
    [
      addressArg(organizer),
      nativeToScVal(name, { type: 'string' }),
      nativeToScVal(contributionStroops, { type: 'i128' }),
      nativeToScVal(periodSeconds, { type: 'u64' }),
      nativeToScVal(size, { type: 'u32' }),
      nativeToScVal(collateralStroops, { type: 'i128' }),
      nativeToScVal(fillDeadlineSeconds, { type: 'u64' }),
    ],
    sign,
    onStage,
  );

  return { hash, address: String(returnValue) };
}
