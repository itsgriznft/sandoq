import { useEffect, useState } from 'react';
import type { ISupportedWallet } from '@creit.tech/stellar-wallets-kit/types';

import { accountUrl, formatXlm, shortAddress } from '../config';
import { supportedWallets } from '../lib/wallet';
import type { Wallet } from '../hooks/useWallet';

export function WalletBar({ wallet }: { wallet: Wallet }) {
  const [wallets, setWallets] = useState<ISupportedWallet[]>([]);

  useEffect(() => {
    supportedWallets().then(setWallets).catch(() => setWallets([]));
  }, []);

  const installed = wallets.filter((entry) => entry.isAvailable);

  if (!wallet.address) {
    return (
      <div className="wallet wallet--disconnected">
        <button className="button button--primary" onClick={wallet.connect} disabled={wallet.connecting}>
          {wallet.connecting ? 'Opening wallet…' : 'Connect wallet'}
        </button>

        <ul className="wallet__options">
          {wallets.map((entry) => (
            <li
              key={entry.id}
              className={entry.isAvailable ? 'is-available' : 'is-missing'}
              title={entry.isAvailable ? `${entry.name} — detected` : `${entry.name} — not installed`}
            >
              <img src={entry.icon} alt={entry.name} width={22} height={22} />
            </li>
          ))}
        </ul>

        <p className="wallet__hint">
          {wallets.length > 0
            ? `${wallets.length} wallets supported · ${installed.length} detected in this browser`
            : 'Loading wallet options…'}
        </p>
      </div>
    );
  }

  return (
    <div className="wallet">
      <div className="wallet__account">
        <a href={accountUrl(wallet.address)} target="_blank" rel="noreferrer" className="wallet__address">
          {shortAddress(wallet.address)}
        </a>
        <span className="wallet__balance">
          {wallet.balance === null ? 'balance unavailable' : `${formatXlm(wallet.balance)} XLM`}
        </span>
      </div>
      <button className="button" onClick={wallet.disconnect}>
        Disconnect
      </button>
    </div>
  );
}
