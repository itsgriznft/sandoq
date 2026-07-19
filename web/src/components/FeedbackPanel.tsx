import { useState } from 'react';

import {
  averageSentiment,
  feedbackHistory,
  hasBackend,
  ROLE_LABELS,
  SENTIMENT_LABELS,
  submitFeedback,
  type Role,
  type Sentiment,
} from '../lib/feedback';
import { shortAddress } from '../config';

const FACES: Record<Sentiment, string> = { 1: '😖', 2: '😕', 3: '😐', 4: '🙂', 5: '🤩' };
const SENTIMENTS: Sentiment[] = [1, 2, 3, 4, 5];
const ROLES: Role[] = ['organizer', 'member', 'exploring'];

/**
 * The user-feedback surface: a short form plus the notes left in this browser.
 *
 * Submissions are always kept locally so there is something to show; when a
 * form backend is configured they also POST there for central collection.
 */
export function FeedbackPanel({ address, onClose }: { address: string | null; onClose: () => void }) {
  const [sentiment, setSentiment] = useState<Sentiment | null>(null);
  const [role, setRole] = useState<Role>('exploring');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);

  // Snapshot of the local store, refreshed after each submission.
  const [history, setHistory] = useState(feedbackHistory);
  const [average, setAverage] = useState(averageSentiment);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (sentiment === null) return;
    setSending(true);
    await submitFeedback({ sentiment, role, message: message.trim(), address: address ?? undefined });
    setSending(false);
    setDone(true);
    setHistory(feedbackHistory());
    setAverage(averageSentiment());
  }

  function reset() {
    setSentiment(null);
    setRole('exploring');
    setMessage('');
    setDone(false);
  }

  return (
    <section className="card feedback-panel">
      <header className="section-header">
        <h2>Feedback</h2>
        <button className="button button--ghost" onClick={onClose}>
          Close
        </button>
      </header>

      {done ? (
        <div className="feedback-thanks">
          <p className="feedback-thanks__emoji" aria-hidden="true">
            🙏
          </p>
          <h3>Thank you!</h3>
          <p className="muted">
            {hasBackend
              ? 'Your note was sent — it helps shape what Sandoq builds next.'
              : 'Your note was saved. It helps shape what Sandoq builds next.'}
          </p>
          <button className="button" onClick={reset}>
            Leave another
          </button>
        </div>
      ) : (
        <form className="form feedback-form" onSubmit={submit}>
          <p className="muted">
            How was your experience? Two taps and a line is plenty — no account, no email.
          </p>

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
              onChange={(e) => setMessage(e.target.value.slice(0, 500))}
              placeholder="What worked, what confused you, what you'd want next…"
              rows={3}
            />
            <small className="muted">{message.length}/500</small>
          </label>

          <button type="submit" className="button button--primary" disabled={sentiment === null || sending}>
            {sending ? 'Sending…' : 'Send feedback'}
          </button>
        </form>
      )}

      {history.length > 0 && (
        <>
          <div className="section-header feedback-panel__subhead">
            <h3>
              Responses{' '}
              {average !== null && (
                <span className="muted">
                  · avg {average.toFixed(1)}/5 {FACES[Math.round(average) as Sentiment]}
                </span>
              )}
            </h3>
            <span className="muted">{history.length} in this browser</span>
          </div>
          <ul className="feedback-list">
            {history.slice(0, 12).map((f, index) => (
              <li key={`${f.at}-${index}`}>
                <span className="feedback-list__face" aria-hidden="true">
                  {FACES[f.sentiment]}
                </span>
                <div>
                  {f.message && <p>{f.message}</p>}
                  <small className="muted">
                    {ROLE_LABELS[f.role]}
                    {f.address ? ` · ${shortAddress(f.address)}` : ''} ·{' '}
                    {new Date(f.at).toLocaleString()}
                  </small>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      {!hasBackend && (
        <p className="muted analytics__note">
          Responses stay in this browser. Set <code>VITE_FEEDBACK_URL</code> to a form backend to
          collect them centrally.
        </p>
      )}
    </section>
  );
}
