import { formatPeriod, formatXlm, isClosed, timeLeft } from '../config';
import type { Row } from '../lib/factory';

export function StatusPill({ status, fillDeadline }: { status: Row['status']; fillDeadline: bigint }) {
  if (status === 'filling' && isClosed(fillDeadline)) {
    return <span className="pill pill--closed">Expired</span>;
  }
  const label = { filling: 'Filling', active: 'Running', complete: 'Complete' }[status];
  const kind = { filling: 'pill--live', active: 'pill--reached', complete: 'pill--closed' }[status];
  return <span className={`pill ${kind}`}>{label}</span>;
}

export function CircleCard({ row, onOpen }: { row: Row; onOpen: () => void }) {
  // While filling, progress = seats taken; while running, rounds finished.
  const percent =
    row.status === 'filling'
      ? (row.members / row.size) * 100
      : (row.round / row.size) * 100;

  return (
    <article className="card circle-card" onClick={onOpen} role="button" tabIndex={0}
      onKeyDown={(event) => event.key === 'Enter' && onOpen()}>
      <header className="circle-card__header">
        <h3>
          {row.private && (
            <span className="lock" title="Invite-only" aria-label="Invite-only">
              🔒{' '}
            </span>
          )}
          {row.name}
        </h3>
        <StatusPill status={row.status} fillDeadline={row.fillDeadline} />
      </header>

      <p className="muted">
        {formatXlm(row.contribution)} XLM {formatPeriod(row.period)} ·{' '}
        {formatXlm(row.collateral)} XLM stake
      </p>

      <div className="progress" role="progressbar" aria-valuenow={Math.round(percent)}
        aria-valuemin={0} aria-valuemax={100}>
        <div className="progress__fill" style={{ width: `${Math.min(percent, 100)}%` }} />
      </div>

      <p className="circle-card__meta muted">
        {row.status === 'filling' && (
          <>
            {row.members}/{row.size} seats taken · {timeLeft(row.fillDeadline).toLowerCase()}
          </>
        )}
        {row.status === 'active' && (
          <>
            round {row.round + 1} of {row.size} · {row.size} members
          </>
        )}
        {row.status === 'complete' && <>all {row.size} rounds paid out</>}
      </p>
    </article>
  );
}
