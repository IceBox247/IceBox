import { Router } from 'express';
import { prisma } from '../db';
import { submitVerification, checkVerification } from '../services/verifyContract';

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
 * POST /api/tokens/logo — set a token's logo (owner only).
 * Body: { chainId, address, creator, logo }  where logo is a data URL.
 */
tokensRouter.post('/logo', async (req, res) => {
  try {
    const b = req.body ?? {};
    if (!isAddress(b.address) || !isAddress(b.creator)) {
      return res.status(400).json({ error: 'invalid_address' });
    }
    const chainId = Number(b.chainId);
    const logo = String(b.logo ?? '');
    if (!/^data:image\/(png|jpeg|jpg|webp|gif);base64,/.test(logo)) {
      return res.status(400).json({ error: 'invalid_image' });
    }
    if (logo.length > 400_000) {
      return res.status(413).json({ error: 'image_too_large', message: 'Logo must be under ~300KB.' });
    }
    const existing = await prisma.createdToken.findUnique({
      where: { chainId_address: { chainId, address: b.address } },
    });
    if (!existing) return res.status(404).json({ error: 'token_not_found' });
    if (existing.creator.toLowerCase() !== (b.creator as string).toLowerCase()) {
      return res.status(403).json({ error: 'not_owner' });
    }
    await prisma.createdToken.update({
      where: { id: existing.id },
      data: { logoUrl: logo },
    });
    res.json({ ok: true });
  } catch (err) {
    console.error('logo error', err);
    res.status(500).json({ error: 'logo_failed' });
  }
});

/** GET /api/tokens/:chainId/:address/logo — serve a token's logo image. */
tokensRouter.get('/:chainId/:address/logo', async (req, res) => {
  const chainId = Number(req.params.chainId);
  const address = req.params.address;
  const row = await prisma.createdToken.findUnique({
    where: { chainId_address: { chainId, address } },
  });
  if (!row?.logoUrl) return res.status(404).end();
  const m = /^data:(image\/[a-z]+);base64,(.*)$/i.exec(row.logoUrl);
  if (!m) return res.status(404).end();
  res.setHeader('Content-Type', m[1]);
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.end(Buffer.from(m[2], 'base64'));
});

/**
 * GET /api/tokens/list.json — Uniswap-style token list of IceBox tokens
 * that have a logo. Import this URL in PancakeSwap/wallets to show logos.
 */
tokensRouter.get('/list.json', async (req, res) => {
  const origin = `${req.protocol}://${req.get('host')}`;
  const rows = await prisma.createdToken.findMany({
    where: { logoUrl: { not: null } },
    orderBy: { createdAt: 'desc' },
    take: 1000,
  });
  res.json({
    name: 'IceBox Token List',
    timestamp: new Date().toISOString(),
    version: { major: 1, minor: 0, patch: 0 },
    tokens: rows.map((t) => ({
      chainId: t.chainId,
      address: t.address,
      name: t.name,
      symbol: t.symbol,
      decimals: t.decimals,
      logoURI: `${origin}/api/tokens/${t.chainId}/${t.address}/logo`,
    })),
  });
});

/**
 * POST /api/tokens/verify — auto-verify an IceBox-created token on BscScan.
 * Body: { chainId, address, buyTaxBps?, sellTaxBps?, taxWallet? }.
 * Reconstructs the exact source + constructor args from our registry and submits.
 */
tokensRouter.post('/verify', async (req, res) => {
  try {
    const b = req.body ?? {};
    if (!isAddress(b.address)) return res.status(400).json({ error: 'invalid_address' });
    const chainId = Number(b.chainId);
    if (chainId !== 56) {
      return res.status(400).json({ error: 'unsupported_chain', message: 'Auto-verify supports BNB Smart Chain (BSC) tokens.' });
    }
    const row = await prisma.createdToken.findUnique({
      where: { chainId_address: { chainId, address: b.address } },
    });
    if (!row) {
      return res.status(404).json({ error: 'not_found', message: 'This token was not created with the IceBox tool, so we can’t auto-verify it.' });
    }
    if (row.taxed && (b.buyTaxBps == null || b.sellTaxBps == null || !isAddress(b.taxWallet))) {
      return res.status(400).json({
        error: 'tax_params_required',
        message: 'For a tax token, provide the buy/sell tax (bps) and tax wallet used at creation.',
      });
    }
    const result = await submitVerification({
      address: row.address,
      name: row.name,
      symbol: row.symbol,
      decimals: row.decimals,
      supply: row.supply,
      taxed: row.taxed,
      creator: row.creator,
      buyTaxBps: b.buyTaxBps != null ? Number(b.buyTaxBps) : undefined,
      sellTaxBps: b.sellTaxBps != null ? Number(b.sellTaxBps) : undefined,
      taxWallet: typeof b.taxWallet === 'string' ? b.taxWallet : undefined,
    });
    res.json(result);
  } catch (err) {
    console.error('verify error', err);
    res.status(500).json({ error: 'verify_failed', message: 'Could not submit verification.' });
  }
});

/** GET /api/tokens/verify-status?guid=... — poll a submitted verification. */
tokensRouter.get('/verify-status', async (req, res) => {
  const guid = String(req.query.guid ?? '');
  if (!guid) return res.status(400).json({ error: 'missing_guid' });
  try {
    res.json(await checkVerification(guid));
  } catch (err) {
    console.error('verify-status error', err);
    res.status(500).json({ error: 'status_failed' });
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
