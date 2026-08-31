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
  icePrice: number;
  tokenLaunchAt?: string;
  tokenLaunchLabel?: string;
  tokenTradeUrl?: string;
  isAdmin?: boolean;
  token?: {
    address: string;
    name: string;
    symbol: string;
    decimals: number;
    chainId: number;
    chainName: string;
    explorerBase: string;
  };
}

export interface ReferrerAuditInvitee {
  id: number;
  name: string;
  telegramId: string;
  joined: string;
  active: boolean;
  deposited: boolean;
  depositUsd: number;
  minedIce: number;
  hasPhoto: boolean;
  totalEarned: number;
}

export interface ReferrerAudit {
  found: boolean;
  referrer?: { id: number; name: string; telegramId: string; referralCode: string };
  total?: number;
  active?: number;
  withDeposit?: number;
  withPhoto?: number;
  zeroActivity?: number;
  signup?: { peakHour: string; peakInOneHour: number; distinctHours: number };
  signals?: { zeroActivityPct: number; noPhotoPct: number; burstConcentrationPct: number } | null;
  invited?: ReferrerAuditInvitee[];
  generatedAt?: string;
}

export interface AdminStats {
  users: { total: number; newToday: number };
  deposits: { totalUsd: number; count: number };
  withdrawals: {
    paidUsdt: number;
    paidUsdtCount: number;
    paidIce: number;
    paidIceCount: number;
    pendingCount: number;
    pendingUsd: number;
  };
  staking: { activeStaked: number; activeCount: number };
  mining: { spentUsd: number; minedIce: number; totalHashrate: number; activeMiners: number };
  balances: {
    totalBalance: number;
    earnedBalance: number;
    depositedBucket: number;
    lifetimeEarned: number;
  };
  referrals: { depositCommissionPaid: number };
  miningRewards: {
    usdtPaid: number;
    usdtCount: number;
    icePaid: number;
    iceCount: number;
    lastPaidAt: string | null;
  };
  tasks: { completions: number };
  generatedAt: string;
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

export interface MiningLevel {
  level: number;
  name: string;
  nextName: string | null;
  nextAtHash: number | null;
  progress: number;
}

export interface MiningLevelDef {
  name: string;
  minHash: number;
}

export interface MinerRankRow {
  rank: number;
  userId: number;
  name: string;
  photoUrl: string | null;
  hashrate: number;
  level: number;
  holdingUsd: number;
  totalMined: number;
  rewardIce: number;
  totalClaimed: number;
  rewardUsdt: number;
  totalClaimedUsdt: number;
  isMe: boolean;
}

export interface MiningLeaderboard {
  unit: string;
  leaderboard: MinerRankRow[];
}

export interface LevelMiningState {
  enabled: boolean;
  model: 'levels';
  name: string;
  unit: string;
  wallet: { address: string | null; verified: boolean };
  price: number;
  holding: { tokens: number; usd: number };
  pool: number;
  earnedBalance: number;
  level: number;
  speed: number;
  speedUnit: string;
  perDay: number;
  perHour: number;
  dailyBase: number;
  totalMined: number;
  curve: {
    count: number;
    minUsd: number;
    maxUsd: number;
    minYield: number;
    maxYield: number;
    minSpeed: number;
    maxSpeed: number;
    price: number;
  };
  referral: { miners: number; perRef: number; bonus: number };
  nextLevel: {
    level: number;
    requiredUsd: number;
    requiredTokens: number;
    missingUsd: number;
    missingTokens: number;
  } | null;
  swapUrlBase: string;
  rewards: {
    enabled: boolean;
    usdtPool: number;
    usdtTop: number;
    usdtPrizes: number[];
    icePool: number;
    iceTop: number;
  };
}

export interface AppNotification {
  id: number;
  kind: string;
  icon: string;
  title: string;
  detail: string;
  amount: number;
  token: 'ice' | 'usdt';
  at: string;
}

export interface NotificationsResponse {
  notifications: AppNotification[];
  unread: number;
  latestId: number;
}

export interface JourneyPoint {
  at: string;
  level: number;
  assetsUsd: number;
}

export interface MinerJourney {
  enabled: boolean;
  current: number;
  peak: number;
  assetsUsd: number;
  price: number;
  todayChangeUsd: number;
  todayChangePct: number;
  points: JourneyPoint[];
}

export interface BuyLevelInfo {
  level: number;
  requiredUsd: number;
  requiredTokens: number;
  yourUsd: number;
  yourTokens: number;
  missingUsd: number;
  missingTokens: number;
  price: number;
  token: string;
  swapUrl: string;
}

export type AnyMiningState = MiningState | LevelMiningState;

export interface MiningState {
  enabled: boolean;
  model: 'packages';
  name: string;
  unit: string;
  hashrate: number;
  boughtHashrate: number;
  referralHashrate: number;
  levels: MiningLevelDef[];
  pending: number;
  perHour: number;
  perDay: number;
  totalMined: number;
  totalSpent: number;
  level: MiningLevel;
  spendable: number;
  icePerHashDay: number;
  baseIcePerDay: number;
  maxIcePerDay: number;
  minBuy: number;
  maxBuy: number;
  minDay: number;
  yieldExp: number;
  referralMiners: number;
  referralBonusPerDay: number;
  referralBonus: number;
  rewards: {
    enabled: boolean;
    usdtPool: number;
    usdtTop: number;
    usdtPrizes: number[];
    icePool: number;
    iceTop: number;
  };
  capacityLeftPerDay: number;
  packages: { price: number; ice: number }[];
}

export interface DepositAddressInfo {
  address: string;
  originAsset: string;
  originChainId: number;
  minDeposit: number;
  rate: number;
  note?: string;
}
