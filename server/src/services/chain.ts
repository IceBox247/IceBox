import { ethers } from 'ethers';
import { config } from '../config';

/**
 * On-chain reads for holding-based mining. The connected wallet's ICE USD
 * balance sets the mining level, so we read balanceOf from the token contract
 * over the BSC RPC and convert to a USD value using the configured price.
 */

const ERC20_ABI = ['function balanceOf(address) view returns (uint256)'];

let provider: ethers.JsonRpcProvider | null = null;
function getProvider(): ethers.JsonRpcProvider {
  if (!provider) provider = new ethers.JsonRpcProvider(config.payout.rpcUrl);
  return provider;
}

/** Is this a well-formed EVM address? */
export function isEvmAddress(addr: string | null | undefined): boolean {
  return !!addr && /^0x[a-fA-F0-9]{40}$/.test(addr);
}

export interface Holding {
  tokens: number; // ICE USD token amount held
  usd: number; // USD value of the holding (tokens * price)
}

// Short cache so repeated reads (page loads, accrual) don't hammer the RPC.
const cache = new Map<string, { at: number; holding: Holding }>();
const TTL_MS = 30_000;

/** Read a wallet's on-chain ICE USD holding (token amount + USD value). */
export async function readIceHolding(address: string): Promise<Holding> {
  if (!isEvmAddress(address)) return { tokens: 0, usd: 0 };
  const key = address.toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.holding;

  const token = new ethers.Contract(config.token.address, ERC20_ABI, getProvider());
  const raw: bigint = await token.balanceOf(address);
  const tokens = Number(ethers.formatUnits(raw, config.token.decimals));
  const usd = Math.round(tokens * config.miningLevels.price * 1e4) / 1e4;
  const holding: Holding = { tokens, usd };
  cache.set(key, { at: Date.now(), holding });
  return holding;
}

/** Force a fresh read (bypass cache) — used right after a buy/connect. */
export async function refreshIceHolding(address: string): Promise<Holding> {
  cache.delete((address ?? '').toLowerCase());
  return readIceHolding(address);
}

/**
 * Verify the user controls `address` by checking a personal_sign signature over
 * the nonce we issued them. Prevents pasting a whale's address to fake a level.
 */
export function verifyWalletSignature(address: string, nonce: string, signature: string): boolean {
  if (!isEvmAddress(address) || !nonce || !signature) return false;
  try {
    const message = `IceBox wallet verification\nAddress: ${address}\nNonce: ${nonce}`;
    const recovered = ethers.verifyMessage(message, signature);
    return recovered.toLowerCase() === address.toLowerCase();
  } catch {
    return false;
  }
}

/** The message a user signs to prove wallet ownership (client builds the same). */
export function verificationMessage(address: string, nonce: string): string {
  return `IceBox wallet verification\nAddress: ${address}\nNonce: ${nonce}`;
}
