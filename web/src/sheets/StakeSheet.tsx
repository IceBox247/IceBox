import { useState } from 'react';
import { Sheet } from '../components/Sheet';
import { useStore } from '../store';
import { useToast } from '../components/Toast';
import { ApiError } from '../api';
import { haptic } from '../telegram';
import { usdt } from '../lib/format';
import { accent } from '../lib/stakeAccents';

/** A unified descriptor for either a tier or the earned vault. */
export interface StakePick {
  key: string;
  name: string;
  minStake: number;
  maxStake: number | null; // null = no upper bound (earned vault)
  apy: number;
  dailyRate: number;
  durationDays: number;
  accent: string;
  earned: boolean;
}

export function StakeSheet({
  pick,
  balance,
  onClose,
}: {
  pick: StakePick | null;
  balance: number;
  onClose: () => void;
}) {
  const { stake } = useStore();
  const toast = useToast();
  const [amount, setAmount] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (!pick) return null;
  const a = accent(pick.accent);
  const unit = pick.earned ? 'ICE' : 'USDT';

  const amt = Number(amount);
  const hardMax = pick.maxStake ?? Infinity;
  const valid = Number.isFinite(amt) && amt >= pick.minStake && amt <= hardMax && amt <= balance;
  const projected = valid ? amt * (pick.dailyRate / 100) * pick.durationDays : 0;
  const maxAffordable = Math.floor(Math.min(hardMax, balance));

  async function submit() {
    if (!pick) return;
    if (!Number.isFinite(amt) || amt < pick.minStake || amt > hardMax) {
      const range = pick.maxStake
        ? `${usdt(pick.minStake)}–${usdt(pick.maxStake)}`
        : `min ${usdt(pick.minStake)}`;
      toast.show(`${pick.name} accepts ${range} ${unit}`, 'error');
      return;
    }
    if (amt > balance) {
      toast.show(
        pick.earned
          ? `You only have ${usdt(balance)} earned ICE`
          : `You only have ${usdt(balance)} deposited USDT`,
        'error',
      );
      return;
    }
    setSubmitting(true);
    try {
      await stake(pick.key, amt);
      haptic('success');
      toast.show(`Staked ${usdt(amt)} ${unit} in ${pick.name} 🔒`, 'success');
      setAmount('');
      onClose();
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : 'Stake failed';
      haptic('error');
      toast.show(msg, 'error');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Sheet open={!!pick} onClose={onClose} title={`Stake · ${pick.name}`}>
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-2">
          {[
            { label: 'Total', value: `${Math.round(pick.dailyRate * pick.durationDays * 100) / 100}%` },
            { label: 'Daily', value: `${pick.dailyRate}%` },
            { label: 'Lock', value: `${pick.durationDays}d` },
          ].map((s) => (
            <div key={s.label} className="rounded-2xl bg-white/5 p-3 text-center">
              <div className={`text-lg font-extrabold ${a.text}`}>{s.value}</div>
              <div className="text-xs text-white/50">{s.label}</div>
            </div>
          ))}
        </div>

        {pick.earned && (
          <div className="rounded-2xl border border-amber-400/30 bg-amber-400/10 p-3 text-center text-xs text-amber-200">
            🔒 Locked vault — your reward accrues but stays locked. Principal + all
            rewards release together only at the end of the {pick.durationDays}-day term.
          </div>
        )}

        <div className="rounded-2xl bg-white/5 p-4 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-white/50">{pick.earned ? 'Earned available' : 'Deposited available'}</span>
            <span className="font-bold">{usdt(balance)} {unit}</span>
          </div>
          <div className="mt-1 flex items-center justify-between">
            <span className="text-white/50">Range</span>
            <span className="font-bold">
              {usdt(pick.minStake)}
              {pick.maxStake ? ` – ${usdt(pick.maxStake)}` : '+'} {unit}
            </span>
          </div>
        </div>

        <label className="block">
          <span className="mb-1 block text-sm text-white/50">Amount to stake ({unit})</span>
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))}
            inputMode="decimal"
            placeholder={usdt(pick.minStake)}
            className="w-full rounded-xl border border-white/10 bg-night-700 px-4 py-3 text-white outline-none focus:border-ice-400"
          />
          <div className="mt-2 flex gap-2">
            <button
              onClick={() => setAmount(String(pick.minStake))}
              className="flex-1 rounded-lg bg-white/5 py-2 text-xs font-semibold text-white/70"
            >
              Min
            </button>
            {maxAffordable >= pick.minStake && (
              <button
                onClick={() => setAmount(String(maxAffordable))}
                className="flex-1 rounded-lg bg-white/5 py-2 text-xs font-semibold text-white/70"
              >
                Max ({usdt(maxAffordable)})
              </button>
            )}
          </div>
        </label>

        <div className="rounded-2xl border border-white/10 p-4 text-center">
          <div className="text-xs uppercase tracking-wide text-white/40">
            {pick.earned ? 'Reward released' : 'Projected reward'} over {pick.durationDays} days
          </div>
          <div className={`mt-1 text-3xl font-extrabold ${a.text}`}>+{usdt(projected)} {unit}</div>
          <div className="mt-1 text-xs text-white/40">
            {pick.earned
              ? 'Principal + reward unlock together at maturity'
              : 'Claim rewards anytime · principal unlocks at maturity'}
          </div>
        </div>

        <button
          onClick={submit}
          disabled={submitting || !valid}
          className="btn-primary w-full py-4 text-lg disabled:opacity-40"
        >
          {submitting ? 'Staking…' : valid ? `Stake ${usdt(amt)} ${unit}` : 'Enter an amount'}
        </button>
        <button onClick={onClose} className="btn-ghost w-full py-4">
          Cancel
        </button>
      </div>
    </Sheet>
  );
}
