import type { Request, Response, NextFunction } from 'express';
import type { User } from '@prisma/client';
import { config } from '../config';
import { validateInitData, parseInitData } from '../telegram/initData';
import { findOrCreateUser } from '../services/users';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: User;
      startParam?: string;
    }
  }
}

/**
 * Authenticate a request using Telegram Mini App initData.
 * The client sends it in the `Authorization: tma <initData>` header
 * (or `X-Telegram-Init-Data`). We validate the HMAC, then find/create the user.
 */
export async function authenticate(req: Request, res: Response, next: NextFunction) {
  try {
    const header =
      req.header('authorization')?.replace(/^tma\s+/i, '') ??
      req.header('x-telegram-init-data') ??
      '';

    let parsed = header ? validateInitData(header, config.botToken) : null;

    // Dev escape hatch for browser testing without Telegram.
    if (!parsed && config.devAllowUnsigned && header) {
      parsed = parseInitData(new URLSearchParams(header));
    }
    if (!parsed && config.devAllowUnsigned && !header) {
      // Fabricate a stable dev user.
      parsed = {
        user: { id: 999_000_001, first_name: 'Dev', username: 'dev_tester' },
        start_param: (req.query.ref as string) || undefined,
        raw: new URLSearchParams(),
      };
    }

    if (!parsed?.user) {
      return res.status(401).json({ error: 'unauthorized', message: 'Invalid Telegram initData' });
    }

    const user = await findOrCreateUser(parsed.user, parsed.start_param);
    req.user = user;
    req.startParam = parsed.start_param;
    next();
  } catch (err) {
    console.error('auth error', err);
    res.status(500).json({ error: 'auth_failed' });
  }
}
