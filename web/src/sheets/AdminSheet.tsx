import { useEffect, useState } from 'react';
import { Sheet } from '../components/Sheet';
import { api, ApiError } from '../api';
import { usdt } from '../lib/format';
import type { AdminStats, ReferrerAudit } from '../types';

/** Type a referrer's name/code/id and see whether their invitees look real. */
function ReferrerCheck() {
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [res, setRes] = useState<ReferrerAudit | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function run() {
    if (!query.trim()) return;
    setLoading(true);
    setErr(null);
    setRes(null);
    try {
      setRes(await api.adminReferrer(query.trim()));
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Lookup failed');
    }
    setLoading(false);
  }

  const fake =
    res?.signals &&
    res.signals.zeroActivityPct >= 70 &&
    res.signals.burstConcentrationPct >= 50;

  return (
    <div className="card space-y-3 p-4">
      <div className="text-sm font-bold text-white/80">Check a referrer</div>
      <div className="flex gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && run()}
          placeholder="Name, referral code, or user id"
          className="min-w-0 flex-1 rounded-xl bg-white/5 px-3 py-2 text-sm outline-none"
        />
        <button onClick={run} disabled={loading} className="btn-primary px-4 text-sm">
          {loading ? '…' : 'Check'}
        </button>
      </div>
      {err && <div className="text-[12px] text-red-300">{err}</div>}
      {res && !res.found && <div className="text-[12px] text-white/50">No referrer matched that.</div>}
      {res && res.found && res.referrer && (
        <div className="space-y-2">
          <div className="text-sm">
            <b>{res.referrer.name}</b>{' '}
            <span className="text-white/40">· {res.total} referrals</span>
          </div>
          <div
            className={`rounded-lg px-3 py-2 text-[12px] font-semibold ${
              fake ? 'bg-red-500/15 text-red-200' : 'bg-emerald-500/12 text-emerald-200'
            }`}
          >
            {fake ? '⚠️ Looks fake (bot-farm pattern)' : '✅ Looks organic'}
          </div>
          <div className="grid grid-cols-2 gap-2 text-[12px] text-white/70">
            <div>Active: <b>{res.active}</b> / {res.total}</div>
            <div>Deposited: <b>{res.withDeposit}</b></div>
            <div>Zero activity: <b>{res.zeroActivity}</b> ({res.signals?.zeroActivityPct}%)</div>
            <div>No photo: <b>{res.signals?.noPhotoPct}%</b></div>
            <div className="col-span-2">
              Biggest signup burst: <b>{res.signup?.peakInOneHour}</b> in one hour ({res.signals?.burstConcentrationPct}% of all), across {res.signup?.distinctHours} hour(s)
            </div>
          </div>
          <div className="max-h-64 space-y-1 overflow-y-auto">
            {(res.invited ?? []).map((u) => (
              <div key={u.id} className="flex items-center justify-between rounded-lg bg-white/[0.03] px-2 py-1.5 text-[11px]">
                <div className="min-w-0 truncate">
                  {u.hasPhoto ? '🖼️' : '👤'} {u.name}
                  <span className="text-white/35"> · {new Date(u.joined).toLocaleDateString()}</span>
                </div>
                <div className={u.active ? 'text-emerald-300' : 'text-white/35'}>
                  {u.deposited ? `$${usdt(u.depositUsd)}` : u.active ? 'active' : 'idle'}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

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

          <p className="text-xs font-bold uppercase tracking-wide text-white/40">Referral fraud check</p>
          <ReferrerCheck />

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
