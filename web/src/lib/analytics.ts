/**
 * Analytics and error monitoring, self-contained and privacy-first.
 *
 * Every meaningful action becomes a typed event. Events fan out to three
 * sinks, all optional and all cheap:
 *
 *   1. A local ring buffer in `localStorage`, which powers the in-app
 *      analytics panel — no backend required, and nothing leaves the browser.
 *   2. `navigator.sendBeacon(VITE_ANALYTICS_URL, …)`, when an endpoint is
 *      configured. Beacons are fire-and-forget and survive page unload, so a
 *      wallet redirect never drops the event.
 *   3. The console in dev, so the stream is visible while building.
 *
 * Monitoring rides the same pipe: `window.onerror` and unhandled promise
 * rejections are captured as `error` events, so a crash in the field shows up
 * in the panel and at the endpoint like any other event.
 *
 * No cookies, no third-party script, no fingerprinting. A random per-tab
 * session id ties a visit's events together and is thrown away on close.
 */

export type AnalyticsEvent =
  | 'page_view'
  | 'wallet_connected'
  | 'wallet_rejected'
  | 'circle_viewed'
  | 'circle_created'
  | 'joined'
  | 'left'
  | 'contributed'
  | 'settled'
  | 'reclaimed'
  | 'tx_failed'
  | 'error';

export interface TrackedEvent {
  name: AnalyticsEvent;
  at: number;
  session: string;
  props?: Record<string, string | number | boolean | null>;
}

const ENDPOINT = import.meta.env.VITE_ANALYTICS_URL as string | undefined;
const STORE_KEY = 'sandoq.analytics.v1';
const MAX_STORED = 200;
const DEV = import.meta.env.DEV;

/**
 * A per-tab id. `crypto.randomUUID` is unavailable over plain HTTP on some
 * setups, so fall back to a timestamped random string.
 */
const session = (() => {
  try {
    return crypto.randomUUID();
  } catch {
    return `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }
})();

function readStore(): TrackedEvent[] {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    return raw ? (JSON.parse(raw) as TrackedEvent[]) : [];
  } catch {
    return [];
  }
}

function writeStore(events: TrackedEvent[]): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(events.slice(-MAX_STORED)));
  } catch {
    // Private-mode or a full quota: analytics is best-effort, never fatal.
  }
}

export function track(name: AnalyticsEvent, props?: TrackedEvent['props']): void {
  const event: TrackedEvent = { name, at: Date.now(), session, props };

  writeStore([...readStore(), event]);

  if (ENDPOINT) {
    try {
      const body = JSON.stringify(event);
      // sendBeacon survives the page unload a wallet redirect can trigger.
      if (navigator.sendBeacon) {
        navigator.sendBeacon(ENDPOINT, body);
      } else {
        void fetch(ENDPOINT, { method: 'POST', body, keepalive: true });
      }
    } catch {
      // A blocked endpoint must not break the app.
    }
  }

  if (DEV) console.debug('[analytics]', name, props ?? '');
}

/** The stored event stream, newest first — what the analytics panel renders. */
export function history(): TrackedEvent[] {
  return readStore().reverse();
}

/** Counts per event name, for the panel's summary tiles. */
export function summary(): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const event of readStore()) {
    counts[event.name] = (counts[event.name] ?? 0) + 1;
  }
  return counts;
}

export function clearHistory(): void {
  try {
    localStorage.removeItem(STORE_KEY);
  } catch {
    // ignore
  }
}

let monitoring = false;

/** Wire global error and rejection handlers into the same pipe. Idempotent. */
export function initMonitoring(): void {
  if (monitoring || typeof window === 'undefined') return;
  monitoring = true;

  window.addEventListener('error', (event) => {
    track('error', {
      message: event.message,
      source: event.filename ?? null,
      line: event.lineno ?? null,
    });
  });

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    track('error', {
      message: reason instanceof Error ? reason.message : String(reason),
      kind: 'unhandledrejection',
    });
  });
}
