import { StellarWalletsKit } from '@creit.tech/stellar-wallets-kit/sdk';
import { defaultModules } from '@creit.tech/stellar-wallets-kit/modules/utils';
import { Networks, SwkAppDarkTheme, type ISupportedWallet } from '@creit.tech/stellar-wallets-kit/types';

import { NETWORK_PASSPHRASE } from '../config';
import { AppError, classifyError } from './errors';

let started = false;

/** Registers every wallet module that works without extra configuration. */
export function initWallets(): void {
  if (started) return;
  StellarWalletsKit.init({
    modules: defaultModules(),
    network: Networks.TESTNET,
    theme: SwkAppDarkTheme,
  });
  started = true;
}

/** What the connect modal will offer, and which of those are actually installed. */
export async function supportedWallets(): Promise<ISupportedWallet[]> {
  initWallets();
  return StellarWalletsKit.refreshSupportedWallets();
}

/**
 * Open the wallet picker and return the chosen account.
 *
 * The kit rejects when the user closes the modal, and again when the chosen
 * wallet is missing or refuses to share an address — all of which arrive here
 * as opaque throws, so they get classified into something the UI can explain.
 */
export async function connect(): Promise<string> {
  initWallets();
  try {
    const { address } = await StellarWalletsKit.authModal();
    if (!address) throw new AppError('WALLET_NOT_FOUND', 'The wallet did not return an address.');
    return address;
  } catch (error) {
    throw classifyError(error);
  }
}

export async function disconnect(): Promise<void> {
  await StellarWalletsKit.disconnect();
}

/**
 * Ask the connected wallet to sign. A rejection here means the user pressed
 * "cancel" in the extension — the transaction never reaches the network.
 */
export async function signTransaction(xdr: string, address: string): Promise<string> {
  try {
    const { signedTxXdr } = await StellarWalletsKit.signTransaction(xdr, {
      address,
      networkPassphrase: NETWORK_PASSPHRASE,
    });
    return signedTxXdr;
  } catch (error) {
    throw classifyError(error);
  }
}
