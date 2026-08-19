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
import type { MeResponse, Task, StakingResponse, DepositInfo, CheckinState } from './types';

interface Store {
  loading: boolean;
  error: string | null;
  me: MeResponse | null;
  tasks: Task[];
  staking: StakingResponse | null;
  deposit: DepositInfo | null;
  checkin: CheckinState | null;
  refreshAll: () => Promise<void>;
  refreshMe: () => Promise<void>;
  refreshTasks: () => Promise<void>;
  refreshStaking: () => Promise<void>;
  refreshDeposit: () => Promise<void>;
  refreshCheckin: () => Promise<void>;
  claimTask: (id: number) => Promise<{ reward: number; completed: boolean }>;
  stake: (tier: string, amount: number) => Promise<void>;
  claimStake: (id: number) => Promise<{ reward: number }>;
  unstake: (id: number) => Promise<{ payout: number; reward: number }>;
  claimCheckin: () => Promise<{ reward: number; streak: number }>;
}

const StoreContext = createContext<Store | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [me, setMe] = useState<MeResponse | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [staking, setStaking] = useState<StakingResponse | null>(null);
  const [deposit, setDeposit] = useState<DepositInfo | null>(null);
  const [checkin, setCheckin] = useState<CheckinState | null>(null);

  const refreshCheckin = useCallback(async () => {
    setCheckin(await api.checkin());
  }, []);

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

  // Fetched on demand (opening the Deposit sheet) — it triggers a Dextopus
  // reconcile, so we keep it off the initial load. Also refreshes `me` so a
  // just-credited deposit shows up in the balance.
  const refreshDeposit = useCallback(async () => {
    const res = await api.deposits();
    setDeposit(res);
    try {
      const me = await api.me();
      setMe(me);
    } catch {
      /* balance refresh is best-effort */
    }
  }, []);

  const refreshAll = useCallback(async () => {
    try {
      setError(null);
      await Promise.all([refreshMe(), refreshTasks(), refreshStaking(), refreshCheckin()]);
    } catch (e) {
      const msg =
        e instanceof ApiError
          ? e.status === 401
            ? 'Please open this app from inside Telegram.'
            : e.message
          : 'Something went wrong. Please try again.';
      setError(msg);
    }
  }, [refreshMe, refreshTasks, refreshStaking, refreshCheckin]);

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
      await api.stake(tier, amount);
      // Refresh both so the earned/deposited buckets stay in sync everywhere.
      await Promise.all([refreshMe(), refreshStaking()]);
    },
    [refreshMe, refreshStaking],
  );

  const claimStake = useCallback(
    async (id: number) => {
      const res = await api.claimStake(id);
      await Promise.all([refreshMe(), refreshStaking()]);
      return { reward: res.reward };
    },
    [refreshMe, refreshStaking],
  );

  const unstake = useCallback(
    async (id: number) => {
      const res = await api.unstake(id);
      await Promise.all([refreshMe(), refreshStaking()]);
      return { payout: res.payout, reward: res.reward };
    },
    [refreshMe, refreshStaking],
  );

  const claimCheckin = useCallback(async () => {
    const res = await api.claimCheckin();
    setCheckin(res.state);
    await refreshMe();
    return { reward: res.claimedReward, streak: res.streak };
  }, [refreshMe]);

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
      deposit,
      checkin,
      refreshAll,
      refreshMe,
      refreshTasks,
      refreshStaking,
      refreshDeposit,
      refreshCheckin,
      claimTask,
      stake,
      claimStake,
      unstake,
      claimCheckin,
    }),
    [
      loading,
      error,
      me,
      tasks,
      staking,
      deposit,
      checkin,
      refreshAll,
      refreshMe,
      refreshTasks,
      refreshStaking,
      refreshDeposit,
      refreshCheckin,
      claimTask,
      stake,
      claimStake,
      unstake,
      claimCheckin,
    ],
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): Store {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore must be used within StoreProvider');
  return ctx;
}
