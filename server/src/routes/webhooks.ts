import type { Request, Response } from 'express';
import { config } from '../config';
import { verifyWebhook } from '../services/dextopus';
import { handleDepositWebhook } from '../services/deposits';

/**
 * Dextopus deposit webhook. Mounted BEFORE the global JSON parser with a raw
 * body parser, because HMAC-SHA256 must run over the exact bytes Dextopus
 * signed — a re-serialized JSON object would not match.
 *
 * GET is a health check; POST verifies the signature then credits the deposit.
 */
export async function dextopusWebhookHandler(req: Request, res: Response) {
  if (req.method === 'GET') {
    return res.json({
      ok: true,
      service: 'icebox-dextopus-webhook',
      hasSecret: Boolean(config.dextopus.webhookSecret),
    });
  }

  // With express.raw the body is a Buffer; fall back gracefully if it's a string.
  const rawBody = Buffer.isBuffer(req.body)
    ? req.body.toString('utf8')
    : typeof req.body === 'string'
      ? req.body
      : JSON.stringify(req.body ?? {});

  const signature =
    (req.headers['x-signature-sha256'] as string) ||
    (req.headers['x-dextopus-signature'] as string) ||
    (req.headers['x-webhook-signature'] as string) ||
    (req.headers['x-signature'] as string) ||
    null;
  const timestamp = (req.headers['x-signature-timestamp'] as string) || null;

  const verdict = verifyWebhook(rawBody, signature, timestamp);
  if (!verdict.ok) {
    // If no secret is set we refuse rather than credit blindly.
    console.error('[dextopus webhook] rejected:', verdict.reason);
    return res.status(401).json({ error: 'invalid_signature', reason: verdict.reason });
  }

  let event: any;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return res.status(400).json({ error: 'invalid_json' });
  }

  try {
    const result = await handleDepositWebhook(event);
    return res.json(result);
  } catch (e) {
    console.error('[dextopus webhook] handler error', e);
    return res.status(500).json({ error: 'handler_failed' });
  }
}
