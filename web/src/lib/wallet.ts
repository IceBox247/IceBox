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
