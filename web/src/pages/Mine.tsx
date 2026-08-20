import { useEffect, useState } from 'react';
import { useStore } from '../store';
import { useToast } from '../components/Toast';
import { ApiError } from '../api';
import { haptic } from '../telegram';
import { usdt } from '../lib/format';
import { MineIcon } from '../components/icons';

interface Props {
  onDeposit: () => void;
}

export function Mine({ onDeposit }: Props) {
  const { mining, buyHashrate, collectMining } = useStore();
  const toast = useToast();
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState<'buy' | 'collect' | null>(null);
  // Live-ticking pending so the counter visibly climbs.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  if (!mining) return null;

  // Estimate the live pending between refreshes (perHour → per second).
  const livePending = mining.pending + (mining.perHour / 3600) * tick;
  const amt = Number(amount);
  const validBuy = Number.isFinite(amt) && amt >= mining.minBuy && amt <= mining.spendable;

  async function buy(v: number) {
    setBusy('buy');
    try {
      await buyHashrate(v);
      haptic('success');
      toast.show(`+${usdt(v * mining!.hashPerUsd)} ${mining!.unit} added`, 'success');
      setAmount('');
    } catch (e) {
      haptic('error');
      toast.show(e instanceof ApiError ? e.message : 'Purchase failed', 'error');
    } finally {
      setBusy(null);
    }
  }

  async function collect() {
    setBusy('collect');
    try {
      const { collected } = await collectMining();
      haptic('success');
      toast.show(`Collected ${usdt(collected)} ICE USD ❄️`, 'success');
    } catch (e) {
      haptic('error');
      toast.show(e instanceof ApiError ? e.message : 'Nothing to collect yet', 'error');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="animate-fade-in space-y-5 px-5 pb-28 pt-2">
      <div>
        <h1 className="text-3xl font-extrabold leading-tight">{mining.name}</h1>
        <p className="mt-1 text-white/50">Mine ICE USD with hashrate — powered by deposits</p>
      </div>

      {/* Rig card */}
      <div className="card overflow-hidden p-0">
        <div className="relative bg-gradient-to-br from-ice-500/30 via-ice-400/10 to-transparent p-5">
          <div className="flex items-center justify-between">
            <span className="grid h-14 w-14 place-items-center rounded-2xl bg-ice-400/20 text-ice-200">
              <MineIcon width={30} height={30} />
            </span>
            <div className="rounded-xl bg-black/25 px-3 py-2 text-right">
              <div className="text-[10px] uppercase tracking-widest text-white/50">
                Level {mining.level.level}
              </div>
              <div className="text-lg font-extrabold text-ice-100">{mining.level.name}</div>
            </div>
          </div>

          <div className="mt-5">
            <div className="text-xs text-white/50">Mined & ready to collect</div>
            <div className="mt-1 text-4xl font-extrabold tabular-nums text-ice-100">
              {livePending.toFixed(4)}
              <span className="ml-2 text-base font-bold text-white/40">ICE USD</span>
            </div>
          </div>

          {/* Level progress */}
          {mining.level.nextName && (
            <div className="mt-4">
              <div className="mb-1 flex justify-between text-[11px] text-white/50">
                <span>{mining.level.name}</span>
                <span>
                  Next: {mining.level.nextName} at {mining.level.nextAtHash} {mining.unit}
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-black/25">
                <div
                  className="h-full rounded-full bg-ice-300 transition-all"
                  style={{ width: `${mining.level.progress}%` }}
                />
              </div>
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 divide-x divide-white/5 border-t border-white/5">
          <div className="p-4 text-center">
            <div className="text-xs text-white/45">Hashrate</div>
            <div className="mt-1 text-xl font-extrabold">
              {mining.hashrate} <span className="text-xs text-white/40">{mining.unit}</span>
            </div>
          </div>
          <div className="p-4 text-center">
            <div className="text-xs text-white/45">Per hour</div>
            <div className="mt-1 text-xl font-extrabold text-ice-300">
              {mining.perHour.toFixed(4)}
            </div>
          </div>
        </div>

        <button
          onClick={collect}
          disabled={busy !== null || livePending <= 0}
          className="btn-primary w-full rounded-none py-4 text-lg disabled:opacity-40"
        >
          {busy === 'collect' ? 'Collecting…' : `Collect ${livePending.toFixed(4)} ICE USD`}
        </button>
      </div>

      {/* Buy hashrate */}
      <div className="card space-y-4 p-5">
        <div>
          <h2 className="text-lg font-extrabold">Boost your hashrate</h2>
          <p className="mt-1 text-sm text-white/55">
            Buy mining power with <b className="text-ice-200">deposited</b> USD. Each ${1} adds{' '}
            {mining.hashPerUsd} {mining.unit}, mining {(mining.hashPerUsd * mining.icePerHashDay).toFixed(3)} ICE USD/day.
          </p>
        </div>

        <div className="flex items-center justify-between rounded-2xl bg-white/5 px-4 py-3 text-sm">
          <span className="text-white/50">Deposited available</span>
          <b>{usdt(mining.spendable)} USD</b>
        </div>

        {/* Quick packages */}
        <div className="grid grid-cols-3 gap-2">
          {mining.packages.map((p) => (
            <button
              key={p}
              onClick={() => buy(p)}
              disabled={busy !== null || p > mining.spendable}
              className="rounded-2xl border border-ice-400/20 bg-ice-400/5 py-3 text-center font-bold disabled:opacity-40"
            >
              ${p}
              <div className="text-[10px] font-semibold text-white/40">
                +{p * mining.hashPerUsd} {mining.unit}
              </div>
            </button>
          ))}
        </div>

        {/* Custom amount */}
        <div className="space-y-2">
          <input
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))}
            placeholder={`Custom amount (min $${mining.minBuy})`}
            className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-lg font-bold outline-none focus:border-ice-400/50"
          />
          {mining.spendable < mining.minBuy ? (
            <button onClick={onDeposit} className="btn-ghost w-full py-3">
              Deposit USD to start mining
            </button>
          ) : (
            <button
              onClick={() => buy(amt)}
              disabled={!validBuy || busy !== null}
              className="btn-primary w-full py-3 disabled:opacity-40"
            >
              {busy === 'buy'
                ? 'Buying…'
                : validBuy
                  ? `Buy ${amt * mining.hashPerUsd} ${mining.unit}`
                  : 'Buy hashrate'}
            </button>
          )}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3">
        <div className="card p-4">
          <div className="text-xs text-white/45">Total mined</div>
          <div className="mt-1 text-2xl font-extrabold text-ice-300">{usdt(mining.totalMined)}</div>
          <div className="text-[11px] text-white/40">ICE USD</div>
        </div>
        <div className="card p-4">
          <div className="text-xs text-white/45">Invested</div>
          <div className="mt-1 text-2xl font-extrabold">{usdt(mining.totalSpent)}</div>
          <div className="text-[11px] text-white/40">USD</div>
        </div>
      </div>

      <p className="text-center text-[11px] text-white/40">
        Mined ICE USD lands in your earned balance — withdraw as the ICE token or lock it in the
        Earned Vault.
      </p>
    </div>
  );
}
