import { Router } from 'express';
import { adminStats, lookupUser, auditReferrer, isAdminTelegramId } from '../services/admin';

export const adminRouter = Router();

/** GET /api/admin/stats — operator dashboard. Admins only (ADMIN_TELEGRAM_IDS). */
adminRouter.get('/stats', async (req, res) => {
  const user = req.user!;
  if (!isAdminTelegramId(user.telegramId)) {
    return res.status(403).json({ error: 'forbidden', message: 'Admins only.' });
  }
  res.json(await adminStats());
});

/** GET /api/admin/user?query=… — inspect a user. Admins only. */
adminRouter.get('/user', async (req, res) => {
  const user = req.user!;
  if (!isAdminTelegramId(user.telegramId)) {
    return res.status(403).json({ error: 'forbidden', message: 'Admins only.' });
  }
  res.json(await lookupUser(String(req.query.query ?? '')));
});

/** GET /api/admin/referrer?query=… — audit a referrer's invitees. Admins only. */
adminRouter.get('/referrer', async (req, res) => {
  const user = req.user!;
  if (!isAdminTelegramId(user.telegramId)) {
    return res.status(403).json({ error: 'forbidden', message: 'Admins only.' });
  }
  res.json(await auditReferrer(String(req.query.query ?? '')));
});
