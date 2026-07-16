import {
  Account,
  Address,
  BASE_FEE,
  Contract,
  rpc,
  scValToNative,
  TransactionBuilder,
  type Transaction,
  type xdr,
} from '@stellar/stellar-sdk';

import { NETWORK_PASSPHRASE, RPC_URL, SIMULATION_SOURCE } from '../config';
import { AppError, classifyError, transactionResultError } from './errors';

export const server = new rpc.Server(RPC_URL);

/**
 * How long a built transaction stays valid. The clock starts at build time and
 * the user still has to read and approve a wallet prompt, so this is generous.
 */
const TX_VALID_SECONDS = 300;

export type TxStage =
  | 'idle'
  | 'simulating'
  | 'signing'
  | 'submitting'
  | 'confirming'
  | 'success'
  | 'failed';

export interface TxProgress {
  stage: TxStage;
  hash?: string;
  error?: AppError;
  /** Which stage a failure happened in, so earlier ones stay marked done. */
  failedAt?: TxStage;
}

/** Sign an XDR and hand back the signed XDR. Supplied by the wallet layer. */
export type Signer = (xdr: string) => Promise<string>;

export const addressArg = (address: string) => new Address(address).toScVal();

/**
 * Run a contract call through simulation only. Nothing is signed or submitted,
 * so this works for any address, connected or not.
 */
export async function simulate(contractId: string, method: string, ...args: xdr.ScVal[]): Promise<unknown> {
  const source = new Account(SIMULATION_SOURCE, '0');
  const tx = new TransactionBuilder(source, { fee: BASE_FEE, networkPassphrase: NETWORK_PASSPHRASE })
    .addOperation(new Contract(contractId).call(method, ...args))
    .setTimeout(30)
    .build();

  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) throw classifyError(new Error(sim.error));
  if (!sim.result) throw new AppError('UNKNOWN', `\`${method}\` returned nothing.`);

  return scValToNative(sim.result.retval);
}

/**
 * Simulate, sign, submit and then watch a contract call all the way to a final
 * ledger result, reporting each stage as it happens.
 *
 * Contract errors — an ended campaign, a short balance — surface during
 * simulation, before the user is ever asked to sign.
 */
export async function invoke(
  source: string,
  contractId: string,
  method: string,
  args: xdr.ScVal[],
  sign: Signer,
  onStage: (progress: TxProgress) => void,
): Promise<{ hash: string; returnValue: unknown }> {
  onStage({ stage: 'simulating' });

  const account = await server.getAccount(source);
  const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: NETWORK_PASSPHRASE })
    .addOperation(new Contract(contractId).call(method, ...args))
    // The clock starts when the transaction is built, and the user still has to
    // read and approve a wallet prompt. Two minutes is not enough for that.
    .setTimeout(TX_VALID_SECONDS)
    .build();

  // Simulates, then attaches the Soroban auth entries and resource footprint.
  const prepared = await server.prepareTransaction(tx);

  onStage({ stage: 'signing' });
  const signedXdr = await sign(prepared.toXDR());
  const signed = TransactionBuilder.fromXDR(signedXdr, NETWORK_PASSPHRASE) as Transaction;

  onStage({ stage: 'submitting' });
  const sent = await server.sendTransaction(signed);
  if (sent.status === 'ERROR') {
    throw transactionResultError(resultCode(sent.errorResult));
  }

  onStage({ stage: 'confirming', hash: sent.hash });
  const result = await waitForTransaction(sent.hash);

  onStage({ stage: 'success', hash: sent.hash });
  return {
    hash: sent.hash,
    returnValue: result.returnValue ? scValToNative(result.returnValue) : undefined,
  };
}

/** Poll until the ledger has a verdict on this transaction. */
async function waitForTransaction(
  hash: string,
  timeoutMs = 60_000,
): Promise<rpc.Api.GetSuccessfulTransactionResponse> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const result = await server.getTransaction(hash);

    if (result.status === rpc.Api.GetTransactionStatus.SUCCESS) return result;
    if (result.status === rpc.Api.GetTransactionStatus.FAILED) {
      // Contract errors surface during simulation, so a transaction that fails
      // this late failed for a ledger-level reason.
      throw transactionResultError(resultCode(result.resultXdr));
    }
    await sleep(1_000);
  }

  throw new AppError(
    'NETWORK',
    'The transaction did not confirm in time.',
    `It may still land. Check ${hash} on the explorer.`,
  );
}

/**
 * Pull the transaction result code (`txTooLate`, `txBadSeq`, …) out of an XDR
 * result. Falls back to a name rather than letting the raw XDR reach the UI.
 */
function resultCode(result: xdr.TransactionResult | undefined): string {
  try {
    return result?.result().switch().name ?? 'txUnknown';
  } catch {
    return 'txUnknown';
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
