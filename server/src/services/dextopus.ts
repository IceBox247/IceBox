import crypto from 'node:crypto';
import { config } from '../config';

/**
 * Dextopus Swap API client (server side).
 *
 * Mirrors the request shapes used by the reference Sweepflow integration:
 *  - auth via the `x-api-key` header
 *  - a per-user *static* deposit address created once per (origin, settlement)
 *    tuple; the user sends USDT to it and Dextopus settles to the treasury
 *  - deposit status read back by userId
 *  - deposit webhooks signed HMAC-SHA256 over the raw body
 *
 * All amounts on the app side are USD; with `config.dextopus.rate` = 1 that is
 * exactly the settled USDT amount (1 USDT = 1 ICE USD).
 */

const base = () => config.dextopus.apiBase.replace(/\/$/, '');

function headers(extra: Record<string, string> = {}): Record<string, string> {
  return {
    ...(config.dextopus.apiKey ? { 'x-api-key': config.dextopus.apiKey } : {}),
    ...extra,
  };
}

export interface NormalizedDeposit {
  dextopusId: string | null;
  depositAddress: string | null;
  status: string;
  originAsset: string | null;
  originChainId: number | null;
  originAmount: number | null;
  originTxHash: string | null;
  settlementAmount: number | null;
  settlementTxHash: string | null;
  createdAt: string | number | null;
  completedAt: string | number | null;
}

/** Coerce one raw Dextopus deposit record into our normalized shape. */
export function normalizeDeposit(d: any): NormalizedDeposit {
  return {
    dextopusId: d?.depositId ?? d?.id ?? d?._id ?? null,
    depositAddress: d?.depositAddress ?? null,
    status: String(d?.status ?? '').toLowerCase(),
    originAsset: d?.originAsset ?? null,
    originChainId: d?.originChainId ?? null,
    originAmount: d?.originAmount != null ? Number(d.originAmount) : null,
    originTxHash: d?.originTxHash ?? null,
    settlementAmount:
      d?.settlementAmount != null
        ? Number(d.settlementAmount)
        : d?.destinationAmount != null
          ? Number(d.destinationAmount)
          : null,
    settlementTxHash: d?.settlementTxHash ?? d?.destinationTxHash ?? null,
    createdAt: d?.createdAt ?? null,
    completedAt: d?.completedAt ?? null,
  };
}

export interface CatalogToken {
  id: string;
  symbol: string;
  name: string;
  address: string | null;
  decimals: number;
  logoURI: string;
}

export interface CatalogChain {
  chainId: number;
  name: string;
  family: 'evm' | 'solana' | 'tron' | 'bitcoin';
  supportsStaticAddress: boolean;
  tokens: CatalogToken[];
}

const SOLANA_CHAIN_ID = 792703809;
const TRON_CHAIN_ID = 728126428;
const BITCOIN_CHAIN_ID = 8253038;

export function classifyFamily(chainId: number, name = ''): CatalogChain['family'] {
  if (chainId === SOLANA_CHAIN_ID) return 'solana';
  if (chainId === TRON_CHAIN_ID) return 'tron';
  if (chainId === BITCOIN_CHAIN_ID) return 'bitcoin';
  const n = String(name || '').toLowerCase();
  if (n.includes('solana')) return 'solana';
  if (n.includes('tron')) return 'tron';
  if (n.includes('bitcoin')) return 'bitcoin';
  return 'evm';
}

/**
 * The full deposit catalog: every chain + token a user can send from
 * (GET /api/deposit/tokens). Only chains flagged `supportsStaticAddress` can be
 * given a permanent per-user deposit address, so those are the ones we offer.
 */
export async function fetchDepositTokens(): Promise<CatalogChain[]> {
  const res = await fetch(`${base()}/api/deposit/tokens`, { headers: headers() });
  if (!res.ok) throw new Error(`Catalog request failed (${res.status})`);
  const data: any = await res.json().catch(() => ({}));
  const rawChains: any[] = Array.isArray(data?.chains) ? data.chains : Array.isArray(data) ? data : [];

  return rawChains
    .filter((c) => c?.disabled !== true && c?.depositEnabled !== false)
    .map((raw): CatalogChain => {
      const chainId = Number(raw.chainId ?? raw.id);
      const name = raw.name || raw.blockchain || '';
      // Sister lists carry logos that solverCurrencies may lack.
      const logoByAddr = new Map<string, string>();
      for (const t of [...(raw.featuredTokens || []), ...(raw.erc20Currencies || [])]) {
        const logo = t?.metadata?.logoURI;
        if (logo && t.address) logoByAddr.set(String(t.address).toLowerCase(), logo);
      }
      const tokens: CatalogToken[] = (raw.solverCurrencies || []).map((t: any) => {
        const addrKey = t.address ? String(t.address).toLowerCase() : null;
        return {
          id: t.id || String(t.symbol || '').toLowerCase(),
          symbol: t.symbol,
          name: t.name || t.symbol,
          address: t.address ?? null,
          decimals: t.decimals ?? 18,
          logoURI: (addrKey && logoByAddr.get(addrKey)) || t?.metadata?.logoURI || '',
        };
      });
      return {
        chainId,
        name,
        family: classifyFamily(chainId, name),
        supportsStaticAddress: raw.supportsStaticAddress !== false,
        tokens,
      };
    });
}

// Small in-process cache of the catalog so we can resolve token symbols ->
// contract addresses on every mint without hammering the API. 5-minute TTL.
let catalogCache: { at: number; chains: CatalogChain[] } | null = null;
async function cachedCatalog(): Promise<CatalogChain[]> {
  if (catalogCache && Date.now() - catalogCache.at < 5 * 60 * 1000) return catalogCache.chains;
  const chains = await fetchDepositTokens();
  catalogCache = { at: Date.now(), chains };
  return chains;
}

/**
 * Resolve a user-facing asset value (a symbol like "USDT", or an address) into
 * the identifier Dextopus expects for that chain — the token's contract address.
 * Dextopus rejects bare symbols ("Invalid input or output currency"), so we map
 * symbol -> address via the catalog. If the value already looks like an address,
 * or no catalog match is found (e.g. a native coin), it is returned unchanged.
 */
export async function resolveAsset(chainId: number, asset: string): Promise<string> {
  const val = String(asset || '').trim();
  if (!val) return val;
  try {
    const chains = await cachedCatalog();
    const chain = chains.find((c) => c.chainId === chainId);
    if (!chain) return val;
    const lower = val.toLowerCase();
    const match =
      chain.tokens.find((t) => t.address && t.address.toLowerCase() === lower) ||
      chain.tokens.find((t) => String(t.symbol || '').toLowerCase() === lower) ||
      chain.tokens.find((t) => String(t.id || '').toLowerCase() === lower);
    if (match?.address) return match.address;
    // Matched a native coin (no contract address) — keep its symbol.
    if (match) return match.symbol;
  } catch {
    // Catalog unavailable — fall through and send what we were given.
  }
  return val;
}

/**
 * Mint (or fetch) the static deposit address for this user + origin. Dextopus
 * returns the same address for the same (userId, origin, settlement) tuple, so
 * calling this repeatedly is safe and cheap. `origin` defaults to the
 * configured origin (USDT on BSC) when omitted.
 */
export async function createDepositAddress(
  userId: string,
  origin?: { chainId: number; asset: string },
): Promise<{ dextopusId: string | null; depositAddress: string }> {
  const originChainId = origin?.chainId ?? config.dextopus.originChainId;
  // Dextopus requires a refundTo and validates it against the SETTLEMENT chain
  // (where funds land), NOT the origin chain. Every deposit settles to our
  // single treasury on the settlement chain, so the refund address must be
  // valid on that chain's family for EVERY origin. Using an origin-family
  // address here (e.g. a Solana address for a Solana-origin deposit that still
  // settles to BSC/chain 56) is rejected as an "Invalid recipient address …
  // for chain 56". Pick the platform address for the SETTLEMENT family.
  const settlementFamily = classifyFamily(config.dextopus.settlementChainId, '');
  const refundTo =
    settlementFamily === 'solana'
      ? config.dextopus.refundSol
      : settlementFamily === 'tron'
        ? config.dextopus.refundTron
        : settlementFamily === 'bitcoin'
          ? config.dextopus.refundBtc
          : config.dextopus.refundEvm;

  // Fail fast with an operator-facing message when the settlement/refund address
  // doesn't match the settlement chain's family. The commonest misconfig: the
  // BSC (EVM, chain 56) settlement, but TREASURY_ADDRESS / REFUND_EVM was set to
  // a Solana/Tron address — Dextopus then rejects the mint with a confusing
  // "refund address is not a valid EVM address" error on every deposit.
  const isEvmAddr = (a: string) => /^0x[a-fA-F0-9]{40}$/.test(a);
  if (settlementFamily === 'evm') {
    if (!isEvmAddr(config.dextopus.treasuryAddress)) {
      throw new Error(
        `Deposit is misconfigured: TREASURY_ADDRESS must be an EVM (0x…) address for the ` +
          `chain ${config.dextopus.settlementChainId} settlement, but is "${config.dextopus.treasuryAddress}". ` +
          `Set it to your BSC wallet in Vercel.`,
      );
    }
    if (refundTo && !isEvmAddr(refundTo)) {
      throw new Error(
        `Deposit is misconfigured: the EVM refund address (REFUND_EVM, defaulting to ` +
          `TREASURY_ADDRESS) must be an EVM (0x…) address for chain ${config.dextopus.settlementChainId}, ` +
          `but is "${refundTo}". Set REFUND_EVM to your BSC wallet in Vercel.`,
      );
    }
  }

  // Dextopus wants the token's contract address, not its symbol, or it rejects
  // with "Invalid input or output currency". Resolve both sides via the catalog.
  const [originAsset, settlementAsset] = await Promise.all([
    resolveAsset(originChainId, origin?.asset ?? config.dextopus.originAsset),
    resolveAsset(config.dextopus.settlementChainId, config.dextopus.settlementAsset),
  ]);

  const payload: Record<string, unknown> = {
    userId,
    originChainId,
    originAsset,
    settlementChainId: config.dextopus.settlementChainId,
    settlementAsset,
    settlementAddress: config.dextopus.treasuryAddress,
    ...(refundTo ? { refundTo } : {}),
  };

  const res = await fetch(`${base()}/api/deposit/static/addresses`, {
    method: 'POST',
    headers: headers({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload),
  });
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok || data?.success === false) {
    throw new Error(data?.message || data?.error || `Address request failed (${res.status})`);
  }
  const depositAddress = data?.data?.depositAddress || data?.depositAddress;
  if (!depositAddress) throw new Error('No deposit address returned');
  return { dextopusId: data?.data?.id || data?.id || null, depositAddress };
}

export interface WithdrawalQuote {
  depositRequestId: string | null;
  depositAddress: string;
  amountOut: number | null;
  expiresInSeconds: number | null;
  isStaticAddress: boolean;
  raw: any;
}

/**
 * Create a withdrawal request (Dextopus "Create Deposit Request",
 * POST /api/deposit/quote). The platform then sends `amount` of the origin
 * asset from the treasury to the returned `depositAddress`; Dextopus converts
 * and delivers `destinationAsset` to `recipient` (the user's external wallet).
 *
 * `amount` is in the origin asset's smallest unit (e.g. 6-decimals USDT).
 * `dry: true` simulates and returns the expected `amountOut`/fees without
 * creating a live address.
 */
export async function createWithdrawalQuote(params: {
  originChainId: number;
  originAsset: string;
  destinationChainId: number;
  destinationAsset: string;
  amount: string; // smallest unit, as a decimal string
  recipient: string; // user's external wallet on the destination chain
  refundTo: string; // platform-controlled fallback address
  dry?: boolean;
}): Promise<WithdrawalQuote> {
  const body: Record<string, unknown> = {
    originChainId: params.originChainId,
    originAsset: params.originAsset,
    destinationChainId: params.destinationChainId,
    destinationAsset: params.destinationAsset,
    amount: params.amount,
    recipient: params.recipient,
    refundTo: params.refundTo,
    ...(params.dry ? { dry: true } : {}),
  };
  // Collect a partner fee (basis points) on every withdrawal, when configured.
  if (config.dextopus.partnerFeeBps > 0 && config.dextopus.partnerAddress) {
    body.partnerFees = [
      { recipient: config.dextopus.partnerAddress, feeBps: config.dextopus.partnerFeeBps },
    ];
  }

  const res = await fetch(`${base()}/api/deposit/quote`, {
    method: 'POST',
    headers: headers({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(body),
  });
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok || data?.success === false) {
    throw new Error(data?.message || data?.error || `Quote request failed (${res.status})`);
  }
  const d = data?.data ?? data;
  const depositAddress = d?.depositAddress || d?.address;
  if (!depositAddress) throw new Error('No deposit address returned from quote');
  return {
    depositRequestId: d?.depositRequestId || d?.requestId || d?.id || null,
    depositAddress,
    amountOut: d?.amountOut != null ? Number(d.amountOut) : null,
    expiresInSeconds: d?.expiresInSeconds != null ? Number(d.expiresInSeconds) : null,
    isStaticAddress: Boolean(d?.isStaticAddress),
    raw: data,
  };
}

/**
 * Poll a request's status (GET /api/deposit/status). Query by any of
 * depositRequestId / depositAddress / requestId. Returns both `status` and
 * `executionStatus` — check both, they move independently.
 */
export async function getRequestStatus(query: {
  depositRequestId?: string;
  depositAddress?: string;
  requestId?: string;
}): Promise<{
  status: string;
  executionStatus: string;
  destinationTxHashes: string[];
  raw: any;
} | null> {
  const params = new URLSearchParams();
  if (query.depositRequestId) params.set('depositRequestId', query.depositRequestId);
  if (query.depositAddress) params.set('depositAddress', query.depositAddress);
  if (query.requestId) params.set('requestId', query.requestId);
  const res = await fetch(`${base()}/api/deposit/status?${params}`, { headers: headers() });
  if (!res.ok) return null;
  const data: any = await res.json().catch(() => ({}));
  const d = data?.data ?? data;
  const hashes = d?.destinationTransactionHashes ?? d?.destinationTxHashes ?? [];
  return {
    status: String(d?.status ?? '').toLowerCase(),
    executionStatus: String(d?.executionStatus ?? '').toLowerCase(),
    destinationTxHashes: Array.isArray(hashes) ? hashes : [],
    raw: data,
  };
}

/** List this user's deposits (used to reconcile status by polling). */
export async function listDeposits(userId: string): Promise<NormalizedDeposit[]> {
  const params = new URLSearchParams({ userId });
  const res = await fetch(`${base()}/api/deposit/static/deposits?${params}`, {
    headers: headers(),
  });
  if (!res.ok) return [];
  const data: any = await res.json().catch(() => ({}));
  if (data?.success === false) return [];
  const list = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
  return list.map(normalizeDeposit);
}

/** HMAC-SHA256 hex of `body` under `secret`. */
export function hmacHex(secret: string, body: string): string {
  return crypto.createHmac('sha256', secret).update(body).digest('hex');
}

/** Constant-time compare of two hex strings. */
export function timingSafeEqualHex(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
  } catch {
    return false;
  }
}

/**
 * Verify a Dextopus webhook. Returns true when no secret is configured only if
 * `allowUnsigned` is set (never in production). The signature header may be
 * prefixed `sha256=`.
 */
export function verifyWebhook(
  rawBody: string,
  signature: string | null,
  timestamp: string | null,
): { ok: boolean; reason?: string } {
  const secret = config.dextopus.webhookSecret;
  if (!secret) {
    return { ok: false, reason: 'no_secret_configured' };
  }
  const sig = (signature ?? '').replace(/^sha256=/, '').trim();
  if (!sig) return { ok: false, reason: 'missing_signature' };
  const expected = hmacHex(secret, rawBody);
  if (!timingSafeEqualHex(sig, expected)) return { ok: false, reason: 'signature_mismatch' };
  // Optional freshness window (5 min) when a timestamp is provided.
  const ts = Number(timestamp);
  if (Number.isFinite(ts) && Math.abs(Date.now() - ts) > 5 * 60 * 1000) {
    return { ok: false, reason: 'stale_timestamp' };
  }
  return { ok: true };
}
