import { Router } from 'express';
import crypto from 'crypto';
import { prisma, money } from '../db';
import { config } from '../config';
import {
  getOrCreateMiner,
  serializeMining,
  buyHashrate,
  collectMined,
  miningReferralCount,
  miningLeaderboard,
} from '../services/mining';
import { serializeLevelMining, syncMinerLevel, buyLevelInfo } from '../services/levels';
import {
  isEvmAddress,
  verifyWalletSignature,
  verificationMessage,
  getIcePriceUsd,
} from '../services/chain';

export const miningRouter = Router();

const levelModel = () => config.miningLevels.enabled;

/** Build the client mining state under whichever engine is active. */
async function currentState(userId: number) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const [miner, refs] = await Promise.all([
    getOrCreateMiner(userId),
    miningReferralCount(prisma, userId),
  ]);
  if (!levelModel()) return serializeMining(user, miner, refs);
  const price = await getIcePriceUsd();
  return serializeLevelMining(user, miner, refs, price);
}

/** GET /api/mining/leaderboard — top miners (by level or effective hashrate). */
miningRouter.get('/leaderboard', async (req, res) => {
  const user = req.user!;
  res.json(await miningLeaderboard(user.id));
});

/** GET /api/mining — the user's rig + config (auto-syncs level from chain). */
miningRouter.get('/', async (req, res) => {
  const user = req.user!;
  if (levelModel()) await syncMinerLevel(user.id).catch(() => {});
  res.json(await currentState(user.id));
});

/** POST /api/mining/refresh — force a fresh on-chain holding/level re-read. */
miningRouter.post('/refresh', async (req, res) => {
  const user = req.user!;
  if (levelModel()) await syncMinerLevel(user.id, { fresh: true }).catch(() => {});
  res.json({ ok: true, mining: await currentState(user.id) });
});

/**
 * POST /api/mining/wallet/nonce — issue a one-time nonce for the given address.
 * The user signs `verificationMessage(address, nonce)` to prove wallet control.
 */
miningRouter.post('/wallet/nonce', async (req, res) => {
  const user = req.user!;
  const address = String(req.body?.address ?? '').trim();
  if (!isEvmAddress(address)) {
    return res.status(400).json({ error: 'bad_address', message: 'Enter a valid BSC (0x…) address.' });
  }
  const nonce = crypto.randomBytes(16).toString('hex');
  await prisma.user.update({ where: { id: user.id }, data: { walletNonce: nonce } });
  res.json({ ok: true, address, nonce, message: verificationMessage(address, nonce) });
});

/**
 * POST /api/mining/wallet/connect { address, signature } — verify the signature
 * over the issued nonce, bind the wallet, and sync the level from its holding.
 */
miningRouter.post('/wallet/connect', async (req, res) => {
  const user = req.user!;
  const address = String(req.body?.address ?? '').trim();
  const signature = String(req.body?.signature ?? '').trim();
  const fresh = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
  if (!fresh.walletNonce) {
    return res.status(400).json({ error: 'no_nonce', message: 'Request a nonce first.' });
  }
  if (!verifyWalletSignature(address, fresh.walletNonce, signature)) {
    return res.status(400).json({ error: 'bad_signature', message: 'Signature did not match this wallet.' });
  }
  await prisma.user.update({
    where: { id: user.id },
    data: { walletAddress: address, walletVerifiedAt: new Date(), walletNonce: null },
  });
  await syncMinerLevel(user.id, { fresh: true }).catch(() => {});
  res.json({ ok: true, mining: await currentState(user.id) });
});

/** POST /api/mining/wallet/disconnect — unbind the wallet (level drops to 0). */
miningRouter.post('/wallet/disconnect', async (req, res) => {
  const user = req.user!;
  await prisma.user.update({
    where: { id: user.id },
    data: { walletAddress: null, walletVerifiedAt: null, walletNonce: null },
  });
  await syncMinerLevel(user.id, { fresh: true }).catch(() => {});
  res.json({ ok: true, mining: await currentState(user.id) });
});

/**
 * POST /api/mining/level/buy { level } — return exactly what it takes to reach a
 * chosen level and where to acquire the ICE USD (swap link once liquidity is on).
 */
miningRouter.post('/level/buy', async (req, res) => {
  const user = req.user!;
  if (!levelModel()) {
    return res.status(403).json({ error: 'not_level_model', message: 'Level mining is off.' });
  }
  const miner = await getOrCreateMiner(user.id);
  const target = Number(req.body?.level);
  if (!Number.isFinite(target) || target < 1) {
    return res.status(400).json({ error: 'invalid_level', message: 'Choose a valid level.' });
  }
  const price = await getIcePriceUsd();
  // Qualify on ASSETS = on-chain holding + pool wallet (earned + settled pending).
  const assetsUsd = miner.holdingUsd + (user.earnedBalance + miner.pending) * price;
  const info = buyLevelInfo(target, assetsUsd, price);
  const swapUrl = `${config.miningLevels.swapUrlBase}?chain=bsc&outputCurrency=${config.token.address}`;
  res.json({ ok: true, ...info, price, token: config.token.address, swapUrl });
});

/** POST /api/mining/buy { amount } — buy hashrate with deposited USD. */
miningRouter.post('/buy', async (req, res) => {
  const user = req.user!;
  if (levelModel()) {
    return res.status(403).json({
      error: 'level_model',
      message: 'Mining power now comes from your wallet holding — buy a level instead.',
    });
  }
  if (!config.mining.enabled) {
    return res.status(403).json({ error: 'mining_disabled', message: 'Mining is currently off.' });
  }
  const amount = money(Number(req.body?.amount));
  if (!Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({ error: 'invalid_amount', message: 'Enter a valid amount.' });
  }

  const result = await buyHashrate(user.id, amount);
  if ('error' in result) {
    if (result.error === 'below_minimum') {
      return res.status(400).json({
        error: 'below_minimum',
        minBuy: result.minBuy,
        message: `Minimum purchase is $${result.minBuy.toFixed(2)}.`,
      });
    }
    if (result.error === 'above_maximum') {
      return res.status(400).json({
        error: 'above_maximum',
        maxBuy: result.maxBuy,
        message: `Maximum single purchase is $${result.maxBuy.toFixed(2)}.`,
      });
    }
    if (result.error === 'max_rate_reached') {
      return res.status(400).json({
        error: 'max_rate_reached',
        capacityLeftPerDay: result.capacityLeftPerDay,
        message:
          result.capacityLeftPerDay > 0
            ? `You're near the max mining rate — only ${result.capacityLeftPerDay} ICE USD/day of capacity left.`
            : 'You have reached the maximum mining rate.',
      });
    }
    return res.status(400).json({
      error: 'insufficient_deposited',
      available: result.available,
      message: 'Not enough deposited USD. Only deposited USD can buy mining power.',
    });
  }
  const refs = await miningReferralCount(prisma, user.id);
  res.json({ ok: true, mining: serializeMining(result.user, result.miner, refs) });
});

/** POST /api/mining/collect — sweep mined ICE into the earned balance. */
miningRouter.post('/collect', async (req, res) => {
  const user = req.user!;
  const result = await collectMined(user.id);
  if (!result.ok) {
    return res.status(400).json({ error: 'nothing_to_collect', message: 'Nothing to collect yet.' });
  }
  res.json({ ok: true, collected: result.collected, mining: await currentState(user.id) });
});
