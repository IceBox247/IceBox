// ─────────────────────────────────────────────────────────────────────────
//  IceBox public content — EDIT EVERYTHING HERE.
//  This one file powers the public Landing page and the in-app Whitepaper.
//  Change links, token facts and whitepaper copy here; nothing else to touch.
// ─────────────────────────────────────────────────────────────────────────

import { TOKEN } from '../brand';

/** All outbound links. Fill the ones marked TODO with your real URLs. */
export const LINKS = {
  website: 'https://www.iceboxminiapp.online',
  miniApp: 'https://t.me/IceBoxbot_bot?startapp',
  botUsername: '@IceBoxbot_bot',
  telegramChannel: 'https://t.me/Airdropverifiedupdate', // TODO: your announcements channel
  telegramGroup: 'https://t.me/IceBoxbot_bot', // TODO: your community chat/group
  twitter: 'https://x.com/', // TODO: your X/Twitter handle
  email: 'support@iceboxminiapp.online', // TODO: your support email
  // Auto-built from the token contract; adjust only if you change chains.
  swap: `https://pancakeswap.finance/swap?chain=bsc&outputCurrency=${TOKEN.contract}`,
  bscscan: `https://bscscan.com/token/${TOKEN.contract}`,
};

/** WalletConnect (Reown) project id — public client identifier, safe to ship.
 *  Add www.iceboxminiapp.online to the project's allowlist in the Reown dashboard. */
export const WALLETCONNECT_PROJECT_ID =
  (import.meta.env.VITE_WALLETCONNECT_PROJECT_ID as string) || '9098deb5d0662733d18992c5af3533b9';

/** Token facts shown on the landing + whitepaper. Adjust freely. */
export const TOKEN_FACTS = {
  name: TOKEN.name, // "ICE BOX"
  symbol: TOKEN.symbol, // "ICE"
  network: TOKEN.network, // "BSC (BEP-20)"
  contract: TOKEN.contract,
  // Leave as '' to hide a stat on the page. Fill when you have final numbers.
  maxSupply: '', // e.g. "1,000,000,000 ICE"
  mintDisabled: '', // e.g. "Minting renounced" — leave '' to hide
  teamHolding: '', // e.g. "Team holds 0%" — leave '' to hide
};

export interface WhitepaperSection {
  title: string;
  body: string; // plain paragraphs separated by blank lines
}

/** Whitepaper body — plain, adjustable copy. Add/remove/reorder sections. */
export const WHITEPAPER: WhitepaperSection[] = [
  {
    title: 'What is IceBox?',
    body: `IceBox is a Telegram-native crypto wallet and holding-based mining app built around ICE — its own token on ${TOKEN.network}. Users earn ICE by mining, completing tasks, inviting friends and checking in daily, and can hold, stake and withdraw their ICE.

Everything runs inside Telegram as a Mini App, with a clean, self-custodial path: your on-chain ICE stays in your own wallet, and the app rewards you for holding and taking part.`,
  },
  {
    title: 'Holding-Based Mining',
    body: `Your mining Level is set by how much ICE you hold — the more ICE in your connected wallet (plus what you've already earned in the app), the higher your Level and the faster you mine.

There are 1,000 Levels. Each Level mines ICE continuously into your Pool Wallet, which you can claim any time. Referrals who mine give you an extra daily boost. You never hand your capital to anyone — you simply connect a wallet and the app reads your on-chain balance to set your Level.`,
  },
  {
    title: 'A Fair, Price-Aware Reward Rate',
    body: `Free rewards (tasks, referrals, sign-up, check-ins) are credited in ICE tokens, and the mining rate is generous while ICE is young. As the ICE price appreciates, the reward rate automatically tapers so the economy stays sustainable — early participants are rewarded the most, and the emission naturally slows as value grows.`,
  },
  {
    title: 'Two-Currency Model',
    body: `IceBox keeps a clear line between deposited value and earned rewards. Deposits are handled in USDT and hold their real value; free rewards and mining are paid in ICE tokens. Staking lets you lock funds and earn daily. Withdrawals are available on both rails — ICE on-chain, and USDT for deposited/earned balances — so you always know exactly what you hold.`,
  },
  {
    title: 'Live On-Chain Price',
    body: `The ICE price shown across the app is read live from the on-chain liquidity pool, combined with a trusted price feed — not a number we type in. When you want to raise your Level, the app points you straight to a swap to buy more ICE into your own wallet.`,
  },
  {
    title: 'Transparency & Self-Custody',
    body: `ICE is a standard token on ${TOKEN.network} and is fully verifiable on-chain. Your holdings live in your own wallet; the app only reads your balance to compute your Level. The contract address is public and can be inspected on BscScan at any time.`,
  },
];
