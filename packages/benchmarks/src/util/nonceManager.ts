// packages/benchmarks/src/util/nonceManager.ts
import type { Hex } from "viem";

export type SendWithRetryOpts<TReceipt> = {
  client: {
    waitForTransactionReceipt: (args: { hash: Hex; timeout: number }) => Promise<TReceipt>;
  };
  /**
   * Submits the transaction. Called once per attempt. The implementation is
   * responsible for bumping its own gas price using `attempt` (1-indexed) and
   * the configured `bumpFactor` — exposing the bump here keeps this util
   * type-agnostic to viem's fee fields (EIP-1559 vs legacy).
   */
  send: (attempt: number, bumpFactor: number) => Promise<Hex>;
  timeoutMs: number;
  maxAttempts: number;
  bumpFactor: number;
};

/**
 * Submit a tx, await its receipt, and retry with a bumped gas price if the
 * receipt does not arrive within `timeoutMs`. Bounded by `maxAttempts`.
 *
 * Why: viem auto-nonce + naive waitForTransactionReceipt hangs for the full
 * timeout (5 min) when a tx is dropped from the mempool, which kills the
 * whole chain run. This wrapper resends with a higher fee so the replacement
 * tx lands.
 */
export async function sendWithRetry<TReceipt>(
  opts: SendWithRetryOpts<TReceipt>
): Promise<TReceipt> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    const hash = await opts.send(attempt, opts.bumpFactor);
    try {
      return await opts.client.waitForTransactionReceipt({
        hash,
        timeout: opts.timeoutMs,
      });
    } catch (err) {
      lastError = err;
      if (attempt < opts.maxAttempts) {
        console.warn(
          `[nonceManager] receipt timeout on attempt ${attempt}/${opts.maxAttempts} (hash: ${hash}), bumping and retrying`
        );
      }
    }
  }
  throw new Error(
    `sendWithRetry: gave up after ${opts.maxAttempts} attempts. Last error: ${String(lastError)}`
  );
}
