import { useEffect, useState } from 'react';
import { useStore } from '../store';
import { useToast } from '../components/Toast';
import { api, ApiError } from '../api';
import { haptic } from '../telegram';
import { usdt } from '../lib/format';
import { MineIcon } from '../components/icons';
import type { MinerRankRow } from '../types';

interface Props {
  onDeposit: () => void;
}

export function Mine({ onDeposit }: Props) {
  const { mining, buyHashrate, collectMining, refreshMining } = useStore();
  const toast = useToast();
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState<'buy' | 'collect' | null>(null);
  const [board, setBoard] = useState<MinerRankRow[] | null>(null);
  // Live-ticking pending so the counter visibly climbs.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);
  // Always pull fresh rig state when the Mine tab opens, so a just-credited
  // deposit shows up as spendable power right away.
  useEffect(() => {
    refreshMining().catch(() => {});
  }, [refreshMining]);
  // Lazy-load the leaderboard once.
  useEffect(() => {
    api
      .miningLeaderboard()
      .then((r) => setBoard(r.leaderboard))
      .catch(() => setBoard([]));
  }, []);

  if (!mining) return null;

  // Estimate the live pending between refreshes (perHour → per second).
  const livePending = mining.pending + (mining.perHour / 3600) * tick;
  const amt = Number(amount);
  const validBuy =
    Number.isFinite(amt) &&
    amt >= mining.minBuy &&
    amt <= mining.maxBuy &&
    amt <= mining.spendable;
  // Same curve the server prices with: ice/day = minDay * (usd/minBuy)^exp.
  const iceForUsd = (usd: number) =>
    mining.minDay * Math.pow(Math.max(usd, mining.minBuy) / mining.minBuy, mining.yieldExp);

  async function buy(v: number) {
    setBusy('buy');
    try {
      await buyHashrate(v);
      haptic('success');
      toast.show(`+${iceForUsd(v).toFixed(2)} ICE/day added ❄️`, 'success');
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
            {mining.referralHashrate > 0 && (
              <div className="text-[10px] text-ice-300">
                incl. +{mining.referralHashrate} from refs
              </div>
            )}
          </div>
          <div className="p-4 text-center">
            <div className="text-xs text-white/45">Per hour</div>
            <div className="mt-1 text-xl font-extrabold text-ice-300">
              {mining.perHour.toFixed(4)}
            </div>
            <div className="text-[10px] text-white/40">{mining.perDay.toFixed(2)} / day</div>
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

      {/* Referral mining boost */}
      <div className="card flex items-center gap-4 border border-ice-400/20 p-4">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-ice-400/15 text-2xl">
          👥
        </span>
        <div className="flex-1">
          <h3 className="font-extrabold leading-tight">Referral mining boost</h3>
          <p className="text-sm text-white/55">
            {mining.referralMiners > 0
              ? `${mining.referralMiners} friend${mining.referralMiners > 1 ? 's' : ''} mining · +${mining.referralBonus.toFixed(2)} ICE/day`
              : `Invite friends — each one who mines adds +${mining.referralBonusPerDay} ICE/day`}
          </p>
        </div>
        <div className="text-right">
          <div className="text-lg font-extrabold text-ice-300">
            +{mining.referralBonus.toFixed(2)}
          </div>
          <div className="text-[10px] text-white/40">ICE / day</div>
        </div>
      </div>

      {/* Buy hashrate */}
      <div className="card space-y-4 p-5">
        <div>
          <h2 className="text-lg font-extrabold">Boost your hashrate</h2>
          <p className="mt-1 text-sm text-white/55">
            You mine <b className="text-ice-200">{mining.baseIcePerDay} ICE USD/day</b> free. Buy
            more power with <b className="text-ice-200">deposited</b> USD — from ${mining.minBuy} up
            to ${mining.maxBuy.toLocaleString()}, growing to as much as{' '}
            {mining.maxIcePerDay.toLocaleString()} ICE USD/day.
          </p>
        </div>

        <div className="flex items-center justify-between rounded-2xl bg-white/5 px-4 py-3 text-sm">
          <span className="text-white/50">Deposited available</span>
          <b>{usdt(mining.spendable)} USD</b>
        </div>

        {/* 100-step hashrate ladder */}
        <div>
          <div className="mb-2 flex items-center justify-between text-[11px] uppercase tracking-wide text-white/40">
            <span>Hashrate packages</span>
            <span>{mining.packages.length} tiers</span>
          </div>
          <div className="max-h-72 space-y-1.5 overflow-y-auto pr-1">
            {mining.packages.map((p, i) => {
              const affordable = p.price <= mining.spendable;
              return (
                <button
                  key={i}
                  onClick={() => buy(p.price)}
                  disabled={busy !== null || !affordable}
                  className="flex w-full items-center justify-between rounded-2xl border border-white/10 bg-white/5 px-4 py-2.5 text-left disabled:opacity-40"
                >
                  <div>
                    <div className="text-sm font-extrabold">
                      #{i + 1} · ${p.price.toLocaleString()}
                    </div>
                    <div className="text-[11px] text-white/45">
                      +{p.ice.toLocaleString()} {mining.unit}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-bold text-ice-300">
                      +{p.ice.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                    </div>
                    <div className="text-[10px] text-white/40">ICE / day</div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Custom amount */}
        <div className="space-y-2">
          <input
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))}
            placeholder={`Custom amount ($${mining.minBuy} – $${mining.maxBuy.toLocaleString()})`}
            className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-lg font-bold outline-none focus:border-ice-400/50"
          />
          {mining.spendable < mining.minBuy ? (
            <button onClick={onDeposit} className="btn-ghost w-full py-3">
              Deposit USD to buy hashrate
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
                  ? `Buy — +${iceForUsd(amt).toFixed(iceForUsd(amt) < 1 ? 3 : 2)} ICE/day`
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

      {/* Levels */}
      <div className="space-y-2">
        <p className="text-sm font-bold uppercase tracking-wide text-white/40">Mining levels</p>
        <div className="card divide-y divide-white/5 p-0">
          {mining.levels.map((lv, i) => {
            const current = mining.level.level === i + 1;
            const reached = mining.hashrate >= lv.minHash;
            return (
              <div
                key={lv.name}
                className={`flex items-center justify-between px-4 py-3 ${current ? 'bg-ice-400/10' : ''}`}
              >
                <div className="flex items-center gap-3">
                  <span
                    className={`grid h-8 w-8 place-items-center rounded-lg text-sm font-extrabold ${
                      reached ? 'bg-ice-400/20 text-ice-200' : 'bg-white/5 text-white/40'
                    }`}
                  >
                    {i + 1}
                  </span>
                  <div>
                    <div className={`font-bold ${current ? 'text-ice-200' : ''}`}>
                      {lv.name}
                      {current && <span className="ml-2 text-[10px] text-ice-300">YOU</span>}
                    </div>
                    <div className="text-[11px] text-white/40">
                      {lv.minHash === 0 ? 'from 0' : `${lv.minHash.toLocaleString()}+`} {mining.unit}
                    </div>
                  </div>
                </div>
                {reached ? (
                  <span className="text-xs font-bold text-usdt">✓ reached</span>
                ) : (
                  <span className="text-[11px] text-white/40">
                    {(lv.minHash - mining.hashrate).toLocaleString(undefined, {
                      maximumFractionDigits: 2,
                    })}{' '}
                    to go
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Top miners leaderboard */}
      <div className="space-y-2">
        <p className="text-sm font-bold uppercase tracking-wide text-white/40">Top miners</p>
        {mining.rewards.enabled && (
          <div className="rounded-2xl border border-usdt/25 bg-usdt/5 p-4 text-center">
            <div className="text-sm font-extrabold">🏆 Daily mining rewards</div>
            <p className="mt-1 text-xs text-white/60">
              Top {mining.rewards.usdtTop} split{' '}
              <b className="text-usdt">${mining.rewards.usdtPool} USDT</b> · Top{' '}
              {mining.rewards.iceTop} split{' '}
              <b className="text-ice-200">{mining.rewards.icePool.toLocaleString()} ICE USD</b> —
              every day, by rank.
            </p>
          </div>
        )}
        <div className="card divide-y divide-white/5 p-0">
          {board === null ? (
            <div className="px-4 py-6 text-center text-sm text-white/40">Loading…</div>
          ) : board.length === 0 ? (
            <div className="px-4 py-6 text-center text-sm text-white/40">
              No miners yet — be the first!
            </div>
          ) : (
            board.slice(0, 50).map((r) => (
              <div
                key={r.userId}
                className={`flex items-center justify-between px-4 py-3 ${r.isMe ? 'bg-ice-400/10' : ''}`}
              >
                <div className="flex items-center gap-3">
                  <span className="w-6 text-center text-sm font-extrabold text-white/50">
                    {r.rank <= 3 ? ['🥇', '🥈', '🥉'][r.rank - 1] : r.rank}
                  </span>
                  {r.photoUrl ? (
                    <img src={r.photoUrl} alt="" className="h-8 w-8 rounded-full object-cover" />
                  ) : (
                    <span className="grid h-8 w-8 place-items-center rounded-full bg-ice-400/20 text-xs font-bold text-ice-200">
                      {r.name.slice(0, 1).toUpperCase()}
                    </span>
                  )}
                  <div>
                    <div className="text-sm font-bold">
                      {r.name}
                      {r.isMe && <span className="ml-1 text-[10px] text-ice-300">(You)</span>}
                    </div>
                    <div className="text-[11px] text-white/40">
                      {usdt(r.totalMined)} ICE mined
                    </div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-extrabold text-ice-300">
                    {r.hashrate.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                  </div>
                  <div className="text-[10px] text-white/40">{mining.unit}</div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <p className="text-center text-[11px] text-white/40">
        Mined ICE USD lands in your earned balance — withdraw as the ICE token or lock it in the
        Earned Vault.
      </p>
    </div>
  );
}
