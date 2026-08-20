import { Router } from 'express';
import { adminStats, isAdminTelegramId } from '../services/admin';

export const adminRouter = Router();

/** GET /api/admin/stats — operator dashboard. Admins only (ADMIN_TELEGRAM_IDS). */
adminRouter.get('/stats', async (req, res) => {
  const user = req.user!;
  if (!isAdminTelegramId(user.telegramId)) {
    return res.status(403).json({ error: 'forbidden', message: 'Admins only.' });
  }
  res.json(await adminStats());
});
