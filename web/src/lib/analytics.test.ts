import { beforeEach, describe, expect, it, vi } from 'vitest';

import { clearHistory, history, summary, track } from './analytics';

// jsdom is not configured, so stub the two browser globals the module touches.
beforeEach(() => {
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
    removeItem: (key: string) => store.delete(key),
  });
  vi.stubGlobal('navigator', {}); // no sendBeacon → local-only path
  clearHistory();
});

describe('track', () => {
  it('records events newest-first in history', () => {
    track('page_view');
    track('wallet_connected');

    const events = history();
    expect(events.map((e) => e.name)).toEqual(['wallet_connected', 'page_view']);
  });

  it('keeps the props it was given', () => {
    track('contributed', { circle: 'CABC', round: 2 });
    expect(history()[0].props).toEqual({ circle: 'CABC', round: 2 });
  });

  it('counts events per name in the summary', () => {
    track('joined');
    track('joined');
    track('contributed');

    expect(summary()).toEqual({ joined: 2, contributed: 1 });
  });

  it('clears the stored stream', () => {
    track('page_view');
    clearHistory();
    expect(history()).toEqual([]);
    expect(summary()).toEqual({});
  });

  it('survives a throwing localStorage without bubbling', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {},
    });
    expect(() => track('error', { message: 'x' })).not.toThrow();
    expect(history()).toEqual([]);
  });
});
