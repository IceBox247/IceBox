import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { api, ApiError } from './api';
import type { MeResponse, Task, StakingResponse } from './types';

interface Store {
  loading: boolean;
  error: string | null;
  me: MeResponse | null;
  tasks: Task[];
  staking: StakingResponse | null;
  refreshAll: () => Promise<void>;
  refreshMe: () => Promise<void>;
  refreshTasks: () => Promise<void>;
  refreshStaking: () => Promise<void>;
  claimTask: (id: number) => Promise<{ reward: number; completed: boolean }>;
  stake: (tier: string, amount: number) => Promise<void>;
  claimStake: (id: number) => Promise<{ reward: number }>;
  unstake: (id: number) => Promise<{ payout: number; reward: number }>;
}

const StoreContext = createContext<Store | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [me, setMe] = useState<MeResponse | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [staking, setStaking] = useState<StakingResponse | null>(null);

  const refreshMe = useCallback(async () => {
    const res = await api.me();
    setMe(res);
  }, []);

  const refreshTasks = useCallback(async () => {
    const res = await api.tasks();
    setTasks(res.tasks);
  }, []);

  const refreshStaking = useCallback(async () => {
    const res = await api.staking();
    setStaking(res);
  }, []);

  /** Patch the cached balance/totalEarned into `me` after a staking action. */
  const patchBalance = useCallback((balance: number, totalEarned?: number) => {
    setMe((prev) =>
      prev
        ? {
            ...prev,
            user: {
              ...prev.user,
              balance,
              totalEarned: totalEarned ?? prev.user.totalEarned,
            },
            overview: {
              ...prev.overview,
              balance,
              available: balance,
              totalEarned: totalEarned ?? prev.overview.totalEarned,
            },
          }
        : prev,
    );
  }, []);

  const refreshAll = useCallback(async () => {
    try {
      setError(null);
      await Promise.all([refreshMe(), refreshTasks(), refreshStaking()]);
    } catch (e) {
      const msg =
        e instanceof ApiError
          ? e.status === 401
            ? 'Please open this app from inside Telegram.'
            : e.message
          : 'Something went wrong. Please try again.';
      setError(msg);
    }
  }, [refreshMe, refreshTasks]);

  const claimTask = useCallback(async (id: number) => {
    // Throws ApiError on failure so the caller can surface the real reason.
    const res = await api.claimTask(id);
    // Update local state from the authoritative response.
    setTasks((prev) =>
      prev.map((t) => (t.id === id ? { ...t, count: res.count, completed: res.completed } : t)),
    );
    setMe((prev) =>
      prev
        ? {
            ...prev,
            user: { ...prev.user, balance: res.balance, totalEarned: res.totalEarned },
            overview: {
              ...prev.overview,
              balance: res.balance,
              available: res.balance,
              totalEarned: res.totalEarned,
              tasksDone: prev.overview.tasksDone + (res.completed ? 1 : 0),
            },
          }
        : prev,
    );
    return { reward: res.reward, completed: res.completed };
  }, []);

  const stake = useCallback(
    async (tier: string, amount: number) => {
      const res = await api.stake(tier, amount);
      patchBalance(res.balance);
      await refreshStaking();
    },
    [patchBalance, refreshStaking],
  );

  const claimStake = useCallback(
    async (id: number) => {
      const res = await api.claimStake(id);
      patchBalance(res.balance, res.totalEarned);
      await refreshStaking();
      return { reward: res.reward };
    },
    [patchBalance, refreshStaking],
  );

  const unstake = useCallback(
    async (id: number) => {
      const res = await api.unstake(id);
      patchBalance(res.balance, res.totalEarned);
      await refreshStaking();
      return { payout: res.payout, reward: res.reward };
    },
    [patchBalance, refreshStaking],
  );

  useEffect(() => {
    (async () => {
      setLoading(true);
      await refreshAll();
      setLoading(false);
    })();
  }, [refreshAll]);

  const value = useMemo<Store>(
    () => ({
      loading,
      error,
      me,
      tasks,
      staking,
      refreshAll,
      refreshMe,
      refreshTasks,
      refreshStaking,
      claimTask,
      stake,
      claimStake,
      unstake,
    }),
    [
      loading,
      error,
      me,
      tasks,
      staking,
      refreshAll,
      refreshMe,
      refreshTasks,
      refreshStaking,
      claimTask,
      stake,
      claimStake,
      unstake,
    ],
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): Store {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore must be used within StoreProvider');
  return ctx;
}
