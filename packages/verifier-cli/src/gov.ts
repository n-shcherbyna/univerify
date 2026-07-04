import "dotenv/config";
import {
  createWalletClient, createPublicClient, http, encodeFunctionData,
  keccak256, toHex, isAddress, type Hex, type Address,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import {
  DiplomaRegistryAbi, RegistryMultisigAbi, TimelockControllerAbi,
} from "@univerify/verifier-core";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}
function flag(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i === -1 ? undefined : process.argv[i + 1];
}
function requireFlag(name: string): string {
  const v = flag(name);
  if (!v) throw new Error(`Missing flag: ${name}`);
  return v;
}

const ZERO32 = ("0x" + "00".repeat(32)) as Hex;

function clients() {
  const rpc = requireEnv("RPC_URL");
  const account = privateKeyToAccount(requireEnv("GOV_PK") as Hex);
  const wallet = createWalletClient({ account, chain: sepolia, transport: http(rpc) });
  const pub = createPublicClient({ chain: sepolia, transport: http(rpc) });
  return { account, wallet, pub };
}

/** Build the inner registry calldata for a supported op. */
function buildRegistryCall(op: string): Hex {
  const registry = requireEnv("REGISTRY_ADDRESS") as Address;
  void registry;
  switch (op) {
    case "onboardIssuer":
      return encodeFunctionData({
        abi: DiplomaRegistryAbi, functionName: "onboardIssuerAndUniversity",
        args: [
          requireFlag("--issuer") as Address, BigInt(requireFlag("--university-id")),
          requireFlag("--name"), requireFlag("--country"),
          requireFlag("--website"), requireFlag("--accreditation"),
        ],
      });
    case "removeIssuer":
      return encodeFunctionData({
        abi: DiplomaRegistryAbi, functionName: "removeIssuer",
        args: [requireFlag("--issuer") as Address],
      });
    case "setUniversity":
      return encodeFunctionData({
        abi: DiplomaRegistryAbi, functionName: "setUniversity",
        args: [
          BigInt(requireFlag("--university-id")), Number(requireFlag("--status")),
          requireFlag("--name"), requireFlag("--country"),
          requireFlag("--website"), requireFlag("--accreditation"),
        ],
      });
    case "acceptOwnership":
      return encodeFunctionData({ abi: DiplomaRegistryAbi, functionName: "acceptOwnership", args: [] });
    default:
      throw new Error(`Unknown --op: ${op}`);
  }
}

function saltFor(label: string): Hex {
  return keccak256(toHex(label));
}

async function multisigSubmit(target: Address, data: Hex): Promise<Hex> {
  const { wallet } = clients();
  const multisig = requireEnv("MULTISIG_ADDRESS") as Address;
  return wallet.writeContract({
    address: multisig, abi: RegistryMultisigAbi, functionName: "submit",
    args: [target, 0n, data],
  });
}

async function main() {
  const cmd = process.argv[2];
  const multisig = () => requireEnv("MULTISIG_ADDRESS") as Address;
  const timelock = () => requireEnv("TIMELOCK_ADDRESS") as Address;

  switch (cmd) {
    case "propose": {
      const op = requireFlag("--op");
      const label = flag("--salt") ?? op;
      const registryData = buildRegistryCall(op);
      const delay = BigInt(process.env.GOV_MIN_DELAY ?? "172800");
      const scheduleData = encodeFunctionData({
        abi: TimelockControllerAbi, functionName: "schedule",
        args: [requireEnv("REGISTRY_ADDRESS") as Address, 0n, registryData, ZERO32, saltFor(label), delay],
      });
      const tx = await multisigSubmit(timelock(), scheduleData);
      const { pub } = clients();
      const opId = await pub.readContract({
        address: timelock(), abi: TimelockControllerAbi, functionName: "hashOperation",
        args: [requireEnv("REGISTRY_ADDRESS") as Address, 0n, registryData, ZERO32, saltFor(label)],
      });
      console.log("submitted multisig tx:", tx);
      console.log("operationId:", opId);
      console.log("salt label:", label);
      break;
    }
    case "confirm": {
      const { wallet } = clients();
      const tx = await wallet.writeContract({
        address: multisig(), abi: RegistryMultisigAbi, functionName: "confirm",
        args: [BigInt(requireFlag("--tx"))],
      });
      console.log("confirm tx:", tx);
      break;
    }
    case "exec-multisig": {
      const { wallet } = clients();
      const tx = await wallet.writeContract({
        address: multisig(), abi: RegistryMultisigAbi, functionName: "execute",
        args: [BigInt(requireFlag("--tx"))],
      });
      console.log("execute (multisig) tx:", tx);
      break;
    }
    case "execute": {
      const { wallet } = clients();
      const op = requireFlag("--op");
      const label = flag("--salt") ?? op;
      const registryData = buildRegistryCall(op);
      const tx = await wallet.writeContract({
        address: timelock(), abi: TimelockControllerAbi, functionName: "execute",
        args: [requireEnv("REGISTRY_ADDRESS") as Address, 0n, registryData, ZERO32, saltFor(label)],
      });
      console.log("timelock execute tx:", tx);
      break;
    }
    case "cancel": {
      const opId = requireFlag("--op-id") as Hex;
      const cancelData = encodeFunctionData({ abi: TimelockControllerAbi, functionName: "cancel", args: [opId] });
      const tx = await multisigSubmit(timelock(), cancelData);
      console.log("cancel proposal submitted (needs m-of-n + exec-multisig):", tx);
      break;
    }
    case "owner": {
      const sub = process.argv[3]; // add | remove
      const addr = requireFlag("--address") as Address;
      if (!isAddress(addr)) throw new Error("bad --address");
      const fn = sub === "add" ? "addOwner" : sub === "remove" ? "removeOwner" : undefined;
      if (!fn) throw new Error("usage: gov owner add|remove --address <addr>");
      const data = encodeFunctionData({ abi: RegistryMultisigAbi, functionName: fn, args: [addr] });
      console.log("owner-change proposal submitted:", await multisigSubmit(multisig(), data));
      break;
    }
    case "threshold": {
      const data = encodeFunctionData({
        abi: RegistryMultisigAbi, functionName: "changeThreshold", args: [BigInt(requireFlag("--value"))],
      });
      console.log("threshold-change proposal submitted:", await multisigSubmit(multisig(), data));
      break;
    }
    case "status": {
      const { pub } = clients();
      const [owners, threshold, txCount] = await Promise.all([
        pub.readContract({ address: multisig(), abi: RegistryMultisigAbi, functionName: "getOwners" }),
        pub.readContract({ address: multisig(), abi: RegistryMultisigAbi, functionName: "threshold" }),
        pub.readContract({ address: multisig(), abi: RegistryMultisigAbi, functionName: "txCount" }),
      ]);
      console.log("owners:", owners);
      console.log("threshold:", threshold?.toString());
      console.log("txCount:", txCount?.toString());
      for (let i = 0n; i < (txCount as bigint); i++) {
        const [t, conf] = await Promise.all([
          pub.readContract({ address: multisig(), abi: RegistryMultisigAbi, functionName: "getTx", args: [i] }),
          pub.readContract({ address: multisig(), abi: RegistryMultisigAbi, functionName: "confirmationCount", args: [i] }),
        ]);
        console.log(`tx#${i}`, { target: (t as any)[0], executed: (t as any)[3], confirmations: (conf as bigint).toString() });
      }
      break;
    }
    default:
      console.log("Usage: gov <propose|confirm|exec-multisig|execute|cancel|owner|threshold|status> [flags]");
      process.exit(1);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
