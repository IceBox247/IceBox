import type { IncomingMessage, ServerResponse } from 'node:http';
import { createApp } from '../server/src/app';

// Single Express app reused across warm invocations of this serverless function.
const app = createApp();

/**
 * All `/api/*` requests are rewritten to this function by vercel.json. Vercel
 * preserves the original URL (e.g. `/api/tasks/1/claim`) as `req.url`, which the
 * Express app routes on. We defensively re-add the `/api` prefix if the platform
 * ever strips it.
 */
export default function handler(req: IncomingMessage, res: ServerResponse) {
  if (req.url && !req.url.startsWith('/api')) {
    req.url = '/api' + (req.url === '/' ? '' : req.url);
  }
  return (app as unknown as (req: IncomingMessage, res: ServerResponse) => void)(req, res);
}
