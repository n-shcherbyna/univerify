// packages/benchmarks/tests/chains/sepolia.test.ts
import { describe, it, expect, vi } from "vitest";
import receipt from "../fixtures/receipts/sepolia-issue-1.json";
import { createSepoliaAdapter } from "../../src/chains/sepolia.js";

describe("sepolia adapter", () => {
  it("parses a receipt into NormalizedMetrics with l1DataFee=0", async () => {
    const adapter = createSepoliaAdapter({
      rpcUrl: "http://mock",
      registryAddress: "0x0000000000000000000000000000000000000001",
      account: {} as never,
    });

    // Stub the viem publicClient.getTransactionReceipt
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
        submittedAt: 1000,
      },
      "issueBatch",
      { batchSize: 1, tag: "main" }
    );

    expect(metrics.chainId).toBe(11155111);
    expect(metrics.gasUsed).toBe(55_000n);
    expect(metrics.l1DataFee).toBe(0n);
    expect(metrics.l1GasUsed).toBeUndefined();
    expect(metrics.calldataBytes).toBe(2); // 0xabcd = 2 bytes
    expect(metrics.batchSize).toBe(1);
    expect(metrics.op).toBe("issueBatch");
  });
});
