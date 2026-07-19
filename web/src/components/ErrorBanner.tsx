import type { AppError, ErrorKind } from '../lib/errors';

/** Each handled error kind gets its own icon so the cause is readable at a glance. */
const ICONS: Record<ErrorKind, string> = {
  WALLET_NOT_FOUND: '🔌',
  USER_REJECTED: '✋',
  INSUFFICIENT_BALANCE: '💸',
  ACCOUNT_NOT_FUNDED: '🚰',
  CONTRACT_REJECTED: '⛔',
  NETWORK: '📡',
  UNKNOWN: '⚠️',
};

export function ErrorBanner({ error, onDismiss }: { error: AppError; onDismiss?: () => void }) {
  return (
    <div className={`banner banner--${error.kind.toLowerCase()}`} role="alert">
      <span className="banner__icon" aria-hidden="true">
        {ICONS[error.kind]}
      </span>
      <div className="banner__body">
        <strong>{error.message}</strong>
        {error.hint && <p>{error.hint}</p>}
        <code className="banner__kind">{error.kind}</code>
      </div>
      {onDismiss && (
        <button className="banner__close" onClick={onDismiss} aria-label="Dismiss">
          ×
        </button>
      )}
    </div>
  );
}
