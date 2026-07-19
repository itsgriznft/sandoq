import { useEffect, useState } from 'react';

import { clearHistory, history, summary, type TrackedEvent } from '../lib/analytics';
import type { Stats } from '../lib/factory';
import { formatXlm } from '../config';

/** Human labels for the event names the summary tiles show. */
const LABELS: Record<string, string> = {
  page_view: 'Page views',
  wallet_connected: 'Wallets connected',
  circle_created: 'Circles created',
  joined: 'Joins',
  contributed: 'Contributions',
  settled: 'Settlements',
  reclaimed: 'Reclaims',
  tx_failed: 'Failed txns',
  error: 'Errors',
};

/**
 * The analytics and monitoring surface.
 *
 * On-chain metrics come from the factory's `stats()` — real product numbers,
 * not a proxy. Session metrics come from the local event stream, which also
 * captures errors, so this doubles as the monitoring view.
 */
export function AnalyticsPanel({ stats, onClose }: { stats: Stats | null; onClose: () => void }) {
  const [events, setEvents] = useState<TrackedEvent[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});

  const refresh = () => {
    setEvents(history());
    setCounts(summary());
  };

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 2_000);
    return () => clearInterval(timer);
  }, []);

  const errorCount = counts.error ?? 0;

  return (
    <section className="card analytics">
      <header className="section-header">
        <h2>Analytics &amp; monitoring</h2>
        <button className="button button--ghost" onClick={onClose}>
          Close
        </button>
      </header>

      <h3>On-chain — read from the factory</h3>
      <div className="analytics__grid">
        <Tile value={stats ? String(stats.circles) : '…'} label="Circles deployed" />
        <Tile value={stats ? String(stats.members) : '…'} label="Seats taken" />
        <Tile
          value={stats ? `${formatXlm(stats.committed, 0)}` : '…'}
          label="XLM committed / rotation"
        />
        <Tile
          value={stats ? `${stats.active}` : '…'}
          label="Circles running"
          sub={stats ? `${stats.filling} filling · ${stats.complete} done` : undefined}
        />
      </div>

      <h3>
        This session — local, private{' '}
        <span className={`analytics__health ${errorCount ? 'is-bad' : 'is-ok'}`}>
          {errorCount ? `${errorCount} error${errorCount === 1 ? '' : 's'}` : 'healthy'}
        </span>
      </h3>
      <div className="analytics__grid">
        {Object.keys(LABELS)
          .filter((name) => counts[name])
          .map((name) => (
            <Tile key={name} value={String(counts[name])} label={LABELS[name] ?? name} />
          ))}
        {Object.keys(counts).length === 0 && (
          <p className="muted">No events yet this session.</p>
        )}
      </div>

      {events.length > 0 && (
        <>
          <div className="section-header">
            <h3>Event stream</h3>
            <button
              className="button button--ghost"
              onClick={() => {
                clearHistory();
                refresh();
              }}
            >
              Clear
            </button>
          </div>
          <ol className="analytics__stream">
            {events.slice(0, 30).map((event, index) => (
              <li key={`${event.at}-${index}`} className={event.name === 'error' ? 'is-error' : ''}>
                <code>{event.name}</code>
                <span className="muted">
                  {event.props
                    ? Object.entries(event.props)
                        .map(([key, value]) => `${key}=${value}`)
                        .join(' · ')
                    : ''}
                </span>
                <time className="muted">{new Date(event.at).toLocaleTimeString()}</time>
              </li>
            ))}
          </ol>
        </>
      )}

      <p className="muted analytics__note">
        No cookies, no third-party scripts. Events stay in your browser unless a self-hosted
        endpoint is configured with <code>VITE_ANALYTICS_URL</code>.
      </p>
    </section>
  );
}

function Tile({ value, label, sub }: { value: string; label: string; sub?: string }) {
  return (
    <div className="analytics__tile">
      <strong>{value}</strong>
      <span>{label}</span>
      {sub && <small className="muted">{sub}</small>}
    </div>
  );
}
