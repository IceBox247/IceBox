import { useState } from 'react';
import { useStore } from '../store';
import { Mascot } from '../components/Mascot';
import { StakeSheet } from '../sheets/StakeSheet';
import { useToast } from '../components/Toast';
import { haptic } from '../telegram';
import { usdt } from '../lib/format';
import { accent } from '../lib/stakeAccents';
import { ApiError } from '../api';
import { StakeIcon, LockIcon, CheckIcon } from '../components/icons';
import type { Stake, StakeTier } from '../types';

/** "in 5d 3h" / "in 2h" for a future date, or "ready" once passed. */
function maturesIn(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return 'ready';
  const days = Math.floor(ms / 86_400_000);
  const hrs = Math.floor((ms % 86_400_000) / 3_600_000);
  if (days > 0) return `in ${days}d ${hrs}h`;
  const mins = Math.floor((ms % 3_600_000) / 60_000);
  if (hrs > 0) return `in ${hrs}h ${mins}m`;
  return `in ${Math.max(1, mins)}m`;
}

export function StakePage() {
  const { staking, me } = useStore();
  const [selected, setSelected] = useState<StakeTier | null>(null);

  if (!staking || !me) return null;
  const balance = me.overview.available;
  const active = staking.stakes.filter((s) => s.status === 'active');
  const past = staking.stakes.filter((s) => s.status !== 'active');

  return (
    <div className="animate-fade-in space-y-5 px-5 pb-28 pt-2">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-extrabold leading-tight">
            Stake &
            <br />
            Earn
          </h1>
          <p className="mt-1 text-white/50">Lock ICE USD and earn daily rewards</p>
        </div>
        <Mascot size={110} />
      </div>

      {/* Summary */}
      <div className="card p-5">
        <div className="grid grid-cols-3 gap-3 text-center">
          <div>
            <div className="text-xs text-white/45">Staked</div>
            <div className="mt-1 text-xl font-extrabold">{usdt(staking.summary.totalStaked)}</div>
          </div>
          <div>
            <div className="text-xs text-white/45">Pending</div>
            <div className="mt-1 text-xl font-extrabold text-usdt">
              {usdt(staking.summary.totalPending)}
            </div>
          </div>
          <div>
            <div className="text-xs text-white/45">Earned</div>
            <div className="mt-1 text-xl font-extrabold text-ice-300">
              {usdt(staking.summary.totalClaimed)}
            </div>
          </div>
        </div>
        <div className="mt-4 flex items-center justify-between rounded-2xl bg-white/5 px-4 py-3 text-sm">
          <span className="text-white/50">Available to stake</span>
          <span className="font-bold">{usdt(balance)} USD</span>
        </div>
      </div>

      {!staking.enabled && (
        <div className="card py-6 text-center text-white/50">
          Staking is currently paused. Check back soon ❄️
        </div>
      )}

      {/* Sections */}
      {staking.enabled && (
        <div className="space-y-3">
          <p className="text-sm font-bold uppercase tracking-wide text-white/40">Sections</p>
          {staking.tiers.map((tier) => {
            const a = accent(tier.accent);
            const affordable = balance >= tier.minStake;
            return (
              <div key={tier.key} className={`card border p-4 ${a.ring}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span className={`grid h-11 w-11 place-items-center rounded-xl ${a.chip}`}>
                      <StakeIcon width={22} height={22} />
                    </span>
                    <div>
                      <div className="text-lg font-extrabold">{tier.name}</div>
                      <div className="text-xs text-white/45">
                        {usdt(tier.minStake)} – {usdt(tier.maxStake)} USD
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className={`text-2xl font-extrabold ${a.text}`}>{tier.apy}%</div>
                    <div className="text-[10px] uppercase tracking-wide text-white/40">APY</div>
                  </div>
                </div>

                <p className="mt-3 text-sm text-white/55">{tier.blurb}</p>

                <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
                  <div className="rounded-lg bg-white/5 py-2">
                    <div className="font-bold text-white/80">{tier.dailyRate}%</div>
                    <div className="text-white/40">daily</div>
                  </div>
                  <div className="rounded-lg bg-white/5 py-2">
                    <div className="font-bold text-white/80">{tier.durationDays}d</div>
                    <div className="text-white/40">lock</div>
                  </div>
                  <div className="rounded-lg bg-white/5 py-2">
                    <div className="font-bold text-white/80">{tier.apy}%</div>
                    <div className="text-white/40">APY</div>
                  </div>
                </div>

                <button
                  onClick={() => {
                    haptic('light');
                    setSelected(tier);
                  }}
                  disabled={!affordable}
                  className="btn-primary mt-4 w-full py-3 disabled:opacity-40"
                >
                  {affordable ? 'Stake' : `Need ${usdt(tier.minStake)} USD`}
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Active positions */}
      {active.length > 0 && (
        <div className="space-y-3">
          <p className="pt-2 text-sm font-bold uppercase tracking-wide text-white/40">
            Your positions
          </p>
          {active.map((s) => (
            <PositionCard key={s.id} stake={s} tier={staking.tiers.find((t) => t.key === s.tier)} />
          ))}
        </div>
      )}

      {/* History */}
      {past.length > 0 && (
        <div className="space-y-3">
          <p className="pt-2 text-sm font-bold uppercase tracking-wide text-white/40">Completed</p>
          {past.map((s) => (
            <div key={s.id} className="card flex items-center justify-between p-4 opacity-70">
              <div className="flex items-center gap-3">
                <span className="grid h-9 w-9 place-items-center rounded-xl bg-white/5 text-usdt">
                  <CheckIcon width={18} height={18} />
                </span>
                <div>
                  <div className="font-bold">
                    {staking.tiers.find((t) => t.key === s.tier)?.name ?? s.tier}
                  </div>
                  <div className="text-xs text-white/45">Unstaked · earned {usdt(s.claimed)} USD</div>
                </div>
              </div>
              <div className="text-right font-bold">{usdt(s.principal)} USD</div>
            </div>
          ))}
        </div>
      )}

      <StakeSheet tier={selected} balance={balance} onClose={() => setSelected(null)} />
    </div>
  );
}

function PositionCard({ stake, tier }: { stake: Stake; tier?: StakeTier }) {
  const { claimStake, unstake } = useStore();
  const toast = useToast();
  const [busy, setBusy] = useState<'claim' | 'unstake' | null>(null);
  const a = accent(tier?.accent ?? 'ice');
  const name = tier?.name ?? stake.tier;

  async function onClaim() {
    setBusy('claim');
    try {
      const { reward } = await claimStake(stake.id);
      haptic('success');
      toast.show(`Claimed ${usdt(reward)} USD`, 'success');
    } catch (e) {
      haptic('error');
      toast.show(e instanceof ApiError ? e.message : 'Claim failed', 'error');
    } finally {
      setBusy(null);
    }
  }

  async function onUnstake() {
    setBusy('unstake');
    try {
      const { payout } = await unstake(stake.id);
      haptic('success');
      toast.show(`Unstaked — ${usdt(payout)} USD returned`, 'success');
    } catch (e) {
      haptic('error');
      toast.show(e instanceof ApiError ? e.message : 'Unstake failed', 'error');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className={`card border p-4 ${a.ring}`}>
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <span className={`grid h-10 w-10 place-items-center rounded-xl ${a.chip}`}>
            {stake.matured ? <StakeIcon width={20} height={20} /> : <LockIcon width={18} height={18} />}
          </span>
          <div>
            <div className="font-extrabold">{name}</div>
            <div className="text-xs text-white/45">
              {usdt(stake.principal)} USD · {stake.dailyRate}%/day
            </div>
          </div>
        </div>
        <div className="text-right">
          <div className="text-xs text-white/40">{stake.matured ? 'Matured' : 'Unlocks'}</div>
          <div className={`text-sm font-bold ${stake.matured ? 'text-usdt' : 'text-white/70'}`}>
            {stake.matured ? 'ready' : maturesIn(stake.maturesAt)}
          </div>
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between rounded-2xl bg-white/5 px-4 py-3">
        <span className="text-sm text-white/50">Pending reward</span>
        <span className={`text-lg font-extrabold ${a.text}`}>+{usdt(stake.pending)} USD</span>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <button
          onClick={onClaim}
          disabled={busy !== null || stake.pending <= 0}
          className="btn-ghost py-3 disabled:opacity-40"
        >
          {busy === 'claim' ? 'Claiming…' : 'Claim'}
        </button>
        <button
          onClick={onUnstake}
          disabled={busy !== null || !stake.matured}
          className="btn-primary py-3 disabled:opacity-40"
        >
          {busy === 'unstake' ? 'Unstaking…' : stake.matured ? 'Unstake' : 'Locked'}
        </button>
      </div>
      {stake.claimed > 0 && (
        <p className="mt-2 text-center text-xs text-white/40">
          Claimed so far: {usdt(stake.claimed)} USD
        </p>
      )}
    </div>
  );
}
