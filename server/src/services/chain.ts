import { ethers } from 'ethers';
import { config } from '../config';

/**
 * On-chain reads for holding-based mining. The connected wallet's ICE USD
 * balance sets the mining level, so we read balanceOf from the token contract
 * over the BSC RPC and convert to a USD value using the configured price.
 */

const ERC20_ABI = ['function balanceOf(address) view returns (uint256)'];

// PancakeSwap V2 + WBNB + Chainlink BNB/USD feed, all on BSC — used to read the
// live ICE price in USD straight from the pool so nothing needs a manual price.
const FACTORY_V2 = '0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73';
const WBNB = '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c';
const CHAINLINK_BNB_USD = '0x0567F2323251f0Aab15c8dFb1967E4e8A7D42aeE';

let provider: ethers.JsonRpcProvider | null = null;
function getProvider(): ethers.JsonRpcProvider {
  if (!provider) provider = new ethers.JsonRpcProvider(config.payout.rpcUrl);
  return provider;
}

// Live ICE price in USD, cached ~60s. Falls back to the configured price if the
// pool/feed can't be read (e.g. before liquidity exists).
let priceCache = { at: 0, usd: 0 };
export async function getIcePriceUsd(): Promise<number> {
  if (Date.now() - priceCache.at < 60_000 && priceCache.usd > 0) return priceCache.usd;
  try {
    const p = getProvider();
    const factory = new ethers.Contract(
      FACTORY_V2,
      ['function getPair(address,address) view returns (address)'],
      p,
    );
    const pair: string = await factory.getPair(config.token.address, WBNB);
    if (!pair || pair === ethers.ZeroAddress) throw new Error('no pair');
    const pc = new ethers.Contract(
      pair,
      [
        'function getReserves() view returns (uint112,uint112,uint32)',
        'function token0() view returns (address)',
      ],
      p,
    );
    const [r0, r1] = await pc.getReserves();
    const t0: string = await pc.token0();
    const iceIs0 = t0.toLowerCase() === config.token.address.toLowerCase();
    const iceRes = Number(ethers.formatUnits(iceIs0 ? r0 : r1, config.token.decimals));
    const bnbRes = Number(ethers.formatUnits(iceIs0 ? r1 : r0, 18));
    if (iceRes <= 0 || bnbRes <= 0) throw new Error('empty reserves');
    const iceInBnb = bnbRes / iceRes;
    const feed = new ethers.Contract(
      CHAINLINK_BNB_USD,
      ['function latestAnswer() view returns (int256)'],
      p,
    );
    const bnbUsd = Number(await feed.latestAnswer()) / 1e8;
    const usd = iceInBnb * bnbUsd;
    if (usd > 0 && Number.isFinite(usd)) priceCache = { at: Date.now(), usd };
  } catch {
    /* keep last good price, or fall back below */
  }
  return priceCache.usd > 0 ? priceCache.usd : config.miningLevels.price;
}

/**
 * Last known ICE price WITHOUT awaiting an RPC read — the value cached by
 * `getIcePriceUsd()`, or the configured fallback. Used in synchronous accrual
 * paths (e.g. mining rate) where we can't await; callers that need a fresh read
 * should `await getIcePriceUsd()` first (which refreshes this cache).
 */
export function lastIcePriceUsd(): number {
  return priceCache.usd > 0 ? priceCache.usd : config.miningLevels.price;
}

/**
 * Multiplier that turns a free-money reward into ICE tokens, scaled by price so
 * the ICE quantity divides by `divisorPer10x` for every 10x the price rises
 * above basePrice (and multiplies as it falls). Keeps free gifts from ballooning
 * in dollar value while still growing modestly. Fetch once before a transaction.
 */
export async function getEarnIceMultiplier(): Promise<number> {
  const { base, basePrice, divisorPer10x } = config.earnIce;
  const price = await getIcePriceUsd();
  if (!(price > 0) || !(basePrice > 0)) return base;
  // factor = (basePrice/price) ^ log10(divisorPer10x): at 10x price -> 1/divisor.
  const exp = Math.log10(divisorPer10x);
  const factor = Math.pow(basePrice / price, exp);
  return Math.max(0.0001, base * factor);
}

/** Is this a well-formed EVM address? */
export function isEvmAddress(addr: string | null | undefined): boolean {
  return !!addr && /^0x[a-fA-F0-9]{40}$/.test(addr);
}

export interface Holding {
  tokens: number; // ICE USD token amount held
  usd: number; // USD value of the holding (tokens * price)
}

// Short cache of the token balance so repeated reads don't hammer the RPC. The
// USD value is recomputed each call from the live price so it always tracks.
const cache = new Map<string, { at: number; tokens: number }>();
const TTL_MS = 30_000;

/** Read a wallet's on-chain ICE holding (token amount + live USD value). */
export async function readIceHolding(address: string): Promise<Holding> {
  if (!isEvmAddress(address)) return { tokens: 0, usd: 0 };
  const key = address.toLowerCase();
  let tokens: number;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) {
    tokens = hit.tokens;
  } else {
    const token = new ethers.Contract(config.token.address, ERC20_ABI, getProvider());
    const raw: bigint = await token.balanceOf(address);
    tokens = Number(ethers.formatUnits(raw, config.token.decimals));
    cache.set(key, { at: Date.now(), tokens });
  }
  const price = await getIcePriceUsd();
  const usd = Math.round(tokens * price * 1e4) / 1e4;
  return { tokens, usd };
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
