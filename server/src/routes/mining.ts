import { Router } from 'express';
import { money } from '../db';
import { config } from '../config';
import { getOrCreateMiner, serializeMining, buyHashrate, collectMined } from '../services/mining';

export const miningRouter = Router();

/** GET /api/mining — the user's rig + config. */
miningRouter.get('/', async (req, res) => {
  const user = req.user!;
  const miner = await getOrCreateMiner(user.id);
  res.json(serializeMining(user, miner));
});

/** POST /api/mining/buy { amount } — buy hashrate with deposited USD. */
miningRouter.post('/buy', async (req, res) => {
  const user = req.user!;
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
  res.json({ ok: true, mining: serializeMining(result.user, result.miner) });
});

/** POST /api/mining/collect — sweep mined ICE into the earned balance. */
miningRouter.post('/collect', async (req, res) => {
  const user = req.user!;
  const result = await collectMined(user.id);
  if (!result.ok) {
    return res.status(400).json({ error: 'nothing_to_collect', message: 'Nothing to collect yet.' });
  }
  const miner = await getOrCreateMiner(user.id);
  res.json({ ok: true, collected: result.collected, mining: serializeMining(result.user, miner) });
});
