// Thin, typed wrapper around the Telegram WebApp global injected by
// telegram-web-app.js. Falls back gracefully when running in a plain browser.

export interface TgWebApp {
  initData: string;
  initDataUnsafe: {
    user?: {
      id: number;
      first_name?: string;
      last_name?: string;
      username?: string;
      photo_url?: string;
    };
    start_param?: string;
  };
  colorScheme: 'light' | 'dark';
  themeParams: Record<string, string>;
  version: string;
  platform: string;
  ready(): void;
  expand(): void;
  close(): void;
  openLink(url: string, options?: { try_instant_view?: boolean }): void;
  openTelegramLink(url: string): void;
  setHeaderColor(color: string): void;
  setBackgroundColor(color: string): void;
  HapticFeedback?: {
    impactOccurred(style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft'): void;
    notificationOccurred(type: 'error' | 'success' | 'warning'): void;
    selectionChanged(): void;
  };
  showAlert(message: string, cb?: () => void): void;
  showPopup(
    params: { title?: string; message: string; buttons?: { id?: string; type?: string; text?: string }[] },
    cb?: (id: string) => void,
  ): void;
  MainButton: {
    setText(text: string): void;
    show(): void;
    hide(): void;
    onClick(cb: () => void): void;
    offClick(cb: () => void): void;
  };
}

declare global {
  interface Window {
    Telegram?: { WebApp?: TgWebApp };
  }
}

export const tg: TgWebApp | undefined = window.Telegram?.WebApp;

/** True when running inside a real Telegram client with signed initData. */
export const isTelegram = Boolean(tg && tg.initData && tg.initData.length > 0);

export function initTelegram() {
  if (!tg) return;
  try {
    tg.ready();
    tg.expand();
    tg.setHeaderColor('#05070d');
    tg.setBackgroundColor('#05070d');
  } catch {
    /* older clients may lack some methods */
  }
}

export function haptic(type: 'light' | 'medium' | 'heavy' | 'success' | 'error' | 'warning' = 'light') {
  const h = tg?.HapticFeedback;
  if (!h) return;
  try {
    if (type === 'success' || type === 'error' || type === 'warning') h.notificationOccurred(type);
    else h.impactOccurred(type);
  } catch {
    /* ignore */
  }
}

/** Open an external link the right way for Telegram vs browser. */
export function openLink(url: string) {
  if (tg) {
    if (url.startsWith('https://t.me') || url.startsWith('tg://')) tg.openTelegramLink(url);
    else tg.openLink(url);
  } else {
    window.open(url, '_blank', 'noopener');
  }
}

export function shareReferral(link: string, text: string) {
  const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text)}`;
  if (tg) tg.openTelegramLink(shareUrl);
  else window.open(shareUrl, '_blank', 'noopener');
}

/** The raw initData string sent to the backend for validation. */
export function getInitData(): string {
  return tg?.initData ?? '';
}
