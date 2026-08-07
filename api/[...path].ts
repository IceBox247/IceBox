import type { IncomingMessage, ServerResponse } from 'node:http';
import { createApp } from '../server/src/app';

// Single Express app reused across warm invocations of this serverless function.
const app = createApp();

/**
 * Vercel routes every `/api/*` request to this catch-all function. Vercel's
 * Node runtime passes the original URL (e.g. `/api/me`) as `req.url`, which the
 * Express app already routes on. We defensively re-add the `/api` prefix in the
 * unlikely event the platform strips it.
 */
export default function handler(req: IncomingMessage, res: ServerResponse) {
  if (req.url && !req.url.startsWith('/api')) {
    req.url = '/api' + (req.url === '/' ? '' : req.url);
  }
  return (app as unknown as (req: IncomingMessage, res: ServerResponse) => void)(req, res);
}
