import { formatXlm, shortAddress, txUrl } from '../config';
import type { CircleEvent, CircleEventType } from '../lib/circle';
import { Skeleton } from './Skeleton';

const ICONS: Record<CircleEventType, string> = {
  joined: '🪑',
  left: '🚪',
  started: '🚀',
  contributed: '💰',
  slashed: '⚠️',
  paid_out: '🎉',
  completed: '🏁',
  reclaimed: '↩️',
};

function describe(event: CircleEvent, you: string | null): string {
  const who = event.member ? (event.member === you ? 'You' : shortAddress(event.member)) : '';
  const amount = event.amount !== undefined ? `${formatXlm(event.amount)} XLM` : '';
  const round = event.round !== undefined ? `round ${event.round + 1}` : '';

  switch (event.type) {
    case 'joined':
      return `${who} took a seat`;
    case 'left':
      return `${who} left the circle`;
    case 'started':
      return 'The circle filled and started';
    case 'contributed':
      return `${who} paid ${amount} into ${round}`;
    case 'slashed':
      return event.amount === 0n
        ? `${who} missed ${round} with no collateral left`
        : `${who} missed ${round} — ${amount} covered from their stake`;
    case 'paid_out':
      return `${who} received the ${round} pot: ${amount}`;
    case 'completed':
      return 'Every round paid out — circle complete';
    case 'reclaimed':
      return `${who} reclaimed ${amount} of stake`;
  }
}

export function ActivityFeed({
  events,
  you,
  loading,
}: {
  events: CircleEvent[];
  you: string | null;
  loading: boolean;
}) {
  return (
    <section className="card feed" aria-label="Activity">
      <h3>Activity</h3>
      <p className="muted feed__hint">Live from contract events — last ~24h, newest first.</p>

      {loading && events.length === 0 && (
        <div aria-busy="true">
          <Skeleton height={14} />
          <Skeleton width="80%" height={14} />
          <Skeleton width="90%" height={14} />
        </div>
      )}

      {!loading && events.length === 0 && (
        <p className="muted">Nothing yet. Contributions and payouts will appear here live.</p>
      )}

      <ol className="feed__list">
        {events.map((event) => (
          <li key={event.id} className={event.member === you ? 'is-you' : ''}>
            <span aria-hidden="true">{ICONS[event.type]}</span>
            <div>
              <p>{describe(event, you)}</p>
              <small className="muted">
                {event.at.toLocaleTimeString()} ·{' '}
                <a href={txUrl(event.txHash)} target="_blank" rel="noreferrer">
                  tx ↗
                </a>
              </small>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
