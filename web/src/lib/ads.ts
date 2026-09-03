// Rewarded-ad integration for Adsgram and Monetag. Each `showAd(provider)` loads
// the network's SDK on first use and resolves only when the ad actually completes
// (rewarded), so the task claim can be gated on a real ad view. IDs come from Vite
// build env: VITE_ADSGRAM_BLOCK_ID and VITE_MONETAG_ZONE_ID (set in Vercel).

export type AdProvider = 'adsgram' | 'monetag';

const ADSGRAM_BLOCK_ID = (import.meta.env.VITE_ADSGRAM_BLOCK_ID as string | undefined)?.trim() || '';
const MONETAG_ZONE_ID = (import.meta.env.VITE_MONETAG_ZONE_ID as string | undefined)?.trim() || '';

/** Whether a provider is configured (its id is present in the build env). */
export function adConfigured(provider: AdProvider): boolean {
  return provider === 'adsgram' ? !!ADSGRAM_BLOCK_ID : !!MONETAG_ZONE_ID;
}

// Load a script once, keyed by src; resolves when it has loaded.
const scriptPromises = new Map<string, Promise<void>>();
function loadScript(src: string, attrs: Record<string, string> = {}): Promise<void> {
  const key = src + JSON.stringify(attrs);
  const existing = scriptPromises.get(key);
  if (existing) return existing;
  const p = new Promise<void>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    for (const [k, v] of Object.entries(attrs)) s.setAttribute(k, v);
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Failed to load ad SDK'));
    document.head.appendChild(s);
  });
  scriptPromises.set(key, p);
  return p;
}

// --- Adsgram ---------------------------------------------------------------
let adsgramController: { show: () => Promise<unknown> } | null = null;
async function showAdsgram(): Promise<void> {
  if (!ADSGRAM_BLOCK_ID) throw new Error('Adsgram is not set up yet.');
  await loadScript('https://sad.adsgram.ai/js/sad.min.js');
  const Adsgram = (window as unknown as { Adsgram?: { init: (o: { blockId: string }) => { show: () => Promise<unknown> } } }).Adsgram;
  if (!Adsgram) throw new Error('Adsgram SDK unavailable.');
  if (!adsgramController) adsgramController = Adsgram.init({ blockId: ADSGRAM_BLOCK_ID });
  // Resolves when the user finishes the ad; rejects if skipped/closed early.
  await adsgramController.show();
}

// --- Monetag ---------------------------------------------------------------
async function showMonetag(): Promise<void> {
  if (!MONETAG_ZONE_ID) throw new Error('Monetag is not set up yet.');
  const fnName = `show_${MONETAG_ZONE_ID}`;
  await loadScript('https://libtl.com/sdk.js', { 'data-zone': MONETAG_ZONE_ID, 'data-sdk': fnName });
  const show = (window as unknown as Record<string, undefined | (() => Promise<unknown>)>)[fnName];
  if (typeof show !== 'function') throw new Error('Monetag SDK unavailable.');
  // Rewarded interstitial: resolves when watched to the end.
  await show();
}

/** Show a rewarded ad for the given network. Resolves only on full completion. */
export async function showAd(provider: AdProvider): Promise<void> {
  if (provider === 'adsgram') return showAdsgram();
  return showMonetag();
}
