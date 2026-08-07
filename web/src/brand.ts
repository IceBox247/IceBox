// Central place for the reward-token identity, so it's easy to change in one spot.
// ICE USD is IceBox's own reward token on BSC (BEP-20).
export const TOKEN = {
  name: 'ICE USD',
  symbol: 'USD',
  network: 'BSC (BEP-20)',
  contract: '0xCe6dB0f7c5B4D9fd75C2CbD65D71Ca65cAD88888',
};

// Bump this every deploy so we can confirm which build is actually live.
export const APP_VERSION = 'v6 · verify+cache';
