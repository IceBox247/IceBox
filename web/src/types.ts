export interface PublicUser {
  id: number;
  telegramId: string;
  username: string | null;
  firstName: string | null;
  lastName: string | null;
  photoUrl: string | null;
  balance: number;
  earnedBalance: number;
  stakeable: number;
  totalEarned: number;
  referralCode: string;
}

export interface Overview {
  balance: number;
  totalEarned: number;
  available: number;
  totalReferrals: number;
  activeReferrals: number;
  tasksDone: number;
  totalStaked: number;
  earnedBalance: number;
  stakeable: number;
  usdRate: number;
}

export interface EarnedTier {
  enabled: boolean;
  key: string;
  name: string;
  blurb: string;
  minStake: number;
  apy: number;
  dailyRate: number;
  durationDays: number;
  accent: string;
}

export interface AppConfig {
  referralReward: number;
  minWithdrawal: number;
  minWithdrawalUsdt: number;
  botUsername: string;
  stakingEnabled: boolean;
  depositEnabled: boolean;
  minDeposit: number;
  withdrawEnabled: boolean;
  tokenLaunchAt?: string;
  tokenLaunchLabel?: string;
  tokenTradeUrl?: string;
}

export interface MeResponse {
  user: PublicUser;
  overview: Overview;
  config: AppConfig;
  referralLink: string;
}

export interface Task {
  id: number;
  key: string;
  title: string;
  subtitle: string;
  reward: number;
  actionType: 'join' | 'visit' | 'watch';
  actionLabel: string;
  url: string | null;
  icon: 'telegram' | 'globe' | 'play';
  waitSeconds: number;
  maxCount: number;
  count: number;
  completed: boolean;
}

export interface ClaimResult {
  ok: boolean;
  reward: number;
  count: number;
  completed: boolean;
  balance: number;
  totalEarned: number;
}

export interface ReferralStats {
  totalReferrals: number;
  activeReferrals: number;
  totalEarned: number;
}

export interface LeaderboardEntry {
  rank: number;
  name: string;
  photoUrl: string | null;
  referrals: number;
  prize: number;
  isMe: boolean;
}

export interface ReferralRow {
  id: number;
  name: string;
  photoUrl: string | null;
  active: boolean;
  joinedAt: string;
}

export interface ReferralCommission {
  level1Pct: number;
  level2Pct: number;
  level1: number;
  level2: number;
  total: number;
}

export interface ReferralsResponse {
  referralLink: string;
  referralCode: string;
  perInvite: number;
  stats: ReferralStats;
  commission: ReferralCommission;
  referrals: ReferralRow[];
  leaderboard: LeaderboardEntry[];
}

export interface Withdrawal {
  id: number;
  amount: number;
  address: string;
  network: string;
  token?: 'ice' | 'usdt';
  status: string;
  txHash?: string | null;
  createdAt: string;
}

export interface StakeTier {
  key: string;
  name: string;
  blurb: string;
  minStake: number;
  maxStake: number;
  apy: number;
  dailyRate: number;
  durationDays: number;
  accent: string;
}

export interface Stake {
  id: number;
  tier: string;
  kind: 'tier' | 'earned';
  principal: number;
  apy: number;
  dailyRate: number;
  lockDays: number;
  status: 'active' | 'unstaked';
  claimed: number;
  pending: number;
  claimable: boolean;
  startedAt: string;
  maturesAt: string;
  unstakedAt: string | null;
  matured: boolean;
}

export interface StakingSummary {
  totalStaked: number;
  totalPending: number;
  totalClaimed: number;
  activeCount: number;
}

export interface StakingResponse {
  enabled: boolean;
  balance: number;
  earnedBalance: number;
  stakeable: number;
  tiers: StakeTier[];
  earnedTier: EarnedTier;
  stakes: Stake[];
  summary: StakingSummary;
}

export interface CheckinState {
  enabled: boolean;
  canClaim: boolean;
  claimedToday: boolean;
  streak: number;
  nextStreak: number;
  reward: number;
  rewards: number[];
  nextClaimAt: string;
  asUsdt: boolean; // true = reward paid as USDT (user has staked funds)
}

export interface DepositRow {
  id: number;
  status: string;
  credited: boolean;
  amount: number;
  originAsset: string | null;
  originTxHash: string | null;
  createdAt: string;
}

export interface DepositInfo {
  enabled: boolean;
  minDeposit?: number;
  rate?: number;
  note?: string;
  message?: string;
  deposits: DepositRow[];
}

export interface FeaturedToken {
  chainId: number;
  chainName: string;
  family: string;
  symbol: string;
  name: string;
  asset: string;
  decimals: number;
  logoURI: string;
}

export interface CatalogToken {
  id: string;
  symbol: string;
  name: string;
  address: string | null;
  decimals: number;
  logoURI: string;
}

export interface CatalogChain {
  chainId: number;
  name: string;
  family: string;
  supportsStaticAddress: boolean;
  tokens: CatalogToken[];
}

export interface DepositCatalog {
  enabled: boolean;
  featured: FeaturedToken[];
  chains: CatalogChain[];
}

export interface DepositAddressInfo {
  address: string;
  originAsset: string;
  originChainId: number;
  minDeposit: number;
  rate: number;
  note?: string;
}
