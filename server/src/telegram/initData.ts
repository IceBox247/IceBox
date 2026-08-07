import crypto from 'node:crypto';

export interface TelegramUser {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  language_code?: string;
}

export interface ParsedInitData {
  user?: TelegramUser;
  start_param?: string;
  auth_date?: number;
  hash?: string;
  raw: URLSearchParams;
}

/**
 * Validate a Telegram Mini App `initData` string per the official algorithm:
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 *
 * secret_key = HMAC_SHA256(bot_token, "WebAppData")
 * check_hash = HMAC_SHA256(data_check_string, secret_key)
 * where data_check_string is all fields except `hash`, sorted by key, joined by "\n".
 *
 * Returns the parsed data if valid, otherwise null.
 */
export function validateInitData(
  initData: string,
  botToken: string,
  maxAgeSeconds = 86_400,
): ParsedInitData | null {
  if (!initData || !botToken) return null;

  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return null;

  // Build data_check_string from every field except `hash`.
  const pairs: string[] = [];
  for (const [key, value] of params.entries()) {
    if (key === 'hash') continue;
    pairs.push(`${key}=${value}`);
  }
  pairs.sort();
  const dataCheckString = pairs.join('\n');

  const secretKey = crypto
    .createHmac('sha256', 'WebAppData')
    .update(botToken)
    .digest();
  const computedHash = crypto
    .createHmac('sha256', secretKey)
    .update(dataCheckString)
    .digest('hex');

  // Constant-time comparison.
  const a = Buffer.from(computedHash, 'hex');
  const b = Buffer.from(hash, 'hex');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  // Reject stale payloads to limit replay.
  const authDate = Number(params.get('auth_date') ?? 0);
  if (maxAgeSeconds > 0 && authDate > 0) {
    const age = Math.floor(Date.now() / 1000) - authDate;
    if (age > maxAgeSeconds) return null;
  }

  return parseInitData(params);
}

/** Parse an initData URLSearchParams into a typed object (no validation). */
export function parseInitData(params: URLSearchParams): ParsedInitData {
  let user: TelegramUser | undefined;
  const userRaw = params.get('user');
  if (userRaw) {
    try {
      user = JSON.parse(userRaw) as TelegramUser;
    } catch {
      user = undefined;
    }
  }
  return {
    user,
    start_param: params.get('start_param') ?? undefined,
    auth_date: params.get('auth_date') ? Number(params.get('auth_date')) : undefined,
    hash: params.get('hash') ?? undefined,
    raw: params,
  };
}
