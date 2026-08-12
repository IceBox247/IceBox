import type { IncomingMessage, ServerResponse } from 'node:http';
import { createApp } from './app';

// Single Express app reused across warm invocations of the serverless function.
const app = createApp();

/**
 * Shared serverless entry point for the API + Telegram webhook.
 *
 * Two thin wrappers re-export this, one per possible Vercel "Root Directory"
 * setting: `api/index.ts` (repo root) and `server/api/index.ts` (server root).
 * Vercel only bundles functions found inside the configured root, so both exist
 * and the deploy works either way. The logic lives here so there is one copy.
 *
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
