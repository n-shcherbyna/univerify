// packages/benchmarks/tests/chains/arbitrumSepolia.test.ts
import { describe, it, expect, vi } from "vitest";
import receipt from "../fixtures/receipts/arbitrumSepolia-issue-100.json";
import { createArbitrumSepoliaAdapter } from "../../src/chains/arbitrumSepolia.js";

describe("arbitrumSepolia adapter", () => {
  it("derives l1DataFee = gasUsedForL1 × effectiveGasPrice", async () => {
    const adapter = createArbitrumSepoliaAdapter({
      rpcUrl: "http://mock",
      registryAddress: "0x0000000000000000000000000000000000000001",
      account: {} as never,
    });

    vi.spyOn(adapter.publicClient, "waitForTransactionReceipt").mockResolvedValue({
      ...receipt,
      blockNumber: BigInt(receipt.blockNumber),
      gasUsed: BigInt(receipt.gasUsed),
      effectiveGasPrice: BigInt(receipt.effectiveGasPrice),
      gasUsedForL1: BigInt(receipt.gasUsedForL1),
    } as never);

    const metrics = await adapter.parseReceipt(
      {
        txHash: receipt.transactionHash as `0x${string}`,
        calldata: "0xabcd" as `0x${string}`,
        submittedAt: 3000,
      },
      "issueBatch",
      { batchSize: 100, tag: "main" }
    );

    expect(metrics.chainId).toBe(421614);
    expect(metrics.l1GasUsed).toBe(BigInt(receipt.gasUsedForL1));
    expect(metrics.l1DataFee).toBe(
      BigInt(receipt.gasUsedForL1) * BigInt(receipt.effectiveGasPrice)
    );
  });
});
