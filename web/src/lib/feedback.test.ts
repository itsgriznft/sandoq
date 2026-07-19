import { describe, expect, it } from 'vitest';

import { ROLE_LABELS, SENTIMENT_LABELS, type Role, type Sentiment } from './feedback';

// The on-chain read/write paths need a live RPC, so they're exercised in the
// browser rather than here. These lock the client-side mappings that decode
// what the contract returns — getting them wrong mislabels every entry.

describe('feedback label maps', () => {
  it('labels all five sentiment levels', () => {
    const levels: Sentiment[] = [1, 2, 3, 4, 5];
    for (const level of levels) {
      expect(SENTIMENT_LABELS[level]).toBeTruthy();
    }
    expect(SENTIMENT_LABELS[1]).toBe('Confusing');
    expect(SENTIMENT_LABELS[5]).toBe('Loved it');
  });

  it('labels every role the contract encodes', () => {
    const roles: Role[] = ['organizer', 'member', 'exploring'];
    for (const role of roles) {
      expect(ROLE_LABELS[role]).toBeTruthy();
    }
  });
});
