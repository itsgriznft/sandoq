import { useEffect, useState } from 'react';

import './App.css';
import { contractUrl, formatPeriod, formatXlm, shortAddress } from './config';
import { readListing, readStats, type Row, type Stats } from './lib/factory';

/**
 * Read-only shell while the full circle UI lands: live stats and the circle
 * registry, straight from the factory contract on testnet.
 */
export default function App() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([readStats(), readListing()])
      .then(([s, r]) => {
        if (cancelled) return;
        setStats(s);
        setRows(r);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="app">
      <header className="header">
        <div>
          <h1>Sandoq</h1>
          <p className="tagline">
            Rotating savings circles on Stellar — stake, contribute, rotate. No
            organizer custody.
          </p>
        </div>
      </header>

      {error && <p role="alert">Could not reach the network: {error}</p>}

      <section aria-label="Totals">
        {stats ? (
          <p>
            {stats.circles} circle{stats.circles === 1 ? '' : 's'} ·{' '}
            {stats.members} member{stats.members === 1 ? '' : 's'} ·{' '}
            {formatXlm(stats.committed)} XLM committed per full rotation
          </p>
        ) : (
          !error && <p>Reading the chain…</p>
        )}
      </section>

      <section aria-label="Circles">
        {rows?.map((row) => (
          <article key={row.address} className="circle-row">
            <h2>{row.name}</h2>
            <p>
              {row.status} · {row.members}/{row.size} seats ·{' '}
              {formatXlm(row.contribution)} XLM {formatPeriod(row.period)} ·
              round {row.round + (row.status === 'complete' ? 0 : 1)} of{' '}
              {row.size} ·{' '}
              <a href={contractUrl(row.address)} target="_blank" rel="noreferrer">
                {shortAddress(row.address)}
              </a>
            </p>
          </article>
        ))}
        {rows && rows.length === 0 && <p>No circles yet.</p>}
      </section>
    </div>
  );
}
