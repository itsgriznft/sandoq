import { useEffect } from 'react';

import { accountUrl, shortAddress } from '../config';
import { track } from '../lib/analytics';
import type { Wallet } from '../hooks/useWallet';

/**
 * A four-step guide from zero to a first on-chain action, for people who have
 * never touched a wallet. Onboarding friction is the whole game at this stage,
 * so each step is one link or one button, and the wallet steps check
 * themselves off from live state.
 */
export function Onboarding({
  wallet,
  onDone,
}: {
  wallet: Wallet;
  onDone: () => void;
}) {
  useEffect(() => {
    track('onboard_opened');
  }, []);

  const connected = Boolean(wallet.address);

  return (
    <section className="card onboard">
      <header className="section-header">
        <h2>New to Sandoq? Start here</h2>
        <button className="button button--ghost" onClick={onDone}>
          Close
        </button>
      </header>

      <p className="muted">
        Sandoq runs on the Stellar <strong>testnet</strong> — play money, no real funds, nothing to
        lose. Four steps, about two minutes.
      </p>

      <ol className="onboard__steps">
        <li className="onboard__step">
          <span className="onboard__num">1</span>
          <div>
            <strong>Install the Freighter wallet</strong>
            <p className="muted">
              A free browser extension that holds your Stellar keys.{' '}
              <a href="https://www.freighter.app/" target="_blank" rel="noreferrer">
                Get Freighter ↗
              </a>
            </p>
          </div>
        </li>

        <li className="onboard__step">
          <span className="onboard__num">2</span>
          <div>
            <strong>Switch it to Testnet and add free XLM</strong>
            <p className="muted">
              In Freighter, pick <em>Test Net</em> at the top, then fund the account. You can also
              use{' '}
              <a href="https://lab.stellar.org/account/fund" target="_blank" rel="noreferrer">
                friendbot ↗
              </a>{' '}
              — paste your address, get 10,000 test XLM.
            </p>
          </div>
        </li>

        <li className={`onboard__step ${connected ? 'is-done' : ''}`}>
          <span className="onboard__num">{connected ? '✓' : '3'}</span>
          <div>
            <strong>Connect your wallet</strong>
            {connected ? (
              <p className="muted">
                Connected as{' '}
                <a href={accountUrl(wallet.address!)} target="_blank" rel="noreferrer">
                  {shortAddress(wallet.address!)}
                </a>
                {wallet.balance !== null && ` · balance looks good.`}
              </p>
            ) : (
              <>
                <p className="muted">One click, then approve in Freighter.</p>
                <button
                  className="button button--primary"
                  onClick={wallet.connect}
                  disabled={wallet.connecting}
                >
                  {wallet.connecting ? 'Opening wallet…' : 'Connect wallet'}
                </button>
              </>
            )}
          </div>
        </li>

        <li className="onboard__step">
          <span className="onboard__num">4</span>
          <div>
            <strong>Join a circle</strong>
            <p className="muted">
              Pick a circle marked <em>Filling</em>, press <em>Join</em>, and sign. Joining stakes a
              small, refundable collateral — that&apos;s your first real transaction on Stellar.
            </p>
            <button className="button" onClick={onDone}>
              Show me the circles
            </button>
          </div>
        </li>
      </ol>

      <p className="muted onboard__note">
        Stuck? Everything here is testnet — you can&apos;t lose real money, so click around freely.
      </p>
    </section>
  );
}
