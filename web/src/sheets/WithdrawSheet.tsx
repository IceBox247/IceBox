import { useState } from 'react';
import { Sheet } from '../components/Sheet';
import { api, ApiError } from '../api';
import { useStore } from '../store';
import { useToast } from '../components/Toast';
import { haptic } from '../telegram';
import { usdt } from '../lib/format';

type Rail = 'usdt' | 'ice';

export function WithdrawSheet({
  open,
  onClose,
  onEarnMore,
}: {
  open: boolean;
  onClose: () => void;
  onEarnMore: () => void;
}) {
  const { me, refreshMe } = useStore();
  const toast = useToast();
  const [rail, setRail] = useState<Rail>('usdt');
  const [address, setAddress] = useState('');
  const [amount, setAmount] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (!me) return null;

  const min = rail === 'usdt' ? me.config.minWithdrawalUsdt : me.config.minWithdrawal;
  const stakeable = me.overview.stakeable; // USDT-withdrawable (deposited/staked)
  const earned = me.overview.earnedBalance; // ICE-token-withdrawable
  const available = rail === 'usdt' ? stakeable : earned;
  const enough = available >= min;
  const needed = Math.max(0, min - available);
  const label = rail === 'usdt' ? 'USDT' : 'ICE token';
  const unit = rail === 'usdt' ? 'USDT' : 'ICE';

  async function submit() {
    const amt = Number(amount || min);
    const addr = address.trim();
    if (!/^0x[a-fA-F0-9]{40}$/.test(addr)) {
      toast.show('Enter a valid BSC address — 0x followed by 40 characters', 'error');
      return;
    }
    if (!Number.isFinite(amt) || amt < min) {
      toast.show(`Minimum withdrawal is ${usdt(min)} ${unit}`, 'error');
      return;
    }
    if (amt > available) {
      toast.show(`You only have ${usdt(available)} available on this rail`, 'error');
      return;
    }
    setSubmitting(true);
    try {
      const res = await api.withdraw(amt, addr, 'BEP20', rail);
      haptic('success');
      toast.show(
        res.withdrawal?.status === 'processing' || res.withdrawal?.status === 'paid'
          ? `Withdrawal sent — arriving shortly 🚀`
          : 'Withdrawal requested 🎉',
        'success',
      );
      await refreshMe();
      setAddress('');
      setAmount('');
      onClose();
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : 'Withdrawal failed';
      haptic('error');
      toast.show(msg, 'error');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title="Withdraw">
      <div className="space-y-4">
        {/* Rail toggle */}
        <div className="flex gap-2 rounded-2xl bg-white/5 p-1">
          {(['usdt', 'ice'] as Rail[]).map((r) => (
            <button
              key={r}
              onClick={() => setRail(r)}
              className={`flex-1 rounded-xl py-2.5 text-sm font-bold transition ${
                rail === r ? 'bg-ice-400/20 text-ice-200' : 'text-white/50'
              }`}
            >
              {r === 'usdt' ? 'USDT' : 'ICE token'}
            </button>
          ))}
        </div>

        <div className="rounded-2xl bg-ice-400/10 p-3 text-center text-xs text-white/60">
          {rail === 'usdt' ? (
            <>
              Withdraw your <b className="text-ice-200">deposited & staked</b> balance as real{' '}
              <b className="text-ice-200">USDT</b> to your wallet.
            </>
          ) : (
            <>
              Withdraw your <b className="text-ice-200">earned</b> balance (tasks & referrals) as the{' '}
              <b className="text-ice-200">ICE token</b>. Stake it first to withdraw as USDT.
            </>
          )}
        </div>

        <div className="rounded-2xl bg-white/5 p-4">
          <div className="flex items-center justify-between text-sm">
            <span className="text-white/50">{label} available</span>
            <span className="font-bold">{usdt(available)} {unit}</span>
          </div>
        </div>

        {!enough ? (
          <div className="py-2 text-center">
            <p className="text-lg font-extrabold">Not enough on the {label} rail</p>
            <p className="mx-auto mt-2 max-w-xs text-sm text-white/55">
              Minimum is <b className="text-white">{usdt(min)} {unit}</b>. You need{' '}
              <b className="text-ice-300">{usdt(needed)} {unit}</b> more here.
              {rail === 'usdt' && ' Deposit or stake to build this rail.'}
            </p>
            <button
              onClick={() => {
                haptic('light');
                onEarnMore();
              }}
              className="btn-primary mt-4 w-full py-3"
            >
              {rail === 'usdt' ? 'Go stake / deposit' : 'Earn more'}
            </button>
            <button onClick={onClose} className="btn-ghost mt-2 w-full py-3">
              Close
            </button>
          </div>
        ) : (
          <>
            <label className="block">
              <span className="mb-1 block text-sm text-white/50">BSC (BEP-20) wallet address</span>
              <input
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="Paste your BSC wallet address — 0x…"
                className="w-full rounded-xl border border-white/10 bg-night-700 px-4 py-3 text-white outline-none focus:border-ice-400"
              />
            </label>

            <label className="block">
              <span className="mb-1 block text-sm text-white/50">Amount (min {usdt(min)} {unit})</span>
              <input
                value={amount}
                onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))}
                inputMode="decimal"
                placeholder={usdt(min)}
                className="w-full rounded-xl border border-white/10 bg-night-700 px-4 py-3 text-white outline-none focus:border-ice-400"
              />
              <button
                onClick={() => setAmount(String(Math.floor(available)))}
                className="mt-2 w-full rounded-lg bg-white/5 py-2 text-xs font-semibold text-white/70"
              >
                Max ({usdt(available)})
              </button>
            </label>

            <button onClick={submit} disabled={submitting} className="btn-primary w-full py-4 text-lg">
              {submitting ? 'Processing…' : `Withdraw ${label}`}
            </button>
            <button onClick={onClose} className="btn-ghost w-full py-4">
              Close
            </button>
          </>
        )}
      </div>
    </Sheet>
  );
}
