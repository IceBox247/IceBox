import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store';
import { useToast } from '../components/Toast';
import { api, ApiError } from '../api';
import { haptic } from '../telegram';
import { usdt, ice } from '../lib/format';
import { Sheet } from '../components/Sheet';
import { sfx, isMuted, toggleMuted } from '../lib/sound';
import { hasInjectedWallet, requestInjectedAddress, connectAndSign, walletDeepLinks, openExternal } from '../lib/wallet';
import { WhitepaperView } from './Whitepaper';
import type { LevelMiningState, BuyLevelInfo, MinerRankRow, MinerJourney } from '../types';

/** Compact USD: $0.13 · $103K · $3.25M. */
function fmtUsd(n: number): string {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2).replace(/\.00$/, '')}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2).replace(/\.00$/, '')}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(n >= 1e5 ? 0 : 1).replace(/\.0$/, '')}K`;
  if (n >= 1) return `$${n.toFixed(2)}`;
  return `$${n.toFixed(3)}`;
}
function fmtSpeed(n: number, unit: string): string {
  return `${n.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${unit}`;
}
function fmtPrice(n: number): string {
  if (!(n > 0)) return '—';
  return n >= 0.01 ? `$${n.toFixed(4)}` : `$${n.toPrecision(3)}`;
}
/** Live-ticking ICE amount — more decimals when small so it visibly counts up. */
function fmtLiveIce(n: number): string {
  if (n >= 1000) return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
  if (n >= 1) return n.toFixed(4);
  return n.toFixed(6);
}
/** Tier name for a level, ice-themed (Frost → Polar Vortex). */
function levelName(level: number, count: number): string {
  const f = level / Math.max(1, count);
  if (f < 0.1) return 'FROST';
  if (f < 0.25) return 'GLACIER';
  if (f < 0.45) return 'ICEBERG';
  if (f < 0.7) return 'AVALANCHE';
  return 'POLAR VORTEX';
}

interface Props {
  mining: LevelMiningState;
  onDeposit: () => void;
}

function Avatar({ name, photoUrl }: { name: string; photoUrl: string | null }) {
  const [broken, setBroken] = useState(false);
  if (photoUrl && !broken)
    return <img src={photoUrl} alt="" onError={() => setBroken(true)} className="h-8 w-8 rounded-full object-cover" />;
  return (
    <span className="grid h-8 w-8 place-items-center rounded-full bg-ice-400/20 text-xs font-bold text-ice-200">
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}

export function MineLevels({ mining, onDeposit }: Props) {
  const { refreshMining, collectMining } = useStore();
  const toast = useToast();
  const c = mining.curve;

  // Live "ready to claim" that visibly ticks up every frame. We anchor to the
  // server's pool value and the wall clock at mount, then add the per-second
  // accrual so the number keeps counting between refreshes (not static).
  const anchor = useRef({ pool: mining.pool, at: Date.now() });
  useEffect(() => {
    anchor.current = { pool: mining.pool, at: Date.now() };
  }, [mining.pool, mining.perHour]);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(id);
  }, []);
  const elapsedSec = Math.max(0, (now - anchor.current.at) / 1000);
  const pending = anchor.current.pool + (mining.perHour / 3600) * elapsedSec; // "ready to claim"
  // Pool Wallet = total ICE the user holds on the platform (collected + pending).
  const poolWallet = mining.earnedBalance + pending;
  // Holding Wallet = the real on-chain wallet balance (0 until a wallet with ICE
  // is connected). A migration/holding credit powers the level only, not this.
  const assets = mining.holding.tokens + poolWallet;

  // Progress toward the next level, from the holding curve.
  const holdRatio = useMemo(() => Math.pow(c.maxUsd / c.minUsd, 1 / (c.count - 1)), [c]);
  const reqUsd = (lvl: number) => (lvl < 1 ? 0 : c.minUsd * Math.pow(holdRatio, lvl - 1));
  const curReq = reqUsd(mining.level);
  const nextReq = mining.nextLevel ? mining.nextLevel.requiredUsd : curReq;
  const pct = nextReq > curReq ? Math.max(4, Math.min(100, ((mining.holding.usd - curReq) / (nextReq - curReq)) * 100)) : 100;

  const [busy, setBusy] = useState(false);
  const [storeOpen, setStoreOpen] = useState(false);
  const [boardOpen, setBoardOpen] = useState(false);
  const [connectOpen, setConnectOpen] = useState(false);
  const [paperOpen, setPaperOpen] = useState(false);
  const [soundOff, setSoundOff] = useState(isMuted);

  // Celebrate whenever the mining level ticks up (chime + haptic).
  const prevLevel = useRef(mining.level);
  useEffect(() => {
    if (mining.level > prevLevel.current) {
      sfx.levelUp();
      haptic('success');
    }
    prevLevel.current = mining.level;
  }, [mining.level]);

  async function collect() {
    setBusy(true);
    try {
      const r = await collectMining();
      sfx.claim();
      haptic('success');
      toast.show(`Collected ${usdt(r.collected)} ICE`, 'success');
    } catch (e) {
      sfx.error();
      toast.show(e instanceof ApiError ? e.message : 'Nothing to collect', 'error');
    } finally {
      setBusy(false);
    }
  }

  const card = 'rounded-2xl border border-ice-400/15 bg-white/[0.03]';

  return (
    <div className="animate-fade-in space-y-3.5 px-4 pb-28 pt-1">
      <style>{`
        @keyframes mineBob{0%,100%{transform:translateY(0)}50%{transform:translateY(-8px)}}
        @keyframes mineSpin{to{transform:rotate(360deg)}}
        @keyframes mineSpinR{to{transform:rotate(-360deg)}}
        @keyframes minePulse{0%{transform:scale(.7);opacity:.5}100%{transform:scale(1.5);opacity:0}}
        @keyframes minePop{0%,100%{transform:scale(1)}50%{transform:scale(1.05)}}
        @keyframes mineGlow{0%,100%{box-shadow:0 0 40px -6px rgba(51,194,255,.6)}50%{box-shadow:0 0 70px 0 rgba(51,194,255,.9)}}
        @keyframes mineHalo{0%,100%{opacity:.45;transform:translate(-50%,-50%) scale(1)}50%{opacity:.85;transform:translate(-50%,-50%) scale(1.12)}}
        @keyframes mineRise{0%{transform:translateY(0);opacity:0}15%{opacity:1}100%{transform:translateY(-96px);opacity:0}}
        @keyframes mineFlicker{0%,100%{opacity:.9}50%{opacity:.35}}
        @keyframes coinBob{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}
        @keyframes coinSpin3d{0%,100%{transform:rotateY(-16deg)}50%{transform:rotateY(16deg)}}
        @keyframes coinShine{0%{transform:translateX(-140%) rotate(20deg)}60%,100%{transform:translateX(160%) rotate(20deg)}}
      `}</style>

      {/* Header */}
      <div className="relative flex items-center justify-center">
        <div className="text-[11px] font-extrabold uppercase tracking-[0.4em] text-ice-200/80">
          ❄ Glacier Mine
        </div>
        <button
          onClick={() => {
            const off = toggleMuted();
            setSoundOff(off);
            if (!off) sfx.click();
          }}
          aria-label={soundOff ? 'Unmute sounds' : 'Mute sounds'}
          className="absolute right-0 grid h-7 w-7 place-items-center rounded-full bg-white/5 text-sm text-white/60"
        >
          {soundOff ? '🔇' : '🔊'}
        </button>
      </div>

      {/* Level + connect + progress */}
      <div className={`${card} p-3.5`}>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <div className="grid h-11 w-11 place-items-center rounded-xl border border-ice-400/30 bg-gradient-to-br from-ice-400/25 to-ice-600/5 text-lg text-ice-100">
              ❄
            </div>
            <div className="leading-none">
              <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/40">
                Level {mining.level}
              </div>
              <div className="mt-1 text-lg font-extrabold tracking-tight text-ice-100">
                {levelName(mining.level, c.count)}
              </div>
            </div>
          </div>
          <button
            onClick={() => setConnectOpen(true)}
            className={
              mining.wallet.verified
                ? 'rounded-full bg-white/5 px-3 py-1.5 text-xs font-bold text-white/70'
                : 'btn-primary px-4 py-2.5 text-xs font-bold uppercase tracking-wide'
            }
          >
            {mining.wallet.verified
              ? `${mining.wallet.address?.slice(0, 5)}…${mining.wallet.address?.slice(-3)}`
              : 'Connect Wallet'}
          </button>
        </div>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/10">
          <div className="h-full rounded-full bg-gradient-to-r from-ice-300 to-ice-500" style={{ width: `${pct}%` }} />
        </div>
        {mining.nextLevel && mining.nextLevel.missingUsd > 0 && (
          <div className="mt-2 text-center text-xs font-semibold uppercase tracking-wide text-ice-300">
            {fmtUsd(mining.nextLevel.missingUsd)} left to level up
          </div>
        )}
      </div>

      {/* Total assets */}
      <div className={`${card} p-3.5 text-center`}>
        <div className="text-[11px] font-bold uppercase tracking-[0.3em] text-white/35">Total Assets</div>
        <div className="mt-0.5 text-4xl font-extrabold tracking-tight">
          {ice(assets)} <span className="text-xl text-ice-300">ICE</span>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-[11px]">
            <div className="uppercase tracking-wide text-white/40">Holding Wallet</div>
            <div className="mt-0.5"><b>{ice(mining.holding.tokens)}</b> <span className="text-ice-300">ICE</span></div>
          </div>
          <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-[11px]">
            <div className="uppercase tracking-wide text-white/40">Pool Wallet</div>
            <div className="mt-0.5"><b>{ice(poolWallet)}</b> <span className="text-ice-300">ICE</span></div>
          </div>
        </div>
      </div>

      {/* Coin hero — the spinning ICE coin, tap to claim */}
      <div className="relative overflow-hidden rounded-2xl border border-ice-400/20 py-4" style={{ background: 'radial-gradient(120% 80% at 50% 0%, #0e2740 0%, #08182b 70%)' }}>
        <div className="relative z-10 mx-auto mb-3 w-fit rounded-full border border-emerald-400/40 bg-emerald-400/10 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-emerald-400">
          <span style={{ animation: 'mineFlicker 1.4s ease-in-out infinite' }}>●</span> Mining Active
        </div>

        {/* coin — tap to claim */}
        <div className="relative mx-auto h-[210px] w-[210px]" style={{ perspective: '900px' }}>
          {/* rotating conic halo + pulsing glow behind the coin */}
          <div
            className="pointer-events-none absolute left-1/2 top-1/2 h-[250px] w-[250px] rounded-full"
            style={{
              background: 'conic-gradient(from 0deg, rgba(51,194,255,0), rgba(51,194,255,.4), rgba(51,194,255,0), rgba(120,220,255,.35), rgba(51,194,255,0))',
              transform: 'translate(-50%,-50%)',
              animation: 'mineSpin 8s linear infinite',
              filter: 'blur(16px)',
            }}
          />
          <div
            className="pointer-events-none absolute left-1/2 top-1/2 h-[200px] w-[200px] rounded-full"
            style={{
              background: 'radial-gradient(circle, rgba(51,194,255,.4) 0%, rgba(51,194,255,0) 62%)',
              animation: 'mineHalo 3s ease-in-out infinite',
            }}
          />
          {/* floating spark particles rising off the coin */}
          {[...Array(6)].map((_, i) => (
            <span
              key={i}
              className="pointer-events-none absolute bottom-4 z-20 h-1 w-1 rounded-full bg-ice-100"
              style={{
                left: `${20 + i * 11}%`,
                boxShadow: '0 0 6px 1px rgba(120,220,255,.9)',
                animation: `mineRise ${3 + (i % 3)}s ease-in ${i * 0.5}s infinite`,
              }}
            />
          ))}
          <button
            onClick={() => { sfx.tap(); collect(); }}
            disabled={busy}
            aria-label="Claim mined ICE"
            className="relative z-10 block h-full w-full select-none rounded-full transition active:scale-95"
            style={{ animation: 'coinBob 4s ease-in-out infinite' }}
          >
            <div className="relative h-full w-full" style={{ transformStyle: 'preserve-3d', animation: 'coinSpin3d 5s ease-in-out infinite' }}>
              <img
                src="/coin.png"
                alt="ICE coin"
                draggable={false}
                className="h-full w-full rounded-full"
                style={{ filter: 'drop-shadow(0 8px 22px rgba(51,194,255,.55))' }}
              />
              {/* moving shine sweep across the coin face */}
              <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-full">
                <div
                  className="absolute -inset-y-4 left-0 w-1/3"
                  style={{
                    background: 'linear-gradient(90deg, transparent, rgba(255,255,255,.55), transparent)',
                    animation: 'coinShine 4.5s ease-in-out infinite',
                  }}
                />
              </div>
            </div>
          </button>
        </div>

        <div className="relative z-10 mx-auto mt-3 w-fit rounded-xl border border-ice-400/20 bg-black/25 px-5 py-2 text-center">
          <div>
            <span className="text-xl font-extrabold tabular-nums text-ice-300">+{fmtLiveIce(pending)}</span>
            <span className="ml-2 text-[11px] font-semibold uppercase tracking-wide text-white/60">Ready to claim</span>
          </div>
          <div className="mt-0.5 text-[10px] font-medium text-white/45">
            Earning <b className="text-ice-200">{fmtLiveIce(mining.perDay)}</b> ICE/day · {fmtLiveIce(mining.perHour)}/hr
          </div>
        </div>
      </div>

      {/* CLAIM */}
      <button
        onClick={collect}
        disabled={busy || pending <= 0}
        className="w-full rounded-2xl bg-gradient-to-b from-ice-200 to-ice-500 py-4 text-lg font-black uppercase tracking-wide text-night-900 shadow-[0_0_34px_-6px_rgba(51,194,255,0.85)] transition active:scale-[0.98] disabled:opacity-40"
        style={!busy && pending > 0 ? { animation: 'minePop 2s ease-in-out infinite' } : undefined}
      >
        {busy ? 'Claiming…' : `Claim ${fmtLiveIce(pending)} ICE`}
      </button>

      {/* Buy / Leaderboard */}
      <div className="grid grid-cols-2 gap-3">
        <button onClick={() => { sfx.click(); setStoreOpen(true); }} className={`${card} flex items-center justify-center gap-2 py-3.5 text-sm font-bold`}>
          <span className="text-lg text-amber-300">⚡</span> Buy Hashrate
        </button>
        <button onClick={() => { sfx.click(); setBoardOpen(true); }} className={`${card} flex items-center justify-center gap-2 py-3.5 text-sm font-bold`}>
          <span className="text-lg">🏆</span> Leaderboard
        </button>
      </div>

      {/* Price / hashrate strip */}
      <div className={`${card} flex items-center justify-between px-4 py-3 text-xs`}>
        <span className="text-white/60">💲 ICE PRICE <b className="text-emerald-300">{fmtPrice(mining.price)}</b></span>
        <span className="flex items-center gap-1.5 text-white/60">
          HASHRATE <b className="text-ice-300">{fmtSpeed(mining.speed, mining.speedUnit)}</b>
          <span className="h-2 w-2 rounded-full bg-emerald-400" />
        </span>
      </div>

      {/* Sheets */}
      <StoreSheet
        open={storeOpen}
        onClose={() => setStoreOpen(false)}
        mining={mining}
        onDeposit={onDeposit}
        onConnect={() => {
          setStoreOpen(false);
          setConnectOpen(true);
        }}
      />
      {/* Floating whitepaper button (like ATF's "?") */}
      <button
        onClick={() => { sfx.click(); setPaperOpen(true); }}
        aria-label="White paper"
        className="fixed bottom-24 left-4 z-30 grid h-12 w-12 place-items-center rounded-full border border-ice-400/40 bg-night-900/80 text-xl font-black text-ice-200 shadow-[0_0_24px_-4px_rgba(51,194,255,0.7)] backdrop-blur"
      >
        ?
      </button>

      <Sheet open={paperOpen} onClose={() => setPaperOpen(false)} title="White Paper">
        <WhitepaperView />
        <button onClick={() => setPaperOpen(false)} className="btn-ghost mt-2 w-full py-3">
          Close
        </button>
      </Sheet>

      <LeaderboardSheet open={boardOpen} onClose={() => setBoardOpen(false)} />
      <Sheet open={connectOpen} onClose={() => setConnectOpen(false)} title="Connect Wallet">
        {mining.wallet.verified ? (
          <div className="space-y-4">
            <div className="rounded-2xl bg-white/5 p-4 text-center text-sm">
              Connected <b className="text-ice-200">{mining.wallet.address?.slice(0, 8)}…{mining.wallet.address?.slice(-6)}</b>
              <div className="mt-1 text-[11px] text-white/40">Holding {ice(mining.holding.tokens)} ICE · Level {mining.level}</div>
            </div>
            <button
              onClick={async () => {
                setBusy(true);
                await api.walletDisconnect().catch(() => {});
                await refreshMining();
                setBusy(false);
                setConnectOpen(false);
              }}
              className="btn-ghost w-full py-3 text-red-300"
            >
              Disconnect wallet
            </button>
          </div>
        ) : (
          <ConnectWallet
            onConnected={async () => {
              await refreshMining();
              setConnectOpen(false);
            }}
          />
        )}
      </Sheet>
    </div>
  );
}

/** Compact ICE amount for P&L labels: 4,739 · 1.2K · 42.75. */
function fmtIceC(n: number): string {
  const a = Math.abs(n);
  if (a >= 1000) return n.toLocaleString(undefined, { maximumFractionDigits: 1 });
  if (a >= 1) return n.toFixed(2);
  return n.toFixed(4);
}
/** ICE-denominated asset value of a journey point (assetsUsd priced in ICE). */
function pointIce(assetsUsd: number, price: number): number {
  return price > 0 ? assetsUsd / price : 0;
}

/**
 * "My Level Journey" stats card — a trading-style panel showing the user's total
 * ICE assets over time as a glowing area chart, with current/peak level and
 * today's P&L (change in ICE assets). Tap to open the full PNL chart.
 */
function JourneyCard({
  open,
  level,
  onOpen,
}: {
  open: boolean;
  level: number;
  onOpen: (j: MinerJourney) => void;
}) {
  const [j, setJ] = useState<MinerJourney | null>(null);
  useEffect(() => {
    if (!open) return;
    setJ(null);
    api.miningJourney().then(setJ).catch(() => setJ(null));
  }, [open, level]);

  const price = j?.price ?? 0;
  const W = 300;
  const H = 84;
  const pts = j?.points?.length ? j.points : [{ level, assetsUsd: 0, at: '' }];
  const raw = pts.length === 1 ? [pts[0], pts[0]] : pts;
  const vals = raw.map((p) => pointIce(p.assetsUsd, price));
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = max - min || 1;
  const changeIce = pointIce(j?.todayChangeUsd ?? 0, price);
  const up = changeIce >= 0;
  const stroke = up ? '#34d399' : '#f87171';
  const coords = vals.map((v, i) => {
    const x = (i / (vals.length - 1)) * W;
    const y = 10 + (1 - (v - min) / span) * (H - 20);
    return [x, y] as const;
  });
  const line = coords.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const area = `${line} L${W},${H} L0,${H} Z`;
  const [ex, ey] = coords[coords.length - 1];
  const atAth = (j?.current ?? level) >= (j?.peak ?? level);

  return (
    <button
      onClick={() => j && onOpen(j)}
      disabled={!j}
      className="block w-full overflow-hidden rounded-2xl border border-emerald-400/20 bg-gradient-to-b from-emerald-400/[0.07] to-transparent text-left"
    >
      <div className="flex items-start justify-between px-4 pt-3.5">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-[0.25em] text-white/40">My Level Journey</div>
          <div className="mt-0.5 text-lg font-black leading-tight text-ice-100">
            Level {j?.current ?? level} <span className="text-white/40">· Peak {j?.peak ?? level}</span>
          </div>
          <div className="mt-1 flex items-baseline gap-1.5 text-[11px]">
            <span className="text-white/45">Today’s P&amp;L</span>
            <b className={`tabular-nums ${up ? 'text-emerald-300' : 'text-red-300'}`}>
              {up ? '+' : '−'}{fmtIceC(Math.abs(changeIce))} ICE
            </b>
          </div>
        </div>
        <div
          className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-extrabold ${
            atAth ? 'bg-emerald-400/15 text-emerald-300' : 'bg-white/10 text-white/60'
          }`}
        >
          ▲ {atAth ? 'All-time high' : 'Journey'}
        </div>
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="mt-2 block h-20 w-full">
        <defs>
          <linearGradient id="jArea" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={stroke} stopOpacity="0.35" />
            <stop offset="100%" stopColor={stroke} stopOpacity="0" />
          </linearGradient>
          <filter id="jGlow" x="-20%" y="-40%" width="140%" height="180%">
            <feGaussianBlur stdDeviation="2.5" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <path d={area} fill="url(#jArea)" />
        <path d={line} fill="none" stroke={stroke} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" filter="url(#jGlow)" />
        <circle cx={ex} cy={ey} r="3.5" fill={stroke}>
          <animate attributeName="r" values="3.5;7;3.5" dur="1.8s" repeatCount="indefinite" />
          <animate attributeName="opacity" values="0.9;0;0.9" dur="1.8s" repeatCount="indefinite" />
        </circle>
      </svg>

      <div className="flex items-center justify-between border-t border-emerald-400/10 px-4 py-2.5 text-xs font-bold text-emerald-300">
        <span>📈 {j ? 'Tap to view full PNL chart' : 'Loading…'}</span>
        <span aria-hidden>→</span>
      </div>
    </button>
  );
}

/**
 * Full-screen P&L chart — the user's total ICE assets across every recorded
 * journey snapshot. Pan by dragging, zoom with pinch or wheel, tap a point to
 * read its level/value/date (ATF-style tracking).
 */
function FullPnlSheet({
  open,
  onClose,
  data,
}: {
  open: boolean;
  onClose: () => void;
  data: MinerJourney | null;
}) {
  const price = data?.price ?? 0;
  const series = useMemo(() => {
    const pts = data?.points ?? [];
    const arr = pts.map((p) => ({ ...p, ice: pointIce(p.assetsUsd, price) }));
    return arr.length === 1 ? [arr[0], arr[0]] : arr;
  }, [data, price]);

  const [zoom, setZoom] = useState(1);
  const [sel, setSel] = useState<number | null>(null);
  useEffect(() => {
    if (open) {
      setZoom(1);
      setSel(null);
    }
  }, [open]);

  const changeIce = pointIce(data?.todayChangeUsd ?? 0, price);
  const up = changeIce >= 0;
  const stroke = up ? '#34d399' : '#f87171';
  const atAth = (data?.current ?? 0) >= (data?.peak ?? 0);

  // Chart geometry. Inner width scales with zoom; the scroll container pans.
  const H = 300;
  const baseW = 320;
  const W = Math.round(baseW * zoom);
  const padT = 16;
  const padB = 28;
  const vals = series.map((p) => p.ice);
  const min = Math.min(...vals, 0);
  const max = Math.max(...vals, 1);
  const span = max - min || 1;
  const xOf = (i: number) => (series.length <= 1 ? 0 : (i / (series.length - 1)) * (W - 8) + 4);
  const yOf = (v: number) => padT + (1 - (v - min) / span) * (H - padT - padB);
  const coords = series.map((p, i) => [xOf(i), yOf(p.ice)] as const);
  const line = coords.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const areaPath = `${line} L${coords[coords.length - 1]?.[0] ?? 0},${H - padB} L${coords[0]?.[0] ?? 0},${H - padB} Z`;

  // Pinch-to-zoom (two-finger) tracking.
  const pinch = useRef<{ d: number; z: number } | null>(null);
  const dist = (t: React.TouchList) =>
    Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);

  const yTicks = [max, min + span * 0.66, min + span * 0.33, min];

  return (
    <Sheet open={open} onClose={onClose} title="Level Journey">
      {!data ? (
        <div className="py-16 text-center text-white/40">Loading…</div>
      ) : (
        <div className="space-y-4">
          {/* Stat tiles */}
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
              <div className="text-[10px] font-bold uppercase tracking-wide text-white/40">Current</div>
              <div className="mt-1 text-xl font-black">Lv {data.current}</div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
              <div className="text-[10px] font-bold uppercase tracking-wide text-white/40">Peak</div>
              <div className="mt-1 text-xl font-black text-emerald-300">Lv {data.peak}</div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
              <div className="text-[10px] font-bold uppercase tracking-wide text-white/40">Today</div>
              <div className={`mt-1 text-lg font-black ${up ? 'text-emerald-300' : 'text-red-300'}`}>
                {up ? '▲' : '▼'} {up ? '+' : '−'}{fmtIceC(Math.abs(changeIce))}
              </div>
            </div>
          </div>

          <div className="text-center text-[11px] font-semibold uppercase tracking-wide text-white/40">
            {atAth ? '❄️ At all-time high' : 'Total ICE assets over time'}
          </div>

          {/* Interactive chart: scroll = pan, pinch/wheel = zoom, tap = detail */}
          <div
            className="relative overflow-x-auto no-scrollbar rounded-2xl border border-white/10 bg-black/30"
            onWheel={(e) => {
              if (e.ctrlKey || Math.abs(e.deltaY) > 0) {
                setZoom((z) => Math.min(6, Math.max(1, z - Math.sign(e.deltaY) * 0.2)));
              }
            }}
            onTouchStart={(e) => {
              if (e.touches.length === 2) pinch.current = { d: dist(e.touches), z: zoom };
            }}
            onTouchMove={(e) => {
              if (e.touches.length === 2 && pinch.current) {
                const ratio = dist(e.touches) / pinch.current.d;
                setZoom(Math.min(6, Math.max(1, pinch.current.z * ratio)));
              }
            }}
            onTouchEnd={() => {
              pinch.current = null;
            }}
          >
            <svg
              width={W}
              height={H}
              viewBox={`0 0 ${W} ${H}`}
              className="block touch-pan-x"
              onClick={(e) => {
                const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
                const x = ((e.clientX - rect.left) / rect.width) * W;
                let best = 0;
                let bd = Infinity;
                coords.forEach(([cx], i) => {
                  const d = Math.abs(cx - x);
                  if (d < bd) {
                    bd = d;
                    best = i;
                  }
                });
                setSel(best);
              }}
            >
              <defs>
                <linearGradient id="pnlArea" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={stroke} stopOpacity="0.3" />
                  <stop offset="100%" stopColor={stroke} stopOpacity="0" />
                </linearGradient>
              </defs>
              {/* gridlines */}
              {yTicks.map((v, i) => (
                <g key={i}>
                  <line x1="0" x2={W} y1={yOf(v)} y2={yOf(v)} stroke="rgba(255,255,255,.06)" strokeWidth="1" />
                </g>
              ))}
              <path d={areaPath} fill="url(#pnlArea)" />
              <path d={line} fill="none" stroke={stroke} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
              {/* selected crosshair */}
              {sel != null && coords[sel] && (
                <g>
                  <line x1={coords[sel][0]} x2={coords[sel][0]} y1={padT} y2={H - padB} stroke="rgba(255,255,255,.25)" strokeDasharray="3 3" />
                  <circle cx={coords[sel][0]} cy={coords[sel][1]} r="5" fill={stroke} stroke="#0b1e17" strokeWidth="2" />
                </g>
              )}
              {/* live end dot */}
              {sel == null && coords.length > 0 && (
                <circle cx={coords[coords.length - 1][0]} cy={coords[coords.length - 1][1]} r="4" fill={stroke}>
                  <animate attributeName="r" values="4;8;4" dur="1.8s" repeatCount="indefinite" />
                  <animate attributeName="opacity" values="1;0;1" dur="1.8s" repeatCount="indefinite" />
                </circle>
              )}
            </svg>
            {/* y-axis labels (fixed overlay) */}
            <div className="pointer-events-none absolute left-1 top-0 flex h-full flex-col justify-between py-2 text-[9px] text-white/35">
              {yTicks.map((v, i) => (
                <span key={i}>{fmtIceC(v)}</span>
              ))}
            </div>
          </div>

          {/* Selected point detail */}
          {sel != null && series[sel] && (
            <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
              <div>
                <div className="text-sm font-bold">Level {series[sel].level}</div>
                <div className="text-[11px] text-white/45">
                  {series[sel].at ? new Date(series[sel].at).toLocaleString() : '—'}
                </div>
              </div>
              <div className="text-right">
                <div className="text-sm font-extrabold text-ice-300">{fmtIceC(series[sel].ice)} ICE</div>
                <div className="text-[10px] text-white/40">{fmtUsd(series[sel].assetsUsd)}</div>
              </div>
            </div>
          )}

          <p className="text-center text-[11px] text-white/40">
            Drag to pan · Pinch or scroll to zoom · Tap a point for details
          </p>
          <button onClick={onClose} className="btn-ghost w-full py-3">
            Close
          </button>
        </div>
      )}
    </Sheet>
  );
}

/** The Miner Store — 1..count level cards, jump-to-level, and buy-level flow. */
function StoreSheet({
  open,
  onClose,
  mining,
  onDeposit,
  onConnect,
}: {
  open: boolean;
  onClose: () => void;
  mining: LevelMiningState;
  onDeposit: () => void;
  onConnect: () => void;
}) {
  const toast = useToast();
  const c = mining.curve;
  const holdRatio = useMemo(() => Math.pow(c.maxUsd / c.minUsd, 1 / (c.count - 1)), [c]);
  const speedRatio = useMemo(() => Math.pow(c.maxSpeed / c.minSpeed, 1 / (c.count - 1)), [c]);
  const requiredUsd = (lvl: number) => c.minUsd * Math.pow(holdRatio, lvl - 1);
  const speedFor = (lvl: number) => c.minSpeed * Math.pow(speedRatio, lvl - 1);

  const start = Math.max(1, mining.level - 2);
  const [shown, setShown] = useState(30);
  useEffect(() => setShown(30), [mining.level, open]);
  const [jump, setJump] = useState('');
  const [buy, setBuy] = useState<BuyLevelInfo | null>(null);
  const [pnl, setPnl] = useState<MinerJourney | null>(null);
  const [buying, setBuying] = useState(false);
  const { refreshMining } = useStore();

  /** Spend deposited USDT (converted to ICE at the live price) to buy the level. */
  async function buyWithBalance() {
    if (!buy) return;
    setBuying(true);
    try {
      const r = await api.purchaseLevel(buy.level);
      await refreshMining();
      haptic('success');
      toast.show(`⚡ Level ${r.level} unlocked — spent ${fmtUsd(r.spentUsd)}`, 'success');
      setBuy(null);
    } catch (e) {
      toast.show(e instanceof ApiError ? e.message : 'Could not buy level', 'error');
    } finally {
      setBuying(false);
    }
  }

  const levels = useMemo(() => {
    const out: number[] = [];
    for (let i = 0; i < shown && start + i <= c.count; i++) out.push(start + i);
    return out;
  }, [shown, start, c.count]);

  async function openBuy(level: number) {
    haptic('light');
    try {
      setBuy(await api.buyLevel(level));
    } catch (e) {
      toast.show(e instanceof ApiError ? e.message : 'Could not open level', 'error');
    }
  }
  const jumpTo = () => {
    const n = Math.floor(Number(jump));
    if (Number.isFinite(n) && n >= 1 && n <= c.count) {
      setShown((s) => Math.max(s, n - start + 3));
      setTimeout(() => document.getElementById(`lvl-${n}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50);
    }
    setJump('');
  };

  return (
    <Sheet open={open} onClose={onClose} title="Miner Store">
      <div className="space-y-4">
        <JourneyCard open={open} level={mining.level} onOpen={setPnl} />

        {!mining.wallet.verified && (
          <button onClick={onConnect} className="w-full rounded-2xl border border-ice-400/30 bg-ice-400/10 px-4 py-3 text-left text-sm">
            <b>⚡ Connect wallet to boost mining</b>
            <div className="text-[11px] text-white/50">The more ICE you hold, the higher your Level and the faster you mine.</div>
          </button>
        )}

        {mining.nextLevel && mining.nextLevel.missingUsd > 0 && (
          <button
            onClick={() => openBuy(mining.nextLevel!.level)}
            className="flex w-full items-center justify-between rounded-2xl border border-ice-400/30 bg-ice-400/10 px-4 py-3 text-left"
          >
            <div>
              <div className="text-sm font-bold">Reach Level {mining.nextLevel.level}</div>
              <div className="text-[11px] text-white/50">
                Need {ice(mining.nextLevel.missingTokens)} more ICE ({fmtUsd(mining.nextLevel.missingUsd)})
              </div>
            </div>
            <span className="rounded-full bg-ice-400 px-3 py-1 text-xs font-bold text-night-900">Buy</span>
          </button>
        )}

        <div className="flex items-center justify-between">
          <p className="text-[11px] text-white/40">Auto-unlocks from your on-chain ICE holding.</p>
          <div className="flex items-center gap-1">
            <input
              value={jump}
              onChange={(e) => setJump(e.target.value.replace(/[^0-9]/g, ''))}
              onKeyDown={(e) => e.key === 'Enter' && jumpTo()}
              placeholder="Lvl #"
              inputMode="numeric"
              className="w-16 rounded-lg bg-white/5 px-2 py-1 text-xs outline-none"
            />
            <button onClick={jumpTo} className="rounded-lg bg-white/10 px-2 py-1 text-xs">Go</button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          {levels.map((lvl) => {
            const active = lvl === mining.level;
            const unlocked = lvl <= mining.level;
            return (
              <button
                key={lvl}
                id={`lvl-${lvl}`}
                onClick={() => !unlocked && openBuy(lvl)}
                className={`rounded-2xl border p-3 text-left ${
                  active
                    ? 'border-ice-400 bg-ice-400/10'
                    : unlocked
                      ? 'border-emerald-400/30 bg-emerald-400/5'
                      : 'border-white/10 bg-white/[0.03]'
                }`}
              >
                <div className="text-[11px] text-white/50">Lvl {lvl}</div>
                <div className={`mt-1 text-xl font-extrabold ${unlocked ? 'text-emerald-300' : 'text-white/80'}`}>
                  {fmtUsd(requiredUsd(lvl))}
                </div>
                <div className="mt-0.5 text-[10px] text-white/40">Speed {fmtSpeed(speedFor(lvl), mining.speedUnit)}</div>
                <div className="mt-2 text-center text-xs font-bold">
                  {active ? (
                    <span className="text-ice-300">● ACTIVE</span>
                  ) : unlocked ? (
                    <span className="text-emerald-300">Unlocked</span>
                  ) : (
                    <span className="text-white/40">🔒 Locked</span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
        {start + shown <= c.count && (
          <button onClick={() => setShown((s) => s + 30)} className="btn-ghost w-full py-3">
            Show more levels
          </button>
        )}
      </div>

      {/* Buy-level confirm */}
      <Sheet open={!!buy} onClose={() => setBuy(null)} title={buy ? `Level ${buy.level}` : ''}>
        {buy && (
          <div className="space-y-4">
            <Row label="Required holding" value={`${ice(buy.requiredTokens)} ICE`} sub={fmtUsd(buy.requiredUsd)} />
            <Row label="Your holding" value={`${ice(buy.yourTokens)} ICE`} sub={fmtUsd(buy.yourUsd)} />
            <Row label="Missing to unlock" value={`${ice(buy.missingTokens)} ICE`} sub={fmtUsd(buy.missingUsd)} danger={buy.missingUsd > 0} />
            {buy.missingUsd <= 0 ? (
              <div className="rounded-xl bg-emerald-400/10 p-3 text-center text-sm text-emerald-300">
                You already hold enough — this level is unlocked.
              </div>
            ) : (
              <>
                {/* Seamless: buy the level straight from the IceBox balance. */}
                <button
                  onClick={buyWithBalance}
                  disabled={buying}
                  className="w-full rounded-2xl bg-gradient-to-b from-emerald-300 to-emerald-500 py-4 text-base font-black text-night-900 shadow-[0_0_28px_-6px_rgba(52,211,153,0.8)] transition active:scale-[0.98] disabled:opacity-50"
                >
                  {buying ? 'Buying…' : `⚡ Buy Level ${buy.level} · ${fmtUsd(buy.missingUsd)}`}
                </button>
                <p className="text-center text-[11px] text-white/45">
                  Pays {fmtUsd(buy.missingUsd)} from your IceBox balance (USDT → ICE at the live price).
                </p>
                <div className="my-1 text-center text-[10px] uppercase tracking-widest text-white/25">or buy ICE into your own wallet</div>
                <p className="text-center text-[11px] text-white/40">
                  Buy {ice(buy.missingTokens)} more ICE into your wallet — open the swap
                  <b> inside your wallet app</b> so it's connected.
                </p>
                <div className="grid grid-cols-3 gap-2">
                  {walletDeepLinks(buy.swapUrl).map((w) => (
                    <a
                      key={w.key}
                      href={w.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex flex-col items-center gap-1 rounded-xl border border-ice-400/25 bg-ice-400/10 py-3 text-[11px] font-bold text-ice-100"
                    >
                      <span className="text-xl">{w.icon}</span> {w.label}
                    </a>
                  ))}
                </div>
                <a href={buy.swapUrl} target="_blank" rel="noopener noreferrer" className="block w-full py-1 text-center text-[11px] text-white/40">
                  or open in browser
                </a>
                <button onClick={() => { setBuy(null); onClose(); onDeposit(); }} className="btn-ghost w-full py-3">
                  Deposit on IceBox instead
                </button>
              </>
            )}
          </div>
        )}
      </Sheet>

      {/* Full-screen PNL chart */}
      <FullPnlSheet open={!!pnl} onClose={() => setPnl(null)} data={pnl} />
    </Sheet>
  );
}

/** Top miners by level/holding then ICE claimed. */
function LeaderboardSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [board, setBoard] = useState<MinerRankRow[] | null>(null);
  useEffect(() => {
    if (!open) return;
    setBoard(null);
    api.miningLeaderboard().then((r) => setBoard(r.leaderboard)).catch(() => setBoard([]));
  }, [open]);
  return (
    <Sheet open={open} onClose={onClose} title="Top Miners">
      {board === null ? (
        <div className="py-10 text-center text-white/40">Loading…</div>
      ) : board.length === 0 ? (
        <div className="py-10 text-center text-white/40">No miners yet — be the first!</div>
      ) : (
        <div className="divide-y divide-white/5">
          {board.slice(0, 100).map((r) => (
            <div key={r.userId} className={`flex items-center justify-between py-3 ${r.isMe ? 'rounded-xl bg-ice-400/10 px-2' : ''}`}>
              <div className="flex items-center gap-3">
                <span className="w-6 text-center text-sm font-extrabold text-white/50">
                  {r.rank <= 3 ? ['🥇', '🥈', '🥉'][r.rank - 1] : r.rank}
                </span>
                <Avatar name={r.name} photoUrl={r.photoUrl} />
                <div>
                  <div className="text-sm font-bold">
                    {r.name}
                    {r.isMe && <span className="ml-1 text-[10px] text-ice-300">(You)</span>}
                  </div>
                  <div className="text-[11px] text-white/45">
                    {r.level > 0 ? `Lvl ${r.level} · ${fmtUsd(r.holdingUsd)} held` : 'Mining rewards'}
                  </div>
                </div>
              </div>
              <div className="text-right">
                {r.rewardUsdt > 0 ? (
                  <>
                    <div className="text-sm font-extrabold text-usdt">
                      ≈ {fmtUsd(r.rewardUsdt)}
                      <span className="ml-0.5 text-[10px] font-semibold text-usdt/70">/day</span>
                    </div>
                    <div className="text-[10px] text-white/45">{fmtUsd(r.totalClaimedUsdt)} USDT claimed</div>
                  </>
                ) : (
                  <>
                    <div className="text-sm font-extrabold text-ice-300">{ice(r.totalClaimed)} ICE</div>
                    <div className="text-[10px] text-white/40">claimed</div>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      <p className="mt-3 text-center text-[11px] text-white/40">
        Top ranks earn real <b className="text-usdt">USDT</b> daily. Ranked by level, then ICE claimed —
        higher holding climbs the board.
      </p>
    </Sheet>
  );
}

function Row({ label, value, sub, danger }: { label: string; value: string; sub?: string; danger?: boolean }) {
  return (
    <div className="flex items-center justify-between rounded-xl bg-white/5 px-4 py-3">
      <span className="text-sm text-white/60">{label}</span>
      <div className="text-right">
        <div className={`text-sm font-bold ${danger ? 'text-red-300' : ''}`}>{value}</div>
        {sub && <div className="text-[11px] text-white/40">{sub}</div>}
      </div>
    </div>
  );
}

/**
 * Connect a wallet to boost mining. On mobile, wallets have no standalone
 * "sign message" screen — so the reliable path is to open a tiny IceBox connect
 * page INSIDE the wallet's own browser (where signing works), tied back to this
 * account by a one-time link token. We poll for the bind to complete. Injected
 * providers (desktop / in-wallet browser) get a direct one-tap; manual paste is
 * the last resort.
 */
function ConnectWallet({ onConnected }: { onConnected: () => Promise<void> }) {
  const toast = useToast();
  const injected = hasInjectedWallet();
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<'main' | 'manual'>('main');
  const [link, setLink] = useState<{ connectUrl: string; metamask: string; trust: string } | null>(null);
  // manual state
  const [address, setAddress] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [signature, setSignature] = useState('');

  const nonceFor = async (a: string) => (await api.walletNonce(a)).message;

  // Once a link is opened, poll for the wallet to be bound (from the browser flow).
  useEffect(() => {
    if (!link) return;
    let alive = true;
    const id = setInterval(async () => {
      try {
        const r = await api.refreshMiningChain();
        const m = r.mining as { wallet?: { verified?: boolean } };
        if (alive && m?.wallet?.verified) {
          clearInterval(id);
          haptic('success');
          toast.show('Wallet connected — mining boosted ⚡', 'success');
          await onConnected();
        }
      } catch {
        /* keep polling */
      }
    }, 3000);
    return () => {
      alive = false;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [link]);

  /** Direct one-tap when a provider is injected (desktop / inside a wallet browser). */
  async function connectInjected() {
    setBusy(true);
    try {
      const addr = await requestInjectedAddress();
      const { signature: sig } = await connectAndSign(await nonceFor(addr));
      await api.walletConnect(addr, sig);
      await onConnected();
      haptic('success');
      toast.show('Wallet connected — mining boosted ⚡', 'success');
    } catch (e: any) {
      toast.show(e instanceof ApiError ? e.message : 'Could not connect', 'error');
    } finally {
      setBusy(false);
    }
  }

  /** Telegram path: mint a link token and show wallet-browser options. */
  async function startLink() {
    setBusy(true);
    try {
      setLink(await api.walletLinkToken());
    } catch (e) {
      toast.show(e instanceof ApiError ? e.message : 'Could not start — try again', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function getMessage() {
    setBusy(true);
    try {
      setMessage((await api.walletNonce(address.trim())).message);
    } catch (e) {
      toast.show(e instanceof ApiError ? e.message : 'Invalid address', 'error');
    } finally {
      setBusy(false);
    }
  }
  async function connectManual() {
    setBusy(true);
    try {
      await api.walletConnect(address.trim(), signature.trim());
      await onConnected();
      haptic('success');
      toast.show('Wallet connected ⚡', 'success');
    } catch (e) {
      toast.show(e instanceof ApiError ? e.message : 'Could not verify wallet', 'error');
    } finally {
      setBusy(false);
    }
  }

  const intro = (
    <div className="rounded-xl border border-ice-400/20 bg-ice-400/5 p-3 text-[12px] leading-relaxed text-white/75">
      <b className="text-ice-200">Boost your mining rate.</b> The more ICE you hold in your connected
      wallet, the higher your Level and the faster you mine.
    </div>
  );

  // Step: wallet-browser options after a link token is minted.
  if (link) {
    return (
      <div className="space-y-3">
        {intro}
        <p className="text-[12px] text-white/60">
          Open IceBox <b>inside your wallet’s app</b> to connect &amp; sign in one tap:
        </p>
        <div className="grid grid-cols-2 gap-2">
          <button onClick={() => openExternal(link.metamask)} className="btn-primary flex items-center justify-center gap-2 py-3.5 text-sm">
            🦊 MetaMask
          </button>
          <button onClick={() => openExternal(link.trust)} className="btn-primary flex items-center justify-center gap-2 py-3.5 text-sm">
            🛡️ Trust
          </button>
        </div>
        <button
          onClick={() => { navigator.clipboard?.writeText(link.connectUrl); toast.show('Link copied — open your wallet app → its Browser/DApp tab → paste', 'success'); }}
          className="w-full rounded-xl border border-ice-400/30 bg-ice-400/10 py-3 text-xs font-bold text-ice-200"
        >
          📋 Other wallet? Copy link → paste in its browser
        </button>
        <p className="text-center text-[11px] text-ice-300/80">
          ⏳ Waiting for you to connect… this closes automatically once done.
        </p>
        <button onClick={() => { setLink(null); setMode('manual'); }} className="w-full py-1 text-[11px] text-white/40">
          Advanced: paste address + signature
        </button>
      </div>
    );
  }

  if (mode === 'manual') {
    return (
      <div className="space-y-3">
        {intro}
        <p className="text-[11px] text-white/45">
          Advanced: paste your wallet address, then a signature. Note — most mobile wallets can only
          sign inside their own browser, so the wallet buttons above are easier.
        </p>
        <input
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="Your 0x… BSC wallet address"
          className="w-full rounded-xl bg-white/5 px-3 py-2.5 text-sm outline-none"
        />
        {!message ? (
          <button onClick={getMessage} disabled={busy || address.trim().length < 42} className="btn-primary w-full py-2.5 text-sm disabled:opacity-40">
            {busy ? '…' : 'Continue'}
          </button>
        ) : (
          <>
            <div className="rounded-xl bg-white/5 p-3 text-[12px] text-white/70">
              <div className="rounded-lg bg-black/30 p-2">
                <code className="block whitespace-pre-wrap break-all text-[11px] text-white/70">{message}</code>
              </div>
              <button
                onClick={() => { navigator.clipboard?.writeText(message); toast.show('Message copied', 'success'); }}
                className="mt-2 rounded-lg bg-ice-400/15 px-3 py-1.5 text-[12px] font-bold text-ice-200"
              >
                📋 Copy message
              </button>
            </div>
            <input
              value={signature}
              onChange={(e) => setSignature(e.target.value)}
              placeholder="Paste the signature (0x…) here"
              className="w-full rounded-xl bg-white/5 px-3 py-2.5 text-sm outline-none"
            />
            <button onClick={connectManual} disabled={busy || signature.trim().length < 10} className="btn-primary w-full py-2.5 text-sm disabled:opacity-40">
              {busy ? '…' : 'Verify & connect'}
            </button>
          </>
        )}
        <button onClick={() => { setMode('main'); setMessage(null); }} className="w-full py-1 text-[11px] text-white/40">
          ← Back
        </button>
      </div>
    );
  }

  // Main entry.
  return (
    <div className="space-y-3">
      {intro}
      <button
        onClick={injected ? connectInjected : startLink}
        disabled={busy}
        className="btn-primary w-full py-3.5 text-base disabled:opacity-50"
      >
        {busy ? 'Starting…' : '🔗 Connect Wallet'}
      </button>
      <p className="text-center text-[11px] text-white/45">
        Opens your wallet to connect &amp; sign — free, no gas, can’t move funds.
      </p>
      <button onClick={() => setMode('manual')} className="w-full py-1 text-[11px] text-white/40">
        Advanced: paste address manually
      </button>
    </div>
  );
}
