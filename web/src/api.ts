import { getInitData } from './telegram';
import type {
  MeResponse,
  Task,
  ClaimResult,
  ReferralsResponse,
  Withdrawal,
  Stake,
  StakingResponse,
  DepositInfo,
  DepositRow,
  DepositCatalog,
  DepositAddressInfo,
  CheckinState,
  AnyMiningState,
  BuyLevelInfo,
  MiningLeaderboard,
  AdminStats,
} from './types';

const BASE = import.meta.env.VITE_API_BASE || '';

export class ApiError extends Error {
  status: number;
  code?: string;
  data?: any;
  constructor(status: number, message: string, data?: any) {
    super(message);
    this.status = status;
    this.code = data?.error;
    this.data = data;
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const initData = getInitData();
  const res = await fetch(`${BASE}/api${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      // Telegram Mini App auth: signed initData validated server-side.
      Authorization: `tma ${initData}`,
      'X-Telegram-Init-Data': initData,
      ...(options.headers || {}),
    },
  });

  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // Non-JSON response (Vercel error page, timeout, HTML). Surface it clearly
    // instead of throwing an opaque SyntaxError.
    const snippet = text.replace(/\s+/g, ' ').trim().slice(0, 60);
    throw new ApiError(res.status, `HTTP ${res.status} — ${snippet || 'no body'}`, {
      error: 'non_json',
    });
  }
  if (!res.ok) {
    throw new ApiError(res.status, data?.message || data?.error || res.statusText, data);
  }
  return data as T;
}

export const api = {
  me: () => request<MeResponse>('/me'),
  tasks: () => request<{ tasks: Task[] }>('/tasks'),
  claimTask: (id: number) =>
    request<ClaimResult>(`/tasks/${id}/claim`, { method: 'POST' }),
  referrals: () => request<ReferralsResponse>('/referrals'),
  withdrawals: () => request<{ withdrawals: Withdrawal[] }>('/withdrawals'),
  withdraw: (amount: number, address: string, network: string, token: 'ice' | 'usdt') =>
    request<{ ok: boolean; balance: number; earnedBalance: number; withdrawal: Withdrawal }>(
      '/withdrawals',
      {
        method: 'POST',
        body: JSON.stringify({ amount, address, network, token }),
      },
    ),
  staking: () => request<StakingResponse>('/staking'),
  stake: (tier: string, amount: number) =>
    request<{ ok: boolean; balance: number; stake: Stake }>('/staking/stake', {
      method: 'POST',
      body: JSON.stringify({ tier, amount }),
    }),
  claimStake: (id: number) =>
    request<{ ok: boolean; reward: number; balance: number; totalEarned: number; stake: Stake }>(
      `/staking/${id}/claim`,
      { method: 'POST' },
    ),
  unstake: (id: number) =>
    request<{
      ok: boolean;
      principal: number;
      reward: number;
      payout: number;
      balance: number;
      totalEarned: number;
      stake: Stake;
    }>(`/staking/${id}/unstake`, { method: 'POST' }),
  checkin: () => request<CheckinState>('/checkin'),
  claimCheckin: () =>
    request<{
      ok: boolean;
      claimedReward: number;
      streak: number;
      balance: number;
      earnedBalance: number;
      state: CheckinState;
    }>('/checkin/claim', { method: 'POST' }),
  deposits: () => request<DepositInfo>('/deposits'),
  depositTokens: () => request<DepositCatalog>('/deposits/tokens'),
  depositAddress: (chainId: number, asset: string) =>
    request<DepositAddressInfo>('/deposits/address', {
      method: 'POST',
      body: JSON.stringify({ chainId, asset }),
    }),
  refreshDeposits: () =>
    request<{ ok: boolean; deposits: DepositRow[] }>('/deposits/refresh', { method: 'POST' }),
  mining: () => request<AnyMiningState>('/mining'),
  refreshMiningChain: () =>
    request<{ ok: boolean; mining: AnyMiningState }>('/mining/refresh', { method: 'POST' }),
  buyHashrate: (amount: number) =>
    request<{ ok: boolean; mining: AnyMiningState }>('/mining/buy', {
      method: 'POST',
      body: JSON.stringify({ amount }),
    }),
  collectMining: () =>
    request<{ ok: boolean; collected: number; mining: AnyMiningState }>('/mining/collect', {
      method: 'POST',
    }),
  miningLeaderboard: () => request<MiningLeaderboard>('/mining/leaderboard'),
  // Holding-based level model.
  walletNonce: (address: string) =>
    request<{ ok: boolean; address: string; nonce: string; message: string }>(
      '/mining/wallet/nonce',
      { method: 'POST', body: JSON.stringify({ address }) },
    ),
  walletConnect: (address: string, signature: string) =>
    request<{ ok: boolean; mining: AnyMiningState }>('/mining/wallet/connect', {
      method: 'POST',
      body: JSON.stringify({ address, signature }),
    }),
  walletDisconnect: () =>
    request<{ ok: boolean; mining: AnyMiningState }>('/mining/wallet/disconnect', {
      method: 'POST',
    }),
  buyLevel: (level: number) =>
    request<BuyLevelInfo & { ok: boolean }>('/mining/level/buy', {
      method: 'POST',
      body: JSON.stringify({ level }),
    }),
  adminStats: () => request<AdminStats>('/admin/stats'),
};
