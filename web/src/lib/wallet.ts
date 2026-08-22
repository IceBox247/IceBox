// Wallet helpers: one-tap connect+sign via an injected provider when present,
// and deep links that open a dapp URL INSIDE a mobile wallet's dapp browser
// (so PancakeSwap etc. open with the user's wallet, not a plain mobile browser
// where nothing is connected).

/** The injected EIP-1193 provider, if the app is running where one exists
 *  (a wallet's in-app dapp browser, or desktop with an extension). */
export function injectedProvider(): any | null {
  const eth = (window as any).ethereum;
  return eth && typeof eth.request === 'function' ? eth : null;
}

export function hasInjectedWallet(): boolean {
  return !!injectedProvider();
}

/**
 * One-tap connect + sign with the injected wallet: request the account, then
 * personal_sign the given message. Returns the address + signature to submit.
 */
export async function connectAndSign(message: string): Promise<{ address: string; signature: string }> {
  const eth = injectedProvider();
  if (!eth) throw new Error('no_injected');
  const accounts: string[] = await eth.request({ method: 'eth_requestAccounts' });
  const address = accounts?.[0];
  if (!address) throw new Error('no_account');
  // EIP-191 personal_sign — params are [message, address].
  const signature: string = await eth.request({ method: 'personal_sign', params: [message, address] });
  return { address, signature };
}

/** Just request/return the connected injected address (no signing). */
export async function requestInjectedAddress(): Promise<string> {
  const eth = injectedProvider();
  if (!eth) throw new Error('no_injected');
  const accounts: string[] = await eth.request({ method: 'eth_requestAccounts' });
  if (!accounts?.[0]) throw new Error('no_account');
  return accounts[0];
}

/**
 * WalletConnect one-tap: opens the user's wallet app (MetaMask, Trust,
 * TokenPocket…) via the WalletConnect modal/deep link, connects on BSC, signs
 * the verification message, and returns address + signature. Used inside
 * Telegram where there's no injected provider. The SDK is dynamically imported
 * so it only loads when a user actually connects.
 */
/** Which wallet to deep-link to, and how to wrap a WalletConnect URI for it. */
export interface WcWallet {
  key: string;
  label: string;
  icon: string;
  /** Build the wallet's universal link that opens it with a WC pairing URI. */
  wcLink: (uri: string) => string;
  /** Plain deep link to just bring the wallet to the foreground (for signing). */
  home: string;
}

export const WC_WALLETS: WcWallet[] = [
  {
    key: 'metamask',
    label: 'MetaMask',
    icon: '🦊',
    wcLink: (uri) => `https://metamask.app.link/wc?uri=${encodeURIComponent(uri)}`,
    home: 'https://metamask.app.link/',
  },
  {
    key: 'trust',
    label: 'Trust',
    icon: '🛡️',
    wcLink: (uri) => `https://link.trustwallet.com/wc?uri=${encodeURIComponent(uri)}`,
    home: 'https://link.trustwallet.com/',
  },
];

/** Open a URL from inside Telegram in a way that actually leaves the webview and
 *  reaches the wallet app (plain window.open is swallowed by Telegram). */
function openExternal(url: string) {
  const tg = (window as any).Telegram?.WebApp;
  try {
    if (tg?.openLink) {
      tg.openLink(url, { try_instant_view: false });
      return;
    }
  } catch {
    /* fall through */
  }
  window.open(url, '_blank');
}

/**
 * WalletConnect connect + sign, tuned for Telegram: we DON'T use WC's own modal
 * (its "Open" button can't hand off inside Telegram and just spins). Instead we
 * take the pairing URI ourselves and open the chosen wallet through Telegram's
 * link handler, which reliably launches the app. After approval the session
 * completes over the WC relay; we then re-open the wallet for the signature.
 */
export async function connectWalletConnect(
  getMessage: (address: string) => Promise<string>,
  target: WcWallet,
): Promise<{ address: string; signature: string }> {
  const { WALLETCONNECT_PROJECT_ID, LINKS } = await import('../content/site');
  const { EthereumProvider } = await import('@walletconnect/ethereum-provider');
  const provider = await EthereumProvider.init({
    projectId: WALLETCONNECT_PROJECT_ID,
    chains: [56], // BNB Smart Chain
    optionalChains: [56],
    showQrModal: false, // we drive the deep link ourselves (Telegram-safe)
    metadata: {
      name: 'IceBox',
      description: 'IceBox — hold ICE, mine ICE',
      url: LINKS.website,
      icons: [`${LINKS.website}/coin.png`],
    },
  });
  const onUri = (uri: string) => openExternal(target.wcLink(uri));
  provider.on('display_uri', onUri);
  try {
    await provider.connect(); // fires display_uri → opens the wallet app
    const address: string =
      (provider as any).accounts?.[0] ||
      ((await provider.request({ method: 'eth_accounts' })) as string[])?.[0];
    if (!address) throw new Error('no_account');
    const message = await getMessage(address);
    // Bring the wallet forward so the signature prompt is visible, then request.
    openExternal(target.home);
    const signature = (await provider.request({
      method: 'personal_sign',
      params: [message, address],
    })) as string;
    return { address, signature };
  } finally {
    try {
      provider.removeListener?.('display_uri', onUri);
    } catch {
      /* ignore */
    }
    try {
      await provider.disconnect();
    } catch {
      /* ignore */
    }
  }
}

export interface WalletLink {
  key: string;
  label: string;
  icon: string;
  href: string;
}

/**
 * Deep links that open `url` inside each wallet's built-in dapp browser, so the
 * page loads with that wallet connected. `url` must be a full https URL.
 */
export function walletDeepLinks(url: string): WalletLink[] {
  const noScheme = url.replace(/^https?:\/\//, '');
  const encoded = encodeURIComponent(url);
  return [
    {
      key: 'metamask',
      label: 'MetaMask',
      icon: '🦊',
      href: `https://metamask.app.link/dapp/${noScheme}`,
    },
    {
      key: 'trust',
      label: 'Trust',
      icon: '🛡️',
      href: `https://link.trustwallet.com/open_url?url=${encoded}`,
    },
    {
      key: 'tokenpocket',
      label: 'TokenPocket',
      icon: '🅣',
      href: `tpdapp://open?params=${encodeURIComponent(
        JSON.stringify({ url, chain: 'BSC', dappName: 'IceBox' }),
      )}`,
    },
  ];
}
