// Central place for the reward-token identity, so it's easy to change in one spot.
// ICE USD is IceBox's own reward token on BSC (BEP-20).
export const TOKEN = {
  name: 'ICE BOX',
  symbol: 'ICE',
  network: 'BSC (BEP-20)',
  contract: '0x4BDBDfF5e883b7fBE3b5Bc33ec33E4FC17774eD4',
};

// Bump this every deploy so we can confirm which build is actually live.
export const APP_VERSION = 'v10 · ICE token';
