import { useState } from 'react';
import { Sheet } from '../components/Sheet';
import { api, ApiError } from '../api';
import { useStore } from '../store';
import { useToast } from '../components/Toast';
import { haptic } from '../telegram';
import { usdt } from '../lib/format';

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
  const [address, setAddress] = useState('');
  const [network, setNetwork] = useState('BEP20');
  const [amount, setAmount] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (!me) return null;

  const balance = me.overview.available;
  const min = me.config.minWithdrawal;
  const enough = balance >= min;
  const needed = Math.max(0, min - balance);

  async function submit() {
    const amt = Number(amount || min);
    const addr = address.trim();
    // Must be a real EVM address — a payout to a typo is unrecoverable.
    if (!/^0x[a-fA-F0-9]{40}$/.test(addr)) {
      toast.show('Enter a valid BSC address — 0x followed by 40 characters', 'error');
      return;
    }
    if (!Number.isFinite(amt) || amt < min) {
      toast.show(`Minimum withdrawal is ${usdt(min)} USD`, 'error');
      return;
    }
    if (amt > balance) {
      toast.show(`You only have ${usdt(balance)} USD available`, 'error');
      return;
    }
    setSubmitting(true);
    try {
      await api.withdraw(amt, addr, network);
      haptic('success');
      toast.show('Withdrawal requested 🎉', 'success');
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
    <Sheet open={open} onClose={onClose} title={enough ? 'Withdraw USD' : undefined}>
      {!enough ? (
        // "Not Enough Balance" gate — mirrors the reference app.
        <div className="py-4 text-center">
          <div className="mb-3 text-5xl">❄️</div>
          <p className="text-2xl font-extrabold">Not Enough Balance</p>
          <p className="mt-2 text-4xl font-extrabold text-ice-300">
            {usdt(min)} <span className="text-2xl text-ice-400">USD</span>
          </p>
          <p className="mx-auto mt-3 max-w-xs text-white/55">
            Minimum withdrawal is <b className="text-white">{usdt(min)} USD</b>. Keep earning — you
            need <b className="text-ice-300">{usdt(needed)} USD</b> more. Your balance:{' '}
            <b className="text-white">{usdt(balance)} USD</b>.
          </p>
          <button
            onClick={() => {
              haptic('light');
              onEarnMore();
            }}
            className="btn-primary mt-6 w-full py-4 text-lg"
          >
            Earn More
          </button>
          <button onClick={onClose} className="btn-ghost mt-3 w-full py-4">
            Close
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="rounded-2xl bg-white/5 p-4">
            <div className="flex items-center justify-between text-sm">
              <span className="text-white/50">Available</span>
              <span className="font-bold">{usdt(balance)} USD</span>
            </div>
          </div>

          <label className="block">
            <span className="mb-1 block text-sm text-white/50">Network</span>
            <div className="flex gap-2">
              {['BEP20'].map((n) => (
                <button
                  key={n}
                  onClick={() => setNetwork(n)}
                  className={`flex-1 rounded-xl py-3 text-sm font-bold transition ${
                    network === n ? 'bg-ice-400/20 text-ice-200 border border-ice-400/40' : 'bg-white/5 text-white/60'
                  }`}
                >
                  BSC (BEP-20)
                </button>
              ))}
            </div>
          </label>

          <label className="block">
            <span className="mb-1 block text-sm text-white/50">BSC wallet address</span>
            <input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Paste your BSC (BEP-20) wallet address — 0x…"
              className="w-full rounded-xl border border-white/10 bg-night-700 px-4 py-3 text-white outline-none focus:border-ice-400"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-sm text-white/50">
              Amount (min {usdt(min)} USD)
            </span>
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))}
              inputMode="decimal"
              placeholder={usdt(min)}
              className="w-full rounded-xl border border-white/10 bg-night-700 px-4 py-3 text-white outline-none focus:border-ice-400"
            />
          </label>

          <button
            onClick={submit}
            disabled={submitting}
            className="btn-primary w-full py-4 text-lg"
          >
            {submitting ? 'Processing…' : 'Withdraw'}
          </button>
          <button onClick={onClose} className="btn-ghost w-full py-4">
            Close
          </button>
        </div>
      )}
    </Sheet>
  );
}
