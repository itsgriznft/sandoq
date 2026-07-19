import { txUrl } from '../config';
import type { TxProgress, TxStage } from '../lib/rpc';

/** The stages a transaction passes through, in order, with what each one means. */
const STAGES: { stage: TxStage; label: string; detail: string }[] = [
  { stage: 'simulating', label: 'Simulating', detail: 'Checking the call against the current ledger' },
  { stage: 'signing', label: 'Signing', detail: 'Waiting for your wallet' },
  { stage: 'submitting', label: 'Submitting', detail: 'Sending the transaction to the network' },
  { stage: 'confirming', label: 'Confirming', detail: 'Waiting for the ledger to close' },
];

const ORDER: TxStage[] = ['idle', 'simulating', 'signing', 'submitting', 'confirming', 'success'];

export function TxStatus({ progress }: { progress: TxProgress }) {
  if (progress.stage === 'idle') return null;

  const failed = progress.stage === 'failed';
  const succeeded = progress.stage === 'success';

  // On failure the current stage is `failed`, which is not in ORDER; use the
  // stage it got stuck in so everything before it still reads as done.
  const currentIndex = ORDER.indexOf(failed ? (progress.failedAt ?? 'idle') : progress.stage);

  return (
    <section className={`card tx tx--${progress.stage}`} aria-live="polite">
      {/* Joining, contributing, settling and creating all report through here. */}
      <h3>{succeeded ? 'Transaction confirmed' : failed ? 'Transaction failed' : 'Transaction in progress'}</h3>

      <ol className="tx__stages">
        {STAGES.map(({ stage, label, detail }) => {
          const index = ORDER.indexOf(stage);
          const done = succeeded || currentIndex > index;
          const stopped = failed && currentIndex === index;
          const active = !failed && progress.stage === stage;

          return (
            <li
              key={stage}
              className={done ? 'is-done' : stopped ? 'is-stopped' : active ? 'is-active' : ''}
            >
              <span className="tx__dot" aria-hidden="true">
                {done ? '✓' : stopped ? '×' : active ? '•' : ''}
              </span>
              <div>
                <strong>{label}</strong>
                <small>{detail}</small>
              </div>
            </li>
          );
        })}
      </ol>

      {progress.hash && (
        <p className="tx__hash">
          <a href={txUrl(progress.hash)} target="_blank" rel="noreferrer">
            View transaction on Stellar Expert ↗
          </a>
          <code>{progress.hash}</code>
        </p>
      )}
    </section>
  );
}
