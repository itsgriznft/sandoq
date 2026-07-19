import { beforeEach, describe, expect, it, vi } from 'vitest';

import { averageSentiment, feedbackHistory, hasBackend, submitFeedback } from './feedback';

// No jsdom; stub the browser globals the module touches. With no
// VITE_FEEDBACK_URL set in the test env, submissions are local-only.
beforeEach(() => {
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
    removeItem: (key: string) => store.delete(key),
  });
});

describe('submitFeedback', () => {
  it('stores locally and reports no backend when none is configured', async () => {
    expect(hasBackend).toBe(false);
    const sent = await submitFeedback({ sentiment: 4, role: 'member', message: 'nice' });
    expect(sent).toBe(false); // local-only, still a success for the user

    const history = feedbackHistory();
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ sentiment: 4, role: 'member', message: 'nice' });
  });

  it('keeps submissions newest-first', async () => {
    await submitFeedback({ sentiment: 2, role: 'exploring', message: 'first' });
    await submitFeedback({ sentiment: 5, role: 'organizer', message: 'second' });

    const history = feedbackHistory();
    expect(history.map((f) => f.message)).toEqual(['second', 'first']);
  });

  it('averages the sentiment across submissions', async () => {
    expect(averageSentiment()).toBeNull();
    await submitFeedback({ sentiment: 2, role: 'member', message: '' });
    await submitFeedback({ sentiment: 4, role: 'member', message: '' });
    expect(averageSentiment()).toBe(3);
  });

  it('carries the wallet address when one is given', async () => {
    await submitFeedback({ sentiment: 5, role: 'organizer', message: 'ok', address: 'GABC' });
    expect(feedbackHistory()[0].address).toBe('GABC');
  });
});
