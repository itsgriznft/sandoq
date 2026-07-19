import { useRef, useState } from 'react';

import { MAX_MEMBERS, MAX_NAME_LEN, MIN_MEMBERS, parseXlm } from '../config';
import { AppError, classifyError } from '../lib/errors';
import { createCircle } from '../lib/factory';
import type { TxProgress, TxStage } from '../lib/rpc';
import { signTransaction } from '../lib/wallet';
import type { Wallet } from '../hooks/useWallet';

const PERIODS = [
  { label: 'Daily', seconds: 86_400 },
  { label: 'Weekly', seconds: 7 * 86_400 },
  { label: 'Every 2 weeks', seconds: 14 * 86_400 },
  { label: 'Monthly', seconds: 30 * 86_400 },
];

const FILL_WINDOWS = [
  { label: '3 days', days: 3 },
  { label: '7 days', days: 7 },
  { label: '30 days', days: 30 },
];

interface Props {
  wallet: Wallet;
  progress: TxProgress;
  onProgress: (progress: TxProgress) => void;
  onCreated: (address: string) => void;
  onCancel: () => void;
}

export function CreateCircleForm({ wallet, progress, onProgress, onCreated, onCancel }: Props) {
  const [name, setName] = useState('');
  const [contribution, setContribution] = useState('25');
  const [periodSeconds, setPeriodSeconds] = useState(7 * 86_400);
  const [size, setSize] = useState(5);
  const [collateral, setCollateral] = useState('25');
  const [fillDays, setFillDays] = useState(7);

  // Remember how far the transaction got, so a failure can say where it
  // stopped instead of greying out stages that actually succeeded.
  const reached = useRef<TxStage>('idle');

  function report(next: TxProgress) {
    reached.current = next.stage;
    onProgress(next);
  }

  function fail(error: AppError) {
    onProgress({ stage: 'failed', failedAt: reached.current, error });
  }

  const busy = ['simulating', 'signing', 'submitting', 'confirming'].includes(progress.stage);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!wallet.address) return;

    reached.current = 'idle';
    onProgress({ stage: 'idle' });

    const trimmed = name.trim();
    if (trimmed.length === 0) {
      fail(new AppError('CONTRACT_REJECTED', 'Give the circle a name.'));
      return;
    }

    let contributionStroops: bigint;
    let collateralStroops: bigint;
    try {
      contributionStroops = parseXlm(contribution);
      collateralStroops = parseXlm(collateral);
    } catch (caught) {
      fail(classifyError(caught));
      return;
    }
    if (contributionStroops <= 0n) {
      fail(new AppError('CONTRACT_REJECTED', 'The contribution must be greater than zero.'));
      return;
    }
    if (size < MIN_MEMBERS || size > MAX_MEMBERS) {
      fail(
        new AppError(
          'CONTRACT_REJECTED',
          `A circle takes ${MIN_MEMBERS} to ${MAX_MEMBERS} members.`,
        ),
      );
      return;
    }

    const fillDeadline = BigInt(Math.floor(Date.now() / 1000) + fillDays * 86_400);

    try {
      const { address } = await createCircle(
        wallet.address,
        trimmed,
        contributionStroops,
        BigInt(periodSeconds),
        size,
        collateralStroops,
        fillDeadline,
        (xdr) => signTransaction(xdr, wallet.address!),
        report,
      );
      await wallet.refresh();
      onCreated(address);
    } catch (caught) {
      fail(classifyError(caught));
    }
  }

  const disabled = !wallet.address || busy;

  return (
    <section className="card">
      <header className="section-header">
        <h3>Start a circle</h3>
        <button className="button button--ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </header>

      <p className="muted">
        The factory deploys a brand-new circle contract. You become its organizer — which grants
        no custody: the contract itself escrows every stake and pays every pot.
      </p>

      <form onSubmit={submit} className="form">
        <label className="field">
          <span>Name</span>
          <input
            value={name}
            onChange={(event) => setName(event.target.value.slice(0, MAX_NAME_LEN))}
            placeholder="Family sandoq"
            disabled={disabled}
          />
          <small className="muted">
            {name.length}/{MAX_NAME_LEN}
          </small>
        </label>

        <div className="field__pair">
          <label className="field">
            <span>Contribution per round</span>
            <div className="field__row">
              <input
                inputMode="decimal"
                value={contribution}
                onChange={(event) => setContribution(event.target.value)}
                disabled={disabled}
              />
              <span className="field__suffix">XLM</span>
            </div>
          </label>

          <label className="field">
            <span>Stake to join</span>
            <div className="field__row">
              <input
                inputMode="decimal"
                value={collateral}
                onChange={(event) => setCollateral(event.target.value)}
                disabled={disabled}
              />
              <span className="field__suffix">XLM</span>
            </div>
            <small className="muted">Covers rounds a member misses.</small>
          </label>
        </div>

        <fieldset className="field" disabled={disabled}>
          <span>Round length</span>
          <div className="chips">
            {PERIODS.map((period) => (
              <button
                key={period.seconds}
                type="button"
                className={`chip ${periodSeconds === period.seconds ? 'chip--active' : ''}`}
                onClick={() => setPeriodSeconds(period.seconds)}
              >
                {period.label}
              </button>
            ))}
          </div>
        </fieldset>

        <label className="field">
          <span>Seats — one round and one payout each</span>
          <div className="field__row">
            <input
              type="number"
              min={MIN_MEMBERS}
              max={MAX_MEMBERS}
              value={size}
              onChange={(event) => setSize(Number(event.target.value))}
              disabled={disabled}
            />
            <span className="field__suffix">members</span>
          </div>
        </label>

        <fieldset className="field" disabled={disabled}>
          <span>Time to fill the seats</span>
          <div className="chips">
            {FILL_WINDOWS.map((window) => (
              <button
                key={window.days}
                type="button"
                className={`chip ${fillDays === window.days ? 'chip--active' : ''}`}
                onClick={() => setFillDays(window.days)}
              >
                {window.label}
              </button>
            ))}
          </div>
          <small className="muted">Not full by then? Everyone leaves with their stake.</small>
        </fieldset>

        <button type="submit" className="button button--primary" disabled={disabled}>
          {busy ? 'Deploying…' : wallet.address ? 'Deploy circle' : 'Connect a wallet first'}
        </button>
      </form>
    </section>
  );
}
