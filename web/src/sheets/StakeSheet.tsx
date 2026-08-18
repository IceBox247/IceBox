import { useState } from 'react';
import { Sheet } from '../components/Sheet';
import { useStore } from '../store';
import { useToast } from '../components/Toast';
import { ApiError } from '../api';
import { haptic } from '../telegram';
import { usdt } from '../lib/format';
import { accent } from '../lib/stakeAccents';
import type { StakeTier } from '../types';

export function StakeSheet({
  tier,
  balance,
  onClose,
}: {
  tier: StakeTier | null;
  balance: number;
  onClose: () => void;
}) {
  const { stake } = useStore();
  const toast = useToast();
  const [amount, setAmount] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (!tier) return null;
  const a = accent(tier.accent);

  const amt = Number(amount);
  const valid = Number.isFinite(amt) && amt >= tier.minStake && amt <= tier.maxStake && amt <= balance;
  // What this stake pays over the full term at the daily rate.
  const projected = valid ? (amt * (tier.dailyRate / 100) * tier.durationDays) : 0;
  const maxAffordable = Math.min(tier.maxStake, Math.floor(balance));

  async function submit() {
    if (!tier) return;
    if (!Number.isFinite(amt) || amt < tier.minStake || amt > tier.maxStake) {
      toast.show(`${tier.name} accepts ${usdt(tier.minStake)}–${usdt(tier.maxStake)} USD`, 'error');
      return;
    }
    if (amt > balance) {
      toast.show(`You only have ${usdt(balance)} USD available`, 'error');
      return;
    }
    setSubmitting(true);
    try {
      await stake(tier.key, amt);
      haptic('success');
      toast.show(`Staked ${usdt(amt)} USD in ${tier.name} 🔒`, 'success');
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
    <Sheet open={!!tier} onClose={onClose} title={`Stake · ${tier.name}`}>
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-2">
          {[
            { label: 'APY', value: `${tier.apy}%` },
            { label: 'Daily', value: `${tier.dailyRate}%` },
            { label: 'Lock', value: `${tier.durationDays}d` },
          ].map((s) => (
            <div key={s.label} className="rounded-2xl bg-white/5 p-3 text-center">
              <div className={`text-lg font-extrabold ${a.text}`}>{s.value}</div>
              <div className="text-xs text-white/50">{s.label}</div>
            </div>
          ))}
        </div>

        <div className="rounded-2xl bg-white/5 p-4 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-white/50">Available</span>
            <span className="font-bold">{usdt(balance)} USD</span>
          </div>
          <div className="mt-1 flex items-center justify-between">
            <span className="text-white/50">Range</span>
            <span className="font-bold">
              {usdt(tier.minStake)} – {usdt(tier.maxStake)} USD
            </span>
          </div>
        </div>

        <label className="block">
          <span className="mb-1 block text-sm text-white/50">Amount to stake (USD)</span>
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))}
            inputMode="decimal"
            placeholder={usdt(tier.minStake)}
            className="w-full rounded-xl border border-white/10 bg-night-700 px-4 py-3 text-white outline-none focus:border-ice-400"
          />
          <div className="mt-2 flex gap-2">
            <button
              onClick={() => setAmount(String(tier.minStake))}
              className="flex-1 rounded-lg bg-white/5 py-2 text-xs font-semibold text-white/70"
            >
              Min
            </button>
            {maxAffordable >= tier.minStake && (
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
            Projected reward over {tier.durationDays} days
          </div>
          <div className={`mt-1 text-3xl font-extrabold ${a.text}`}>+{usdt(projected)} USD</div>
          <div className="mt-1 text-xs text-white/40">
            Claim rewards anytime · principal unlocks at maturity
          </div>
        </div>

        <button
          onClick={submit}
          disabled={submitting || !valid}
          className="btn-primary w-full py-4 text-lg disabled:opacity-40"
        >
          {submitting ? 'Staking…' : valid ? `Stake ${usdt(amt)} USD` : 'Enter an amount'}
        </button>
        <button onClick={onClose} className="btn-ghost w-full py-4">
          Cancel
        </button>
      </div>
    </Sheet>
  );
}
