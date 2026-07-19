import { useCallback, useEffect, useRef, useState } from 'react';

import { readCircleEvents, type CircleEvent } from '../lib/circle';

const POLL_MS = 6_000;

/**
 * A live feed across many circles at once — the home page's pulse.
 *
 * Events are pulled forward from a cursor, so after the first backfill each
 * poll only transfers what is new. Errors are deliberately swallowed: the feed
 * is garnish, and the registry poll already reports network trouble.
 */
export function useCircleEventsFeed(circles: string[]): {
  events: CircleEvent[];
  loading: boolean;
} {
  const [events, setEvents] = useState<CircleEvent[]>([]);
  const [loading, setLoading] = useState(true);

  const cursor = useRef<string | undefined>(undefined);
  const seen = useRef(new Set<string>());
  const inFlight = useRef(false);

  // The watched set is identified by its contents, not the array instance the
  // caller rebuilds every render.
  const key = circles.join(',');

  useEffect(() => {
    cursor.current = undefined;
    seen.current = new Set();
    setEvents([]);
    setLoading(true);
  }, [key]);

  const poll = useCallback(async () => {
    if (inFlight.current) return;
    const watched = key ? key.split(',') : [];
    if (watched.length === 0) return;
    inFlight.current = true;

    try {
      const feed = await readCircleEvents(watched, cursor.current);
      const fresh = feed.events.filter((event) => !seen.current.has(event.id));
      if (fresh.length > 0) {
        fresh.forEach((event) => seen.current.add(event.id));
        setEvents((current) =>
          [...fresh, ...current].sort((a, b) => b.ledger - a.ledger).slice(0, 50),
        );
      }
      if (feed.cursor) cursor.current = feed.cursor;
    } catch {
      // Keep whatever the feed already shows; the next poll retries.
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }, [key]);

  useEffect(() => {
    void poll();
    const timer = setInterval(() => void poll(), POLL_MS);
    return () => clearInterval(timer);
  }, [poll]);

  return { events, loading };
}
