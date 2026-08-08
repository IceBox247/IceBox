import { Router } from 'express';
import { prisma } from '../db';

export const tokensRouter = Router();

// Public routes (no Telegram auth) — used by the wallet-browser creator pages.

const isAddress = (v: unknown): v is string =>
  typeof v === 'string' && /^0x[a-fA-F0-9]{40}$/.test(v);

/**
 * POST /api/tokens — record a token created via the IceBox factory.
 * Body: { chainId, address, creator, name, symbol, decimals, supply, taxed, txHash }
 * Best-effort registry; deduped by (chainId, address).
 */
tokensRouter.post('/', async (req, res) => {
  try {
    const b = req.body ?? {};
    if (!isAddress(b.address) || !isAddress(b.creator)) {
      return res.status(400).json({ error: 'invalid_address' });
    }
    const chainId = Number(b.chainId);
    if (!Number.isInteger(chainId) || chainId <= 0) {
      return res.status(400).json({ error: 'invalid_chain' });
    }
    const name = String(b.name ?? '').slice(0, 64);
    const symbol = String(b.symbol ?? '').slice(0, 32);
    const decimals = Number.isInteger(Number(b.decimals)) ? Number(b.decimals) : 18;
    const supply = String(b.supply ?? '0').replace(/[^0-9]/g, '').slice(0, 40) || '0';
    const taxed = Boolean(b.taxed);
    const txHash = typeof b.txHash === 'string' ? b.txHash.slice(0, 80) : null;
    const address = (b.address as string);
    const creator = (b.creator as string).toLowerCase();

    const row = await prisma.createdToken.upsert({
      where: { chainId_address: { chainId, address } },
      update: { name, symbol, decimals, supply, taxed, txHash },
      create: { chainId, address, creator, name, symbol, decimals, supply, taxed, txHash },
    });
    res.json({ ok: true, id: row.id });
  } catch (err) {
    console.error('token record error', err);
    res.status(500).json({ error: 'record_failed' });
  }
});

/**
 * GET /api/tokens?owner=0x...&chainId=56
 * List tokens created by a wallet, newest first.
 */
tokensRouter.get('/', async (req, res) => {
  const owner = String(req.query.owner ?? '');
  if (!isAddress(owner)) return res.status(400).json({ error: 'invalid_owner' });
  const where: { creator: string; chainId?: number } = { creator: owner.toLowerCase() };
  const chainId = Number(req.query.chainId);
  if (Number.isInteger(chainId) && chainId > 0) where.chainId = chainId;

  const tokens = await prisma.createdToken.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: 200,
  });
  res.json({
    tokens: tokens.map((t) => ({
      chainId: t.chainId,
      address: t.address,
      name: t.name,
      symbol: t.symbol,
      decimals: t.decimals,
      supply: t.supply,
      taxed: t.taxed,
      logoUrl: t.logoUrl,
      txHash: t.txHash,
      createdAt: t.createdAt,
    })),
  });
});
