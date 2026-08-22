import { Router } from 'express';
import { prisma } from '../db';
import { isEvmAddress, verifyWalletSignature, verificationMessage } from '../services/chain';
import { syncMinerLevel } from '../services/levels';

/**
 * PUBLIC wallet-linking endpoints (mounted BEFORE Telegram auth). Used by the
 * standalone /connect.html page which the user opens INSIDE their wallet's dapp
 * browser — the only place a mobile wallet (MetaMask/Trust) will actually sign a
 * message. A one-time token (stored on the user as walletNonce) ties the browser
 * signature back to the right IceBox account without needing Telegram initData.
 */
export const walletLinkRouter = Router();

/** GET /api/wallet/link-info?token=&address= → the exact message to sign. */
walletLinkRouter.get('/link-info', async (req, res) => {
  const token = String(req.query.token ?? '');
  const address = String(req.query.address ?? '');
  if (!token || !isEvmAddress(address)) return res.status(400).json({ error: 'bad_request' });
  const user = await prisma.user.findFirst({ where: { walletNonce: token }, select: { id: true } });
  if (!user) return res.status(404).json({ error: 'invalid_or_expired' });
  res.json({ ok: true, message: verificationMessage(address, token) });
});

/** POST /api/wallet/link { token, address, signature } → verify + bind wallet. */
walletLinkRouter.post('/link', async (req, res) => {
  const token = String(req.body?.token ?? '');
  const address = String(req.body?.address ?? '').trim();
  const signature = String(req.body?.signature ?? '').trim();
  if (!token || !isEvmAddress(address) || signature.length < 10) {
    return res.status(400).json({ error: 'bad_request' });
  }
  const user = await prisma.user.findFirst({ where: { walletNonce: token } });
  if (!user) {
    return res.status(404).json({ error: 'invalid_or_expired', message: 'This link expired — start again in IceBox.' });
  }
  if (!verifyWalletSignature(address, token, signature)) {
    return res.status(400).json({ error: 'bad_signature', message: 'Signature did not match this wallet.' });
  }
  await prisma.user.update({
    where: { id: user.id },
    data: { walletAddress: address, walletVerifiedAt: new Date(), walletNonce: null },
  });
  await syncMinerLevel(user.id, { fresh: true }).catch(() => {});
  res.json({ ok: true, address });
});
