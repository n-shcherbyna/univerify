// packages/benchmarks/tests/chains/zksyncSepolia.test.ts
import { describe, it, expect, vi } from "vitest";
import receipt from "../fixtures/receipts/zksyncSepolia-issue-100.json";
import { createZkSyncSepoliaAdapter } from "../../src/chains/zksyncSepolia.js";

describe("zksyncSepolia adapter", () => {
  it("reports l1DataFee=0 and includes bundled L1 cost in gasUsed×price", async () => {
    const adapter = createZkSyncSepoliaAdapter({
      rpcUrl: "http://mock",
      registryAddress: "0x0000000000000000000000000000000000000001",
      account: {} as never,
    });

    vi.spyOn(adapter.publicClient, "waitForTransactionReceipt").mockResolvedValue({
      ...receipt,
      blockNumber: BigInt(receipt.blockNumber),
      gasUsed: BigInt(receipt.gasUsed),
      effectiveGasPrice: BigInt(receipt.effectiveGasPrice),
    } as never);

    const metrics = await adapter.parseReceipt(
      {
        txHash: receipt.transactionHash as `0x${string}`,
        calldata: "0xabcd" as `0x${string}`,
        submittedAt: 4000,
      },
      "issueBatch",
      { batchSize: 100, tag: "main" }
    );

    expect(metrics.chainId).toBe(300);
    expect(metrics.l1DataFee).toBe(0n);
    expect(metrics.gasUsed).toBe(BigInt(receipt.gasUsed));
  });
});
