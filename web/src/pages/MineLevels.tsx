import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../store';
import { useToast } from '../components/Toast';
import { api, ApiError } from '../api';
import { haptic } from '../telegram';
import { usdt, ice } from '../lib/format';
import { Sheet } from '../components/Sheet';
import type { LevelMiningState, BuyLevelInfo, MinerRankRow } from '../types';

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

interface Props {
  mining: LevelMiningState;
  onDeposit: () => void;
}

/** Avatar that falls back to the name initial. */
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

  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);
  const livePool = mining.pool + (mining.perHour / 3600) * tick;
  const assets = mining.holding.tokens + livePool;

  const [busy, setBusy] = useState(false);
  const [storeOpen, setStoreOpen] = useState(false);
  const [boardOpen, setBoardOpen] = useState(false);
  const [connectOpen, setConnectOpen] = useState(false);

  async function collect() {
    setBusy(true);
    try {
      const r = await collectMining();
      haptic('success');
      toast.show(`Collected ${usdt(r.collected)} ICE`, 'success');
    } catch (e) {
      toast.show(e instanceof ApiError ? e.message : 'Nothing to collect', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="animate-fade-in space-y-4 px-5 pb-28 pt-3">
      <style>{`
        @keyframes mineBob{0%,100%{transform:translateY(0)}50%{transform:translateY(-10px)}}
        @keyframes mineSpin{to{transform:rotate(360deg)}}
        @keyframes minePulse{0%{transform:scale(.85);opacity:.55}100%{transform:scale(1.5);opacity:0}}
        @keyframes mineShine{0%{transform:translateX(-140%) rotate(12deg)}60%,100%{transform:translateX(240%) rotate(12deg)}}
        @keyframes minePop{0%,100%{transform:scale(1)}50%{transform:scale(1.06)}}
        @keyframes mineFloat{0%{transform:translateY(0);opacity:0}20%{opacity:1}100%{transform:translateY(-70px);opacity:0}}
      `}</style>
      {/* Top row: level + status + wallet */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-white/10 px-3 py-1 text-sm font-extrabold">Lvl {mining.level}</span>
          <span className="flex items-center gap-1 text-xs font-bold text-emerald-400">
            ● {mining.wallet.verified ? 'READY' : 'CONNECT'}
          </span>
        </div>
        {mining.wallet.verified ? (
          <button
            onClick={() => setConnectOpen(true)}
            className="rounded-full bg-white/5 px-3 py-1.5 text-xs font-bold text-white/70"
          >
            {mining.wallet.address?.slice(0, 5)}…{mining.wallet.address?.slice(-3)}
          </button>
        ) : (
          <button onClick={() => setConnectOpen(true)} className="btn-primary px-4 py-2 text-sm">
            Connect Wallet
          </button>
        )}
      </div>
      {mining.nextLevel && mining.nextLevel.missingUsd > 0 && (
        <div className="text-xs font-semibold text-emerald-300">
          {fmtUsd(mining.nextLevel.missingUsd)} left to Level Up
        </div>
      )}

      {/* Assets */}
      <div className="text-center">
        <div className="text-xs font-bold uppercase tracking-[0.3em] text-white/35">Assets</div>
        <div className="mt-1 text-4xl font-extrabold tracking-tight">
          {ice(assets)} <span className="text-xl text-ice-300">ICE</span>
        </div>
        <div className="mt-3 flex flex-col items-center gap-2">
          <div className="rounded-full bg-white/5 px-4 py-1.5 text-xs">
            <span className="text-white/45">HOLDING WALLET:</span> <b>{ice(mining.holding.tokens)}</b>{' '}
            <span className="text-ice-300">ICE</span>
          </div>
          <div className="rounded-full bg-white/5 px-4 py-1.5 text-xs">
            <span className="text-white/45">POOL WALLET:</span> <b>{ice(livePool)}</b>{' '}
            <span className="text-ice-300">ICE</span>
          </div>
        </div>
        <div
          className="mx-auto mt-3 w-fit rounded-2xl border border-emerald-400/30 bg-emerald-400/10 px-8 py-2.5 text-3xl font-extrabold tabular-nums text-emerald-400"
          style={livePool > 0 ? { animation: 'minePop 1.6s ease-in-out infinite' } : undefined}
        >
          +{livePool.toFixed(4)}
        </div>
      </div>

      {/* Animated coin — tap to claim */}
      <div className="relative grid place-items-center py-6">
        {/* pulsing glow rings */}
        <span className="pointer-events-none absolute h-40 w-40 rounded-full bg-ice-400/25" style={{ animation: 'minePulse 2.4s ease-out infinite' }} />
        <span className="pointer-events-none absolute h-40 w-40 rounded-full bg-ice-400/20" style={{ animation: 'minePulse 2.4s ease-out infinite', animationDelay: '1.2s' }} />
        {/* rotating aura */}
        <span
          className="pointer-events-none absolute h-52 w-52 rounded-full opacity-70 blur-[2px]"
          style={{ background: 'conic-gradient(from 0deg, transparent, rgba(51,194,255,.45), transparent 55%)', animation: 'mineSpin 6s linear infinite' }}
        />
        {/* floating sparkles */}
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="pointer-events-none absolute bottom-8 text-lg"
            style={{ left: `${38 + i * 12}%`, animation: `mineFloat ${2.6 + i * 0.5}s ease-in ${i * 0.7}s infinite` }}
          >
            ❄️
          </span>
        ))}
        {/* the coin */}
        <button
          onClick={collect}
          disabled={busy}
          className="relative grid h-40 w-40 place-items-center overflow-hidden rounded-full bg-gradient-to-br from-ice-200 via-ice-400 to-ice-600 text-4xl font-black tracking-tight text-night-900 shadow-[0_0_60px_-4px_rgba(51,194,255,0.75)] transition active:scale-95"
          style={{ animation: 'mineBob 3.2s ease-in-out infinite' }}
        >
          <span className="absolute inset-2 rounded-full ring-2 ring-white/25" />
          <span className="pointer-events-none absolute -inset-y-2 left-0 w-1/3 bg-white/30 blur-md" style={{ animation: 'mineShine 3.5s ease-in-out infinite' }} />
          <span className="relative">ICE</span>
        </button>
      </div>

      {/* CLAIM */}
      <button
        onClick={collect}
        disabled={busy || livePool <= 0}
        className="btn-primary w-full py-4 text-lg font-extrabold shadow-[0_0_30px_-8px_rgba(51,194,255,0.8)] disabled:opacity-40"
        style={!busy && livePool > 0 ? { animation: 'minePop 2s ease-in-out infinite' } : undefined}
      >
        {busy ? 'Claiming…' : 'CLAIM'}
      </button>

      {/* Buy Hashrate / Leaderboard */}
      <div className="grid grid-cols-2 gap-3">
        <button onClick={() => setStoreOpen(true)} className="btn-ghost flex-col gap-1 py-3">
          <span className="text-xl">⚡</span>
          <span className="text-sm font-bold">Buy Hashrate</span>
        </button>
        <button onClick={() => setBoardOpen(true)} className="btn-ghost flex-col gap-1 py-3">
          <span className="text-xl">🏆</span>
          <span className="text-sm font-bold">Leaderboard</span>
        </button>
      </div>

      <p className="text-center text-[11px] text-white/40">
        ICE price · live {fmtPrice(mining.price)} · {fmtSpeed(mining.speed, mining.speedUnit)}
      </p>

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
      <LeaderboardSheet open={boardOpen} onClose={() => setBoardOpen(false)} unit={mining.speedUnit} />
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
        {!mining.wallet.verified && (
          <button onClick={onConnect} className="w-full rounded-2xl border border-ice-400/30 bg-ice-400/10 px-4 py-3 text-left text-sm">
            <b>Connect your BSC wallet</b>
            <div className="text-[11px] text-white/50">Your on-chain ICE holding sets your level.</div>
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
            <Row label="Your holding" value={`${ice(mining.holding.tokens)} ICE`} sub={fmtUsd(mining.holding.usd)} />
            <Row label="Missing to unlock" value={`${ice(buy.missingTokens)} ICE`} sub={fmtUsd(buy.missingUsd)} danger={buy.missingUsd > 0} />
            {buy.missingUsd <= 0 ? (
              <div className="rounded-xl bg-emerald-400/10 p-3 text-center text-sm text-emerald-300">
                You already hold enough — this level is unlocked.
              </div>
            ) : (
              <>
                <p className="text-center text-[11px] text-white/40">
                  Buy {ice(buy.missingTokens)} more ICE into your connected wallet to unlock. Sending tokens out later
                  lowers your level.
                </p>
                <a href={buy.swapUrl} target="_blank" rel="noopener noreferrer" className="btn-primary block w-full py-3 text-center">
                  Buy ICE (swap)
                </a>
                <button onClick={() => { setBuy(null); onClose(); onDeposit(); }} className="btn-ghost w-full py-3">
                  Deposit on IceBox instead
                </button>
              </>
            )}
          </div>
        )}
      </Sheet>
    </Sheet>
  );
}

/** Top miners by level/holding. */
function LeaderboardSheet({ open, onClose, unit }: { open: boolean; onClose: () => void; unit: string }) {
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
                  <div className="text-[11px] text-white/45">{usdt(r.totalClaimed)} ICE claimed</div>
                </div>
              </div>
              <div className="text-right">
                <div className="text-sm font-extrabold text-ice-300">Lvl {r.level}</div>
                <div className="text-[10px] text-white/40">{fmtUsd(r.holdingUsd)}</div>
              </div>
            </div>
          ))}
        </div>
      )}
      <p className="mt-3 text-center text-[11px] text-white/40">Ranked by level ({unit} from holding).</p>
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

/** Paste address → sign the issued message in your wallet → paste signature. */
function ConnectWallet({ onConnected }: { onConnected: () => Promise<void> }) {
  const toast = useToast();
  const [address, setAddress] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [signature, setSignature] = useState('');
  const [busy, setBusy] = useState(false);

  async function getMessage() {
    setBusy(true);
    try {
      const r = await api.walletNonce(address.trim());
      setMessage(r.message);
      toast.show('Sign this message in your wallet, then paste the signature', 'success');
    } catch (e) {
      toast.show(e instanceof ApiError ? e.message : 'Invalid address', 'error');
    } finally {
      setBusy(false);
    }
  }
  async function connect() {
    setBusy(true);
    try {
      await api.walletConnect(address.trim(), signature.trim());
      await onConnected();
      haptic('success');
      toast.show('Wallet connected — level synced from your holding', 'success');
    } catch (e) {
      toast.show(e instanceof ApiError ? e.message : 'Could not verify wallet', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-[11px] text-white/45">
        Your on-chain ICE holding sets your mining level. Connect the wallet you hold ICE in.
      </p>
      <input
        value={address}
        onChange={(e) => setAddress(e.target.value)}
        placeholder="0x… wallet address"
        className="w-full rounded-xl bg-white/5 px-3 py-2.5 text-sm outline-none"
      />
      {!message ? (
        <button onClick={getMessage} disabled={busy || address.trim().length < 42} className="btn-primary w-full py-2.5 text-sm disabled:opacity-40">
          {busy ? '…' : 'Continue'}
        </button>
      ) : (
        <>
          <div className="rounded-xl bg-white/5 p-3">
            <div className="mb-1 text-[11px] text-white/45">Sign this exact message in your wallet:</div>
            <code className="block whitespace-pre-wrap break-all text-[11px] text-white/70">{message}</code>
            <button
              onClick={() => { navigator.clipboard?.writeText(message); toast.show('Message copied', 'success'); }}
              className="mt-2 text-[11px] text-ice-300"
            >
              Copy message
            </button>
          </div>
          <input
            value={signature}
            onChange={(e) => setSignature(e.target.value)}
            placeholder="Paste signature (0x…)"
            className="w-full rounded-xl bg-white/5 px-3 py-2.5 text-sm outline-none"
          />
          <button onClick={connect} disabled={busy || signature.trim().length < 10} className="btn-primary w-full py-2.5 text-sm disabled:opacity-40">
            {busy ? '…' : 'Verify & connect'}
          </button>
        </>
      )}
    </div>
  );
}
