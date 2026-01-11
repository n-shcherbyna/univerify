import { createWalletClient, custom, type Address } from "viem";
import { sepolia } from "viem/chains";

declare global {
  interface Window {
    ethereum?: any;
  }
}

export function getEthereum(): any | null {
  if (typeof window === "undefined") return null;
  return window.ethereum ?? null;
}

export async function ensureChain(params: { eth: any; targetChainId: number }) {
  const currentChainIdHex = (await params.eth.request({ method: "eth_chainId" })) as string;
  const currentChainId = Number.parseInt(currentChainIdHex, 16);

  if (currentChainId === params.targetChainId) return;

  await params.eth.request({
    method: "wallet_switchEthereumChain",
    params: [{ chainId: `0x${params.targetChainId.toString(16)}` }],
  });
}

export function makeWalletClient(params: { eth: any; account: Address }) {
  return createWalletClient({
    chain: sepolia,
    transport: custom(params.eth),
    account: params.account,
  });
}
