import { useState } from 'react';
import { useStore } from '../store';
import { Mascot } from '../components/Mascot';
import { StakeSheet, type StakePick } from '../sheets/StakeSheet';
import { useToast } from '../components/Toast';
import { haptic } from '../telegram';
import { usdt } from '../lib/format';
import { accent } from '../lib/stakeAccents';
import { ApiError } from '../api';
import { StakeIcon, LockIcon, CheckIcon } from '../components/icons';
import type { Stake } from '../types';

/** Total % return over the whole lock term (daily rate × duration in days). */
function totalReturn(dailyRate: number, days: number): number {
  return Math.round(dailyRate * days * 100) / 100;
}

/** "in 5d 3h" for a future date, or "ready" once passed. */
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
  const { staking } = useStore();
  const [selected, setSelected] = useState<StakePick | null>(null);

  if (!staking) return null;
  const stakeable = staking.stakeable; // deposited (bought) portion
  const earned = staking.earnedBalance;
  const active = staking.stakes.filter((s) => s.status === 'active');
  const past = staking.stakes.filter((s) => s.status !== 'active');

  // Balance the open sheet should validate against.
  const sheetBalance = selected?.earned ? earned : stakeable;

  const et = staking.earnedTier;

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
            <div className="text-xs text-white/45">Rewarded</div>
            <div className="mt-1 text-xl font-extrabold text-ice-300">
              {usdt(staking.summary.totalClaimed)}
            </div>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
          <div className="rounded-2xl bg-white/5 px-4 py-3">
            <div className="text-xs text-white/45">Deposited (stakeable)</div>
            <div className="mt-0.5 font-bold">{usdt(stakeable)} USD</div>
          </div>
          <div className="rounded-2xl bg-white/5 px-4 py-3">
            <div className="text-xs text-white/45">Earned</div>
            <div className="mt-0.5 font-bold">{usdt(earned)} USD</div>
          </div>
        </div>
      </div>

      {!staking.enabled && (
        <div className="card py-6 text-center text-white/50">
          Staking is currently paused. Check back soon ❄️
        </div>
      )}

      {/* Active positions — shown right under the summary so you see your live
          investments (and their daily progress) first, before the tier menu. */}
      {active.length > 0 && (
        <div className="space-y-3">
          <p className="text-sm font-bold uppercase tracking-wide text-white/40">
            Your positions
          </p>
          {active.map((s) => (
            <PositionCard key={s.id} stake={s} name={nameFor(staking, s)} />
          ))}
        </div>
      )}

      {/* Earned vault */}
      {staking.enabled && et.enabled && (
        <div className="space-y-2">
          <p className="text-sm font-bold uppercase tracking-wide text-white/40">Earned vault</p>
          <div className="card border border-amber-400/30 p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className="grid h-11 w-11 place-items-center rounded-xl bg-amber-400/15 text-amber-300">
                  <LockIcon width={22} height={22} />
                </span>
                <div>
                  <div className="text-lg font-extrabold">{et.name}</div>
                  <div className="text-xs text-white/45">Lock task & referral earnings</div>
                </div>
              </div>
              <div className="text-right">
                <div className="text-2xl font-extrabold text-amber-300">
                  {totalReturn(et.dailyRate, et.durationDays)}%
                </div>
                <div className="text-[10px] uppercase tracking-wide text-white/40">Total</div>
              </div>
            </div>
            <p className="mt-3 text-sm text-white/55">{et.blurb}</p>
            <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
              <div className="rounded-lg bg-white/5 py-2">
                <div className="font-bold text-white/80">{et.dailyRate}%</div>
                <div className="text-white/40">daily</div>
              </div>
              <div className="rounded-lg bg-white/5 py-2">
                <div className="font-bold text-white/80">{et.durationDays}d</div>
                <div className="text-white/40">locked</div>
              </div>
              <div className="rounded-lg bg-white/5 py-2">
                <div className="font-bold text-white/80">{usdt(earned)}</div>
                <div className="text-white/40">earned</div>
              </div>
            </div>
            <button
              onClick={() => {
                haptic('light');
                setSelected({
                  key: 'earned',
                  name: et.name,
                  minStake: et.minStake,
                  maxStake: null,
                  apy: et.apy,
                  dailyRate: et.dailyRate,
                  durationDays: et.durationDays,
                  accent: 'amber',
                  earned: true,
                });
              }}
              disabled={earned < et.minStake}
              className="btn-primary mt-4 w-full py-3 disabled:opacity-40"
            >
              {earned >= et.minStake ? 'Lock earned ICE USD' : `Earn ${usdt(et.minStake)}+ to lock`}
            </button>
            <p className="mt-2 text-center text-[11px] text-amber-200/70">
              🔒 Rewards release with your principal at maturity — and become USDT-withdrawable.
            </p>
          </div>
        </div>
      )}

      {/* Deposited tiers */}
      {staking.enabled && (
        <div className="space-y-3">
          <p className="text-sm font-bold uppercase tracking-wide text-white/40">
            Deposited sections
          </p>
          {staking.tiers.map((tier) => {
            const a = accent(tier.accent);
            const affordable = stakeable >= tier.minStake;
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
                    <div className={`text-2xl font-extrabold ${a.text}`}>
                      {totalReturn(tier.dailyRate, tier.durationDays)}%
                    </div>
                    <div className="text-[10px] uppercase tracking-wide text-white/40">Total</div>
                  </div>
                </div>
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
                    <div className="font-bold text-white/80">
                      {totalReturn(tier.dailyRate, tier.durationDays)}%
                    </div>
                    <div className="text-white/40">total</div>
                  </div>
                </div>
                <button
                  onClick={() => {
                    haptic('light');
                    setSelected({
                      key: tier.key,
                      name: tier.name,
                      minStake: tier.minStake,
                      maxStake: tier.maxStake,
                      apy: tier.apy,
                      dailyRate: tier.dailyRate,
                      durationDays: tier.durationDays,
                      accent: tier.accent,
                      earned: false,
                    });
                  }}
                  disabled={!affordable}
                  className="btn-primary mt-4 w-full py-3 disabled:opacity-40"
                >
                  {affordable ? 'Stake' : `Deposit ${usdt(tier.minStake)}+ USD`}
                </button>
              </div>
            );
          })}
          <p className="text-center text-[11px] text-white/40">
            Tiers accept deposited (bought) ICE USD only. Deposit to stake here.
          </p>
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
                  <div className="font-bold">{nameFor(staking, s)}</div>
                  <div className="text-xs text-white/45">Unstaked · earned {usdt(s.claimed)} USD</div>
                </div>
              </div>
              <div className="text-right font-bold">{usdt(s.principal)} USD</div>
            </div>
          ))}
        </div>
      )}

      <StakeSheet pick={selected} balance={sheetBalance} onClose={() => setSelected(null)} />
    </div>
  );
}

function nameFor(staking: NonNullable<ReturnType<typeof useStore>['staking']>, s: Stake): string {
  if (s.kind === 'earned') return staking.earnedTier.name;
  return staking.tiers.find((t) => t.key === s.tier)?.name ?? s.tier;
}

function PositionCard({ stake, name }: { stake: Stake; name: string }) {
  const { claimStake, unstake } = useStore();
  const toast = useToast();
  const [busy, setBusy] = useState<'claim' | 'unstake' | null>(null);
  const isEarned = stake.kind === 'earned';
  const a = accent(isEarned ? 'amber' : 'ice');

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
      toast.show(`Unstaked — ${usdt(payout)} USD released`, 'success');
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
            <div className="font-extrabold">
              {name}
              {isEarned && <span className="ml-2 text-[10px] font-bold text-amber-300">LOCKED</span>}
            </div>
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
        <span className="text-sm text-white/50">{isEarned ? 'Locked reward' : 'Pending reward'}</span>
        <span className={`text-lg font-extrabold ${a.text}`}>+{usdt(stake.pending)} USD</span>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        {stake.claimable ? (
          <button
            onClick={onClaim}
            disabled={busy !== null || stake.pending <= 0}
            className="btn-ghost py-3 disabled:opacity-40"
          >
            {busy === 'claim' ? 'Claiming…' : 'Claim'}
          </button>
        ) : (
          <div className="grid place-items-center rounded-2xl bg-white/5 py-3 text-xs text-white/40">
            🔒 Locked
          </div>
        )}
        <button
          onClick={onUnstake}
          disabled={busy !== null || !stake.matured}
          className="btn-primary py-3 disabled:opacity-40"
        >
          {busy === 'unstake' ? 'Unstaking…' : stake.matured ? 'Unstake' : 'Locked'}
        </button>
      </div>
      {isEarned && !stake.matured && (
        <p className="mt-2 text-center text-[11px] text-amber-200/70">
          Reward + principal release together at maturity (then USDT-withdrawable).
        </p>
      )}
    </div>
  );
}
