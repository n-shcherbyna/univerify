import { describe, it, expect, vi } from "vitest";
import { sendWithRetry } from "../../src/util/nonceManager.js";

function makeMockClient(opts: {
  failFirstReceipt?: boolean;
  txHashes?: `0x${string}`[];
}) {
  const txHashes = opts.txHashes ?? ["0xaaa" as `0x${string}`, "0xbbb" as `0x${string}`];
  let sendCount = 0;
  let waitCount = 0;
  return {
    sendCount: () => sendCount,
    waitCount: () => waitCount,
    sendTransaction: vi.fn(async () => {
      const hash = txHashes[sendCount];
      sendCount++;
      return hash;
    }),
    waitForTransactionReceipt: vi.fn(async () => {
      waitCount++;
      if (opts.failFirstReceipt && waitCount === 1) {
        throw new Error("timeout waiting for receipt");
      }
      return { blockNumber: 100n, gasUsed: 21000n };
    }),
  };
}

describe("sendWithRetry", () => {
  it("returns the receipt on first-try success", async () => {
    const client = makeMockClient({});
    const result = await sendWithRetry({
      client: client as any,
      send: () => client.sendTransaction(),
      timeoutMs: 1000,
      maxAttempts: 3,
      bumpFactor: 1.25,
    });
    expect(result.blockNumber).toBe(100n);
    expect(client.sendCount()).toBe(1);
  });

  it("retries with a bumped gas price after a receipt timeout", async () => {
    const client = makeMockClient({ failFirstReceipt: true });
    const result = await sendWithRetry({
      client: client as any,
      send: () => client.sendTransaction(),
      timeoutMs: 50,
      maxAttempts: 3,
      bumpFactor: 1.25,
    });
    expect(result.blockNumber).toBe(100n);
    expect(client.sendCount()).toBe(2);
  });

  it("forwards bumpFactor to the send callback", async () => {
    const sendArgs: Array<[number, number]> = [];
    const client = {
      sendTransaction: vi.fn(async () => "0xaaa" as `0x${string}`),
      waitForTransactionReceipt: vi.fn(async () => ({ blockNumber: 1n })),
    };
    await sendWithRetry({
      client: client as any,
      send: async (attempt, bumpFactor) => {
        sendArgs.push([attempt, bumpFactor]);
        return client.sendTransaction();
      },
      timeoutMs: 100,
      maxAttempts: 1,
      bumpFactor: 1.5,
    });
    expect(sendArgs).toEqual([[1, 1.5]]);
  });

  it("gives up after maxAttempts and throws", async () => {
    const client = {
      sendTransaction: vi.fn(async () => "0xaaa" as `0x${string}`),
      waitForTransactionReceipt: vi.fn(async () => {
        throw new Error("timeout");
      }),
    };
    await expect(
      sendWithRetry({
        client: client as any,
        send: () => client.sendTransaction(),
        timeoutMs: 50,
        maxAttempts: 2,
        bumpFactor: 1.25,
      })
    ).rejects.toThrow(/gave up after 2 attempts/);
    expect(client.sendTransaction).toHaveBeenCalledTimes(2);
  });
});
