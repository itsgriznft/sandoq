import { describe, expect, it } from 'vitest';

import { ledgerOfCursor } from './circle';

/**
 * A cursor is `<toid>-<index>` and the ledger sits in the toid's high 32
 * bits. Getting this wrong makes the event feed page forever or stop early.
 */
describe('ledgerOfCursor', () => {
  it('extracts the ledger from the toid high bits', () => {
    const ledger = 1_234_567n;
    const toid = (ledger << 32n) | 42n;
    expect(ledgerOfCursor(`${toid}-0`)).toBe(1_234_567);
  });

  it('handles the bare-toid form without an index suffix', () => {
    const toid = 99n << 32n;
    expect(ledgerOfCursor(String(toid))).toBe(99);
  });

  it('returns 0 for garbage rather than throwing mid-poll', () => {
    expect(ledgerOfCursor('')).toBe(0);
    expect(ledgerOfCursor('not-a-cursor')).toBe(0);
  });
});
