export interface PublicUser {
  id: number;
  telegramId: string;
  username: string | null;
  firstName: string | null;
  lastName: string | null;
  photoUrl: string | null;
  balance: number;
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
  usdRate: number;
}

export interface AppConfig {
  referralReward: number;
  minWithdrawal: number;
  botUsername: string;
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

export interface ReferralsResponse {
  referralLink: string;
  referralCode: string;
  perInvite: number;
  stats: ReferralStats;
  referrals: ReferralRow[];
  leaderboard: LeaderboardEntry[];
}

export interface Withdrawal {
  id: number;
  amount: number;
  address: string;
  network: string;
  status: string;
  createdAt: string;
}
