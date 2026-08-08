// Central place for the reward-token identity, so it's easy to change in one spot.
// ICE USD is IceBox's own reward token on BSC (BEP-20).
export const TOKEN = {
  name: 'ICE USD',
  symbol: 'USD',
  network: 'BSC (BEP-20)',
  contract: '0xb433b5263774d4b713BB78CfFaBE832c26C9ca9d',
};

// Bump this every deploy so we can confirm which build is actually live.
export const APP_VERSION = 'v9 · referrals';
