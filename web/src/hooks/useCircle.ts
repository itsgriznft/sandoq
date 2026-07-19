import { useCallback, useEffect, useRef, useState } from 'react';

import {
  readCircleEvents,
  readCircleState,
  readSeats,
  type CircleEvent,
  type CircleState,
  type Seat,
} from '../lib/circle';
import { AppError, classifyError } from '../lib/errors';

const POLL_MS = 5_000;

export interface Circle {
  state: CircleState | null;
  seats: Seat[];
  events: CircleEvent[];
  loading: boolean;
  error: AppError | null;
  syncedAt: Date | null;
  refresh: () => void;
}

/**
 * Watches one circle: its state, every seat, and the events arriving to it.
 *
 * State and seats are re-read on every tick; events are pulled forward from a
 * cursor so each poll only transfers what is new. The first event fetch
 * backfills a day of history and takes a couple of round trips, so it must
 * not block the header from rendering.
 */
export function useCircle(address: string): Circle {
  const [state, setState] = useState<CircleState | null>(null);
  const [seats, setSeats] = useState<Seat[]>([]);
  const [events, setEvents] = useState<CircleEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<AppError | null>(null);
  const [syncedAt, setSyncedAt] = useState<Date | null>(null);

  const cursor = useRef<string | undefined>(undefined);
  const seen = useRef(new Set<string>());
  const inFlight = useRef(false);

  // A different circle means a different feed; drop everything we cached.
  useEffect(() => {
    cursor.current = undefined;
    seen.current = new Set();
    setState(null);
    setSeats([]);
    setEvents([]);
    setLoading(true);
    setError(null);
    setSyncedAt(null);
  }, [address]);

  const poll = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;

    try {
      const statePromise = readCircleState(address).then(async (next) => {
        setState(next);
        setLoading(false);
        // Seats depend on the current round, so they follow the state read.
        setSeats(await readSeats(address, next.round));
      });

      const feedPromise = readCircleEvents([address], cursor.current).then((feed) => {
        const fresh = feed.events.filter((event) => !seen.current.has(event.id));
        if (fresh.length > 0) {
          fresh.forEach((event) => seen.current.add(event.id));
          setEvents((current) => [...fresh, ...current].sort((a, b) => b.ledger - a.ledger));
        }
        if (feed.cursor) cursor.current = feed.cursor;
      });

      await Promise.all([statePromise, feedPromise]);

      setError(null);
      setSyncedAt(new Date());
    } catch (caught) {
      setError(classifyError(caught));
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }, [address]);

  useEffect(() => {
    void poll();
    const timer = setInterval(() => void poll(), POLL_MS);
    return () => clearInterval(timer);
  }, [poll]);

  return { state, seats, events, loading, error, syncedAt, refresh: () => void poll() };
}
