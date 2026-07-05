import { encodeFunctionData, keccak256, toHex, type Address, type Hex } from "viem";
import { RegistryMultisigAbi, TimelockControllerAbi } from "@univerify/verifier-core";
import type { makePublicClient } from "./registry";

export const ZERO32 = ("0x" + "00".repeat(32)) as Hex;
export type OperationState = "Unset" | "Pending" | "Ready" | "Done";

type Pub = ReturnType<typeof makePublicClient>;

export function saltFor(label: string): Hex {
  return keccak256(toHex(label));
}

export async function readMultisigInfo(pub: Pub, multisig: Address) {
  const [owners, threshold, txCount] = await Promise.all([
    pub.readContract({ address: multisig, abi: RegistryMultisigAbi, functionName: "getOwners" }),
    pub.readContract({ address: multisig, abi: RegistryMultisigAbi, functionName: "threshold" }),
    pub.readContract({ address: multisig, abi: RegistryMultisigAbi, functionName: "txCount" }),
  ]);
  return { owners: owners as Address[], threshold: threshold as bigint, txCount: txCount as bigint };
}

export async function readMultisigTx(pub: Pub, multisig: Address, txId: bigint) {
  const [tx, confirmations] = await Promise.all([
    pub.readContract({ address: multisig, abi: RegistryMultisigAbi, functionName: "getTx", args: [txId] }),
    pub.readContract({ address: multisig, abi: RegistryMultisigAbi, functionName: "confirmationCount", args: [txId] }),
  ]);
  const [target, value, data, executed] = tx as [Address, bigint, Hex, boolean];
  return { txId, target, value, data, executed, confirmations: confirmations as bigint };
}

export async function readOperationState(pub: Pub, timelock: Address, id: Hex): Promise<{ state: OperationState; readyAt: bigint }> {
  const [timestamp, block] = await Promise.all([
    pub.readContract({ address: timelock, abi: TimelockControllerAbi, functionName: "getTimestamp", args: [id] }) as Promise<bigint>,
    pub.getBlock(),
  ]);
  if (timestamp === 0n) return { state: "Unset", readyAt: 0n };
  if (timestamp === 1n) return { state: "Done", readyAt: 0n };
  if (timestamp > block.timestamp) return { state: "Pending", readyAt: timestamp };
  return { state: "Ready", readyAt: timestamp };
}

export function buildScheduleCall(registry: Address, registryData: Hex, salt: Hex, delay: bigint): Hex {
  return encodeFunctionData({
    abi: TimelockControllerAbi, functionName: "schedule",
    args: [registry, 0n, registryData, ZERO32, salt, delay],
  });
}

export async function hashOp(pub: Pub, timelock: Address, registry: Address, registryData: Hex, salt: Hex): Promise<Hex> {
  return (await pub.readContract({
    address: timelock, abi: TimelockControllerAbi, functionName: "hashOperation",
    args: [registry, 0n, registryData, ZERO32, salt],
  })) as Hex;
}
