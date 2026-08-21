import { useEffect, useState } from 'react';
import { Sheet } from '../components/Sheet';
import { api, ApiError } from '../api';
import { usdt } from '../lib/format';
import type { AdminStats } from '../types';

function Stat({ label, value, sub, tint }: { label: string; value: string; sub?: string; tint?: string }) {
  return (
    <div className="card p-4">
      <div className="text-xs text-white/45">{label}</div>
      <div className={`mt-1 text-2xl font-extrabold ${tint ?? ''}`}>{value}</div>
      {sub && <div className="text-[11px] text-white/40">{sub}</div>}
    </div>
  );
}

export function AdminSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setStats(null);
    setError(null);
    api
      .adminStats()
      .then(setStats)
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Failed to load stats'));
  }, [open]);

  return (
    <Sheet open={open} onClose={onClose} title="Admin · Platform Stats">
      {error ? (
        <div className="py-10 text-center text-white/50">{error}</div>
      ) : !stats ? (
        <div className="py-10 text-center text-white/40">Loading…</div>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Stat label="Total users" value={stats.users.total.toLocaleString()} sub={`+${stats.users.newToday} today`} tint="text-ice-300" />
            <Stat label="Active miners" value={stats.mining.activeMiners.toLocaleString()} />
          </div>

          <p className="text-xs font-bold uppercase tracking-wide text-white/40">Money in</p>
          <div className="grid grid-cols-2 gap-3">
            <Stat label="Total deposited" value={`$${usdt(stats.deposits.totalUsd)}`} sub={`${stats.deposits.count} deposits`} tint="text-usdt" />
            <Stat label="Spent on hashrate" value={`$${usdt(stats.mining.spentUsd)}`} sub="mining buys" />
            <Stat label="Active staked" value={`$${usdt(stats.staking.activeStaked)}`} sub={`${stats.staking.activeCount} positions`} />
            <Stat label="Ref commission paid" value={`$${usdt(stats.referrals.depositCommissionPaid)}`} sub="7% / 3%" />
          </div>

          <p className="text-xs font-bold uppercase tracking-wide text-white/40">Money out</p>
          <div className="grid grid-cols-2 gap-3">
            <Stat label="USDT paid out" value={`$${usdt(stats.withdrawals.paidUsdt)}`} sub={`${stats.withdrawals.paidUsdtCount} withdrawals`} tint="text-usdt" />
            <Stat label="ICE token paid" value={usdt(stats.withdrawals.paidIce)} sub={`${stats.withdrawals.paidIceCount} withdrawals`} />
            <Stat label="Pending payouts" value={`$${usdt(stats.withdrawals.pendingUsd)}`} sub={`${stats.withdrawals.pendingCount} queued`} tint="text-amber-300" />
            <Stat label="ICE mined (lifetime)" value={usdt(stats.mining.minedIce)} sub="collected" />
          </div>

          <p className="text-xs font-bold uppercase tracking-wide text-white/40">Liabilities (balances held)</p>
          <div className="grid grid-cols-2 gap-3">
            <Stat label="Total balance" value={usdt(stats.balances.totalBalance)} sub="ICE" />
            <Stat label="Deposited bucket" value={usdt(stats.balances.depositedBucket)} sub="USDT-withdrawable" tint="text-usdt" />
            <Stat label="Earned bucket" value={usdt(stats.balances.earnedBalance)} sub="ICE-token only" tint="text-ice-300" />
            <Stat label="Total hashrate" value={stats.mining.totalHashrate.toLocaleString()} sub="GH/s" />
          </div>

          <p className="text-xs font-bold uppercase tracking-wide text-white/40">
            Daily mining rewards paid
          </p>
          <div className="grid grid-cols-2 gap-3">
            <Stat
              label="USDT rewards paid"
              value={`$${usdt(stats.miningRewards.usdtPaid)}`}
              sub={`${stats.miningRewards.usdtCount} payouts`}
              tint="text-usdt"
            />
            <Stat
              label="ICE rewards paid"
              value={usdt(stats.miningRewards.icePaid)}
              sub={`${stats.miningRewards.iceCount} payouts`}
              tint="text-ice-300"
            />
          </div>
          <p className="text-center text-[11px] text-white/40">
            {stats.miningRewards.lastPaidAt
              ? `Last distributed ${new Date(stats.miningRewards.lastPaidAt).toLocaleString()}`
              : 'No daily rewards distributed yet.'}
          </p>

          <div className="grid grid-cols-2 gap-3">
            <Stat label="Tasks completed" value={stats.tasks.completions.toLocaleString()} />
            <Stat label="Lifetime earned" value={usdt(stats.balances.lifetimeEarned)} sub="all users" />
          </div>

          <p className="text-center text-[11px] text-white/30">
            Updated {new Date(stats.generatedAt).toLocaleString()}
          </p>
          <button onClick={onClose} className="btn-ghost w-full py-3">
            Close
          </button>
        </div>
      )}
    </Sheet>
  );
}
