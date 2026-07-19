import { useEffect, useState } from 'react';

import './App.css';
import { ActivityFeed } from './components/ActivityFeed';
import { AnalyticsPanel } from './components/AnalyticsPanel';
import { CircleCard } from './components/CircleCard';
import { CircleDetail } from './components/CircleDetail';
import { CreateCircleForm } from './components/CreateCircleForm';
import { ErrorBanner } from './components/ErrorBanner';
import { CircleCardSkeleton, StatsBarSkeleton } from './components/Skeleton';
import { StatsBar } from './components/StatsBar';
import { TxStatus } from './components/TxStatus';
import { WalletBar } from './components/WalletBar';
import { contractUrl, FACTORY_ID, shortAddress } from './config';
import { useSandoq } from './hooks/useSandoq';
import { useWallet } from './hooks/useWallet';
import { useCircleEventsFeed } from './hooks/useCircleEventsFeed';
import { track } from './lib/analytics';
import type { TxProgress } from './lib/rpc';

/**
 * The selected circle lives in the URL hash, so a circle is linkable and the
 * browser's back button works without pulling in a router.
 */
function useHashRoute(): [string | null, (address: string | null) => void] {
  const [hash, setHash] = useState(() => window.location.hash.slice(1));

  useEffect(() => {
    const onChange = () => setHash(window.location.hash.slice(1));
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);

  return [
    hash || null,
    (address) => {
      window.location.hash = address ?? '';
    },
  ];
}

export default function App() {
  const wallet = useWallet();
  const sandoq = useSandoq();
  const [selected, select] = useHashRoute();
  const [creating, setCreating] = useState(false);
  const [showAnalytics, setShowAnalytics] = useState(false);
  const [progress, setProgress] = useState<TxProgress>({ stage: 'idle' });
  const feed = useCircleEventsFeed(sandoq.listing.map((row) => row.address));

  // One page_view per mount, and one circle_viewed each time the hash route
  // lands on a circle.
  useEffect(() => {
    track('page_view', { path: window.location.pathname });
  }, []);
  useEffect(() => {
    if (selected) track('circle_viewed', { circle: selected });
  }, [selected]);

  // A failed create reports through the tx panel; anything the wallet or the
  // poller hits is a page-level problem. A poll failure only surfaces once
  // there is no listing left to show.
  const banner = progress.error ?? wallet.error ?? (sandoq.stats ? null : sandoq.error);

  return (
    <div className="page">
      <header className="page__header">
        <div>
          <h1>Sandoq</h1>
          <p className="muted">
            Rotating savings circles — sandoq, esusu, chit fund, tanda — with the trust moved into
            a contract. Factory{' '}
            <a href={contractUrl(FACTORY_ID)} target="_blank" rel="noreferrer">
              {shortAddress(FACTORY_ID)}
            </a>{' '}
            · Soroban testnet
          </p>
        </div>
        <WalletBar wallet={wallet} />
      </header>

      {banner && (
        <ErrorBanner
          error={banner}
          onDismiss={progress.error ? () => setProgress({ stage: 'idle' }) : undefined}
        />
      )}

      {showAnalytics ? (
        <main className="page__body">
          <AnalyticsPanel stats={sandoq.stats} onClose={() => setShowAnalytics(false)} />
        </main>
      ) : selected ? (
        <CircleDetail address={selected} wallet={wallet} onBack={() => select(null)} />
      ) : (
        <main className="page__body">
          {sandoq.stats ? (
            <StatsBar stats={sandoq.stats} syncedAt={sandoq.syncedAt} />
          ) : (
            <StatsBarSkeleton />
          )}

          {creating ? (
            <>
              <CreateCircleForm
                wallet={wallet}
                progress={progress}
                onProgress={setProgress}
                onCreated={(address) => {
                  setCreating(false);
                  track('circle_created', { circle: address });
                  sandoq.refresh();
                  select(address);
                }}
                onCancel={() => {
                  setCreating(false);
                  setProgress({ stage: 'idle' });
                }}
              />
              <TxStatus progress={progress} />
            </>
          ) : (
            <div className="section-header">
              <h2>Circles</h2>
              <button className="button button--primary" onClick={() => setCreating(true)}>
                Start a circle
              </button>
            </div>
          )}

          {sandoq.loading && sandoq.listing.length === 0 ? (
            <div className="grid">
              <CircleCardSkeleton />
              <CircleCardSkeleton />
              <CircleCardSkeleton />
            </div>
          ) : sandoq.listing.length === 0 ? (
            <section className="card">
              <p className="muted">No circles yet. Be the first to start one.</p>
            </section>
          ) : (
            <div className="grid">
              {sandoq.listing.map((row) => (
                <CircleCard key={row.address} row={row} onOpen={() => select(row.address)} />
              ))}
            </div>
          )}

          {sandoq.listing.length > 0 && (
            <ActivityFeed events={feed.events} you={wallet.address} loading={feed.loading} />
          )}
        </main>
      )}

      <footer className="page__footer muted">
        Testnet only. Get free XLM from{' '}
        <a href="https://lab.stellar.org/account/fund" target="_blank" rel="noreferrer">
          friendbot
        </a>
        {' · '}
        <button
          className="link-button"
          onClick={() => setShowAnalytics((open) => !open)}
        >
          {showAnalytics ? 'Back to circles' : 'Analytics'}
        </button>
      </footer>
    </div>
  );
}
