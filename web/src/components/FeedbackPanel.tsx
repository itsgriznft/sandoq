import { useEffect, useRef, useState } from 'react';

import { accountUrl, shortAddress } from '../config';
import type { Wallet } from '../hooks/useWallet';
import { track } from '../lib/analytics';
import { AppError, classifyError } from '../lib/errors';
import {
  MAX_NOTE_LEN,
  readFeedbackList,
  readFeedbackSummary,
  ROLE_LABELS,
  SENTIMENT_LABELS,
  submitFeedback,
  type FeedbackEntry,
  type FeedbackSummary,
  type Role,
  type Sentiment,
} from '../lib/feedback';
import type { TxProgress, TxStage } from '../lib/rpc';
import { signTransaction } from '../lib/wallet';
import { ErrorBanner } from './ErrorBanner';
import { TxStatus } from './TxStatus';

const FACES: Record<Sentiment, string> = { 1: '😖', 2: '😕', 3: '😐', 4: '🙂', 5: '🤩' };
const SENTIMENTS: Sentiment[] = [1, 2, 3, 4, 5];
const ROLES: Role[] = ['organizer', 'member', 'exploring'];

/**
 * The user-feedback surface, backed by the on-chain registry.
 *
 * Submitting is a signed transaction, so every response is public and
 * verifiable on testnet. The community summary and the list of notes are read
 * straight from the contract — this is a documented record, not a claim.
 */
export function FeedbackPanel({ wallet, onClose }: { wallet: Wallet; onClose: () => void }) {
  const [sentiment, setSentiment] = useState<Sentiment | null>(null);
  const [role, setRole] = useState<Role>('exploring');
  const [message, setMessage] = useState('');
  const [progress, setProgress] = useState<TxProgress>({ stage: 'idle' });
  const [done, setDone] = useState(false);

  const [summary, setSummary] = useState<FeedbackSummary | null>(null);
  const [entries, setEntries] = useState<FeedbackEntry[]>([]);

  const reached = useRef<TxStage>('idle');

  async function refresh() {
    try {
      const [s, list] = await Promise.all([readFeedbackSummary(), readFeedbackList()]);
      setSummary(s);
      setEntries(list);
    } catch {
      // A read failure just leaves the last good data; the panel still works.
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  const busy = ['simulating', 'signing', 'submitting', 'confirming'].includes(progress.stage);

  function report(next: TxProgress) {
    reached.current = next.stage;
    setProgress(next);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (sentiment === null || !wallet.address) return;

    reached.current = 'idle';
    setProgress({ stage: 'idle' });
    try {
      await submitFeedback(
        wallet.address,
        sentiment,
        role,
        message.trim(),
        (xdr) => signTransaction(xdr, wallet.address!),
        report,
      );
      track('feedback', { sentiment, role });
      setDone(true);
      await refresh();
    } catch (caught) {
      const error = caught instanceof AppError ? caught : classifyError(caught);
      setProgress({ stage: 'failed', failedAt: reached.current, error });
    }
  }

  function reset() {
    setSentiment(null);
    setRole('exploring');
    setMessage('');
    setDone(false);
    setProgress({ stage: 'idle' });
  }

  return (
    <section className="card feedback-panel">
      <header className="section-header">
        <h2>Feedback</h2>
        <button className="button button--ghost" onClick={onClose}>
          Close
        </button>
      </header>

      <p className="muted">
        Feedback lives on-chain — each response is a signed transaction, public and verifiable on
        testnet. No made-up numbers.
      </p>

      {progress.error && (
        <ErrorBanner error={progress.error} onDismiss={() => setProgress({ stage: 'idle' })} />
      )}

      {!wallet.address ? (
        <div className="feedback-connect">
          <p className="muted">Connect a wallet to leave feedback — it takes one quick signature.</p>
          <button className="button button--primary" onClick={wallet.connect} disabled={wallet.connecting}>
            {wallet.connecting ? 'Opening wallet…' : 'Connect wallet'}
          </button>
        </div>
      ) : done ? (
        <div className="feedback-thanks">
          <p className="feedback-thanks__emoji" aria-hidden="true">
            🙏
          </p>
          <h3>Thank you!</h3>
          <p className="muted">Your feedback is now a permanent record on testnet.</p>
          <TxStatus progress={progress} />
          <button className="button" onClick={reset}>
            Edit or leave another
          </button>
        </div>
      ) : (
        <form className="form feedback-form" onSubmit={submit}>
          <fieldset className="field">
            <span>Your take</span>
            <div className="feedback-faces" role="radiogroup" aria-label="Rating">
              {SENTIMENTS.map((value) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={sentiment === value}
                  aria-label={SENTIMENT_LABELS[value]}
                  title={SENTIMENT_LABELS[value]}
                  className={`feedback-face ${sentiment === value ? 'is-active' : ''}`}
                  onClick={() => setSentiment(value)}
                  disabled={busy}
                >
                  {FACES[value]}
                </button>
              ))}
            </div>
            {sentiment && <small className="muted">{SENTIMENT_LABELS[sentiment]}</small>}
          </fieldset>

          <fieldset className="field">
            <span>What did you do?</span>
            <div className="chips">
              {ROLES.map((value) => (
                <button
                  key={value}
                  type="button"
                  className={`chip ${role === value ? 'chip--active' : ''}`}
                  onClick={() => setRole(value)}
                  disabled={busy}
                >
                  {ROLE_LABELS[value]}
                </button>
              ))}
            </div>
          </fieldset>

          <label className="field">
            <span>Anything to add? (optional)</span>
            <textarea
              className="feedback-textarea"
              value={message}
              onChange={(e) => setMessage(e.target.value.slice(0, MAX_NOTE_LEN))}
              placeholder="What worked, what confused you, what you'd want next…"
              rows={3}
              disabled={busy}
            />
            <small className="muted">
              {message.length}/{MAX_NOTE_LEN}
            </small>
          </label>

          <button type="submit" className="button button--primary" disabled={sentiment === null || busy}>
            {busy ? 'Signing…' : 'Sign & submit feedback'}
          </button>

          <TxStatus progress={progress} />
        </form>
      )}

      {summary && summary.count > 0 && (
        <>
          <div className="section-header feedback-panel__subhead">
            <h3>
              Community feedback{' '}
              {summary.average !== null && (
                <span className="muted">
                  · avg {summary.average.toFixed(1)}/5{' '}
                  {FACES[Math.round(summary.average) as Sentiment]}
                </span>
              )}
            </h3>
            <span className="muted">
              {summary.count} {summary.count === 1 ? 'response' : 'responses'} on-chain
            </span>
          </div>

          <div className="feedback-breakdown">
            <span>🚀 {summary.organizers} started</span>
            <span>🪑 {summary.members} joined</span>
            <span>👀 {summary.exploring} exploring</span>
          </div>

          <ul className="feedback-list">
            {entries
              .slice()
              .reverse()
              .slice(0, 15)
              .map((entry) => (
                <li key={`${entry.author}-${entry.at.getTime()}`}>
                  <span className="feedback-list__face" aria-hidden="true">
                    {FACES[entry.sentiment]}
                  </span>
                  <div>
                    {entry.note && <p>{entry.note}</p>}
                    <small className="muted">
                      {ROLE_LABELS[entry.role]} ·{' '}
                      <a href={accountUrl(entry.author)} target="_blank" rel="noreferrer">
                        {entry.author === wallet.address ? 'you' : shortAddress(entry.author)}
                      </a>{' '}
                      · {entry.at.toLocaleDateString()}
                    </small>
                  </div>
                </li>
              ))}
          </ul>
        </>
      )}

      <p className="muted analytics__note">
        Read it yourself: call <code>summary()</code> on the feedback contract, or watch its events
        on Stellar Expert. Nothing here is off-chain.
      </p>
    </section>
  );
}
