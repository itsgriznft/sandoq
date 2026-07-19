import { useCallback, useEffect, useState } from 'react';

import { track } from '../lib/analytics';
import { readBalance } from '../lib/circle';
import { AppError, classifyError } from '../lib/errors';
import * as wallet from '../lib/wallet';

export interface Wallet {
  address: string | null;
  /** XLM balance in stroops, or null when it could not be read. */
  balance: bigint | null;
  connecting: boolean;
  error: AppError | null;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  refresh: () => Promise<void>;
}

export function useWallet(): Wallet {
  const [address, setAddress] = useState<string | null>(null);
  const [balance, setBalance] = useState<bigint | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<AppError | null>(null);

  useEffect(() => {
    wallet.initWallets();
  }, []);

  const refresh = useCallback(async () => {
    if (!address) return;
    try {
      setBalance(await readBalance(address));
    } catch (caught) {
      // An account that exists in the wallet but not on testnet has no balance
      // to read; surface it rather than showing a stale number.
      setBalance(null);
      setError(classifyError(caught));
    }
  }, [address]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const connect = useCallback(async () => {
    setConnecting(true);
    setError(null);
    try {
      const connected = await wallet.connect();
      setAddress(connected);
      track('wallet_connected');
    } catch (caught) {
      const appError = classifyError(caught);
      setError(appError);
      track('wallet_rejected', { kind: appError.kind });
    } finally {
      setConnecting(false);
    }
  }, []);

  const disconnect = useCallback(async () => {
    await wallet.disconnect();
    setAddress(null);
    setBalance(null);
    setError(null);
  }, []);

  return { address, balance, connecting, error, connect, disconnect, refresh };
}
