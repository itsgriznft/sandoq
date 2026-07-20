import { useEffect, useRef, useState } from 'react';

import {
  contractUrl,
  formatPeriod,
  formatXlm,
  isClosed,
  shortAddress,
  timeLeft,
} from '../config';
import { useCircle } from '../hooks/useCircle';
import type { Wallet } from '../hooks/useWallet';
import { track, type AnalyticsEvent } from '../lib/analytics';
import * as circle from '../lib/circle';
import type { CircleState, Seat } from '../lib/circle';
import { AppError, classifyError } from '../lib/errors';
import type { TxProgress, TxStage } from '../lib/rpc';
import { signTransaction } from '../lib/wallet';
import { ActivityFeed } from './ActivityFeed';
import { StatusPill } from './CircleCard';
import { ErrorBanner } from './ErrorBanner';
import { Skeleton } from './Skeleton';
import { TxStatus } from './TxStatus';

export function CircleDetail({
  address,
  wallet,
  onBack,
}: {
  address: string;
  wallet: Wallet;
  onBack: () => void;
}) {
  const watch = useCircle(address);
  const [progress, setProgress] = useState<TxProgress>({ stage: 'idle' });
  // Whether the connected wallet may join — always true on a public circle,
  // checked on-chain for a private one.
  const [canJoin, setCanJoin] = useState(true);

  // Remember how far a transaction got, so a failure can say where it stopped
  // instead of greying out stages that actually succeeded.
  const reachedStage = useRef<TxStage>('idle');

  const isPrivate = watch.state?.private ?? false;
  useEffect(() => {
    if (!wallet.address || !isPrivate) {
      setCanJoin(true);
      return;
    }
    let cancelled = false;
    circle
      .readCanJoin(address, wallet.address)
      .then((ok) => !cancelled && setCanJoin(ok))
      .catch(() => !cancelled && setCanJoin(false));
    return () => {
      cancelled = true;
    };
    // Re-check after each sync (an invite may have just landed).
  }, [address, wallet.address, isPrivate, watch.syncedAt]);

  const banner = progress.error ?? (watch.state ? null : watch.error);
  const busy = ['simulating', 'signing', 'submitting', 'confirming'].includes(progress.stage);

  function report(next: TxProgress) {
    reachedStage.current = next.stage;
    setProgress(next);
  }

  async function run(
    event: AnalyticsEvent,
    action: (sign: (xdr: string) => Promise<string>) => Promise<string>,
  ) {
    if (!wallet.address) return;
    reachedStage.current = 'idle';
    setProgress({ stage: 'idle' });
    try {
      const hash = await action((xdr) => signTransaction(xdr, wallet.address!));
      track(event, { circle: address });
      await wallet.refresh();
      watch.refresh();
      return hash;
    } catch (caught) {
      const error = caught instanceof AppError ? caught : classifyError(caught);
      setProgress({ stage: 'failed', failedAt: reachedStage.current, error });
      track('tx_failed', { action: event, kind: error.kind });
    }
  }

  return (
    <section className="detail">
      <button className="button button--ghost" onClick={onBack}>
        ← All circles
      </button>

      {banner && (
        <ErrorBanner
          error={banner}
          onDismiss={progress.error ? () => setProgress({ stage: 'idle' }) : undefined}
        />
      )}

      {!watch.state ? (
        <section className="card" aria-busy="true">
          <Skeleton width="50%" height={22} />
          <Skeleton width="70%" height={12} />
          <Skeleton width="60%" height={12} />
        </section>
      ) : (
        <>
          <Header state={watch.state} address={address} syncedAt={watch.syncedAt} />

          <div className="detail__columns">
            <div className="detail__column">
              <Actions
                state={watch.state}
                seats={watch.seats}
                wallet={wallet}
                busy={busy}
                canJoin={canJoin}
                onJoin={() => run('joined', (sign) => circle.join(address, wallet.address!, sign, report))}
                onLeave={() => run('left', (sign) => circle.leave(address, wallet.address!, sign, report))}
                onContribute={() =>
                  run('contributed', (sign) => circle.contribute(address, wallet.address!, sign, report))
                }
                onSettle={() =>
                  run('settled', (sign) => circle.settle(address, wallet.address!, sign, report))
                }
                onReclaim={() =>
                  run('reclaimed', (sign) => circle.reclaim(address, wallet.address!, sign, report))
                }
                onInvite={(members) =>
                  run('invited', (sign) => circle.allow(address, wallet.address!, members, sign, report))
                }
              />
              <TxStatus progress={progress} />
              <Seats state={watch.state} seats={watch.seats} you={wallet.address} />
            </div>
            <ActivityFeed events={watch.events} you={wallet.address} loading={watch.loading} />
          </div>
        </>
      )}
    </section>
  );
}

/** End of the current round's contribution window, as a unix timestamp. */
const roundEnd = (state: CircleState): bigint =>
  state.start + BigInt(state.round + 1) * state.period;

function Header({
  state,
  address,
  syncedAt,
}: {
  state: CircleState;
  address: string;
  syncedAt: Date | null;
}) {
  const percent =
    state.status === 'filling'
      ? (state.members / state.size) * 100
      : (state.round / state.size) * 100;

  return (
    <section className="card circle">
      <header className="circle__header">
        <h2>
          {state.private && (
            <span className="lock" title="Invite-only" aria-label="Invite-only">
              🔒{' '}
            </span>
          )}
          {state.name}
        </h2>
        <StatusPill status={state.status} fillDeadline={state.fillDeadline} />
      </header>

      <div className="progress" role="progressbar" aria-valuenow={Math.round(percent)}
        aria-valuemin={0} aria-valuemax={100}>
        <div className="progress__fill" style={{ width: `${Math.min(percent, 100)}%` }} />
      </div>

      <div className="circle__numbers">
        <div>
          <strong>{formatXlm(state.contribution)} XLM</strong>
          <span>{formatPeriod(state.period)}</span>
        </div>
        <div>
          <strong>{formatXlm(state.collateral)} XLM</strong>
          <span>stake per seat</span>
        </div>
        {state.status === 'filling' ? (
          <>
            <div>
              <strong>
                {state.members}/{state.size}
              </strong>
              <span>seats taken</span>
            </div>
            <div>
              <strong>{timeLeft(state.fillDeadline)}</strong>
              <span>to fill the circle</span>
            </div>
          </>
        ) : (
          <>
            <div>
              <strong>
                {Math.min(state.round + 1, state.size)}/{state.size}
              </strong>
              <span>{state.status === 'complete' ? 'rounds — all paid' : 'current round'}</span>
            </div>
            <div>
              <strong>
                {state.status === 'complete' ? '—' : timeLeft(roundEnd(state))}
              </strong>
              <span>
                {state.status === 'complete'
                  ? 'circle finished'
                  : `${state.paidThisRound}/${state.size} paid this round`}
              </span>
            </div>
          </>
        )}
      </div>

      <footer className="circle__meta">
        <span>
          Contract{' '}
          <a href={contractUrl(address)} target="_blank" rel="noreferrer">
            {shortAddress(address)}
          </a>
        </span>
        <span>Organizer {shortAddress(state.organizer)}</span>
        <span className="circle__sync">
          {syncedAt ? `● synced ${syncedAt.toLocaleTimeString()}` : '○ syncing…'}
        </span>
      </footer>
    </section>
  );
}

function Actions({
  state,
  seats,
  wallet,
  busy,
  canJoin,
  onJoin,
  onLeave,
  onContribute,
  onSettle,
  onReclaim,
  onInvite,
}: {
  state: CircleState;
  seats: Seat[];
  wallet: Wallet;
  busy: boolean;
  canJoin: boolean;
  onJoin: () => void;
  onLeave: () => void;
  onContribute: () => void;
  onSettle: () => void;
  onReclaim: () => void;
  onInvite: (members: string[]) => void;
}) {
  const you = wallet.address;
  const yourSeat = you ? seats.find((seat) => seat.address === you) : undefined;

  if (!you) {
    return (
      <section className="card">
        <h3>Take part</h3>
        <p className="muted">Connect a wallet to join, contribute, or settle.</p>
      </section>
    );
  }

  const windowOver = isClosed(roundEnd(state));
  const allPaid = state.paidThisRound >= state.size;
  const settleReady = state.status === 'active' && (windowOver || allPaid);
  const isOrganizer = you === state.organizer;
  const blockedByInvite = state.private && !canJoin && !yourSeat;

  return (
    <section className="card actions">
      <h3>Take part</h3>

      {/* Organizer of a private circle can invite members while it fills. */}
      {state.status === 'filling' && state.private && isOrganizer && (
        <InviteBox onInvite={onInvite} busy={busy} />
      )}

      {state.status === 'filling' && blockedByInvite && !isClosed(state.fillDeadline) && (
        <p className="muted">
          🔒 This circle is invite-only. Ask the organizer ({shortAddress(state.organizer)}) to add
          your address, then refresh.
        </p>
      )}

      {state.status === 'filling' && !yourSeat && !blockedByInvite && !isClosed(state.fillDeadline) && (
        <>
          <p className="muted">
            Joining stakes {formatXlm(state.collateral)} XLM as collateral. It comes back when the
            circle completes — minus anything used to cover rounds you miss.
          </p>
          <button className="button button--primary" onClick={onJoin} disabled={busy}>
            {busy ? 'Working…' : `Join — stake ${formatXlm(state.collateral)} XLM`}
          </button>
        </>
      )}

      {state.status === 'filling' && yourSeat && (
        <>
          <p className="muted">
            You hold a seat. You can leave — with your full stake — any time before the circle
            fills.
          </p>
          <button className="button" onClick={onLeave} disabled={busy}>
            {busy ? 'Working…' : 'Leave and take back the stake'}
          </button>
        </>
      )}

      {state.status === 'filling' && !yourSeat && isClosed(state.fillDeadline) && (
        <p className="muted">This circle expired before filling. Members can reclaim by leaving.</p>
      )}

      {state.status === 'active' && yourSeat && !yourSeat.paidThisRound && !windowOver && (
        <>
          <p className="muted">
            Round {state.round + 1} is open: {formatXlm(state.contribution)} XLM due before the
            window closes.
          </p>
          <button className="button button--primary" onClick={onContribute} disabled={busy}>
            {busy ? 'Working…' : `Contribute ${formatXlm(state.contribution)} XLM`}
          </button>
        </>
      )}

      {state.status === 'active' && yourSeat?.paidThisRound && !settleReady && (
        <p className="muted">
          Paid for round {state.round + 1} ✓ — waiting on {state.size - state.paidThisRound}{' '}
          {state.size - state.paidThisRound === 1 ? 'member' : 'members'}.
        </p>
      )}

      {settleReady && (
        <>
          <p className="muted">
            {allPaid && !windowOver
              ? 'Everyone paid — the round can settle early.'
              : 'The round window is over.'}{' '}
            Anyone can turn the crank; the pot goes to the round&apos;s member, never the caller.
          </p>
          <button className="button button--primary" onClick={onSettle} disabled={busy}>
            {busy ? 'Working…' : `Settle round ${state.round + 1} — pay the pot out`}
          </button>
        </>
      )}

      {state.status === 'active' && !yourSeat && !settleReady && (
        <p className="muted">This circle is running with a full table — no seats to join.</p>
      )}

      {state.status === 'complete' && yourSeat && yourSeat.state.collateral > 0n && (
        <>
          <p className="muted">The circle finished. Your remaining stake is waiting.</p>
          <button className="button button--primary" onClick={onReclaim} disabled={busy}>
            {busy ? 'Working…' : `Reclaim ${formatXlm(yourSeat.state.collateral)} XLM`}
          </button>
        </>
      )}

      {state.status === 'complete' && (!yourSeat || yourSeat.state.collateral === 0n) && (
        <p className="muted">
          Circle complete — every member got a pot.{' '}
          {yourSeat ? 'Your stake is fully reclaimed.' : ''}
        </p>
      )}
    </section>
  );
}

function Seats({ state, seats, you }: { state: CircleState; seats: Seat[]; you: string | null }) {
  return (
    <section className="card seats">
      <h3>Seats — payout order</h3>
      <p className="muted">
        The pot rotates in join order. A missed round is covered from that member&apos;s stake
        before it can touch the recipient.
      </p>

      <ol className="seats__list">
        {seats.map((seat, index) => {
          const isRecipient = state.status === 'active' && index === state.round;
          return (
            <li key={seat.address} className={isRecipient ? 'is-next' : ''}>
              <span className="seats__order" aria-hidden="true">
                {index + 1}
              </span>
              <div className="seats__who">
                <strong>
                  {seat.address === you ? 'You' : shortAddress(seat.address)}
                  {seat.address === state.organizer && (
                    <span className="seats__tag" title="Created the circle — no special powers">
                      organizer
                    </span>
                  )}
                </strong>
                <small className="muted">{formatXlm(seat.state.collateral)} XLM stake left</small>
              </div>
              <div className="seats__badges">
                {isRecipient && <span className="pill pill--live">next payout</span>}
                {state.status === 'active' &&
                  (seat.paidThisRound ? (
                    <span className="pill pill--reached">paid</span>
                  ) : (
                    <span className="pill">due</span>
                  ))}
                {seat.state.received && <span className="pill pill--closed">received</span>}
                {seat.state.defaulted && <span className="pill pill--warn">defaulted</span>}
              </div>
            </li>
          );
        })}
        {Array.from({ length: state.size - seats.length }).map((_, index) => (
          <li key={`empty-${index}`} className="is-empty">
            <span className="seats__order" aria-hidden="true">
              {seats.length + index + 1}
            </span>
            <div className="seats__who">
              <strong className="muted">Open seat</strong>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** Organizer-only box for inviting addresses to a private circle. */
function InviteBox({ onInvite, busy }: { onInvite: (members: string[]) => void; busy: boolean }) {
  const [text, setText] = useState('');

  // Split on commas or whitespace; keep only well-formed Stellar addresses.
  const addresses = text
    .split(/[\s,]+/)
    .map((a) => a.trim())
    .filter((a) => /^G[A-Z2-7]{55}$/.test(a));

  return (
    <div className="invite">
      <p className="muted">
        You&apos;re the organizer of this invite-only circle. Paste the wallet addresses you want to
        let in — one or many.
      </p>
      <textarea
        className="feedback-textarea"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="GA…  GB…  (comma or newline separated)"
        rows={2}
        disabled={busy}
      />
      <div className="invite__row">
        <small className="muted">
          {addresses.length} valid address{addresses.length === 1 ? '' : 'es'}
        </small>
        <button
          className="button button--primary"
          onClick={() => {
            onInvite(addresses);
            setText('');
          }}
          disabled={busy || addresses.length === 0}
        >
          {busy ? 'Working…' : `Invite ${addresses.length || ''}`.trim()}
        </button>
      </div>
    </div>
  );
}
