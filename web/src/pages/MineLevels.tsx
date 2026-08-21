import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../store';
import { useToast } from '../components/Toast';
import { api, ApiError } from '../api';
import { haptic } from '../telegram';
import { usdt } from '../lib/format';
import { Sheet } from '../components/Sheet';
import type { LevelMiningState, BuyLevelInfo } from '../types';

/** Compact USD: $0.13 · $103K · $3.25M · $5M. */
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
/** Live token price, keeping precision for tiny values ($0.000428). */
function fmtPrice(n: number): string {
  if (!(n > 0)) return '—';
  return n >= 0.01 ? `$${n.toFixed(4)}` : `$${n.toPrecision(3)}`;
}

interface Props {
  mining: LevelMiningState;
  onDeposit: () => void;
}

export function MineLevels({ mining, onDeposit }: Props) {
  const { refreshMining, collectMining } = useStore();
  const toast = useToast();
  const c = mining.curve;

  // Client mirror of the server curve so we can render every level card.
  const holdRatio = useMemo(() => Math.pow(c.maxUsd / c.minUsd, 1 / (c.count - 1)), [c]);
  const speedRatio = useMemo(() => Math.pow(c.maxSpeed / c.minSpeed, 1 / (c.count - 1)), [c]);
  const requiredUsd = (lvl: number) => c.minUsd * Math.pow(holdRatio, lvl - 1);
  const speedFor = (lvl: number) => c.minSpeed * Math.pow(speedRatio, lvl - 1);

  // Live-ticking pool so the counter climbs between refreshes.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);
  const livePool = mining.pool + (mining.perHour / 3600) * tick;

  // Windowed level list (1..count). Start near the user's current level.
  const start = Math.max(1, mining.level - 2);
  const [shown, setShown] = useState(30);
  useEffect(() => setShown(30), [mining.level]);
  const [jump, setJump] = useState('');

  const [busy, setBusy] = useState<'collect' | 'connect' | 'buy' | null>(null);
  const [buy, setBuy] = useState<BuyLevelInfo | null>(null);

  async function collect() {
    setBusy('collect');
    try {
      const r = await collectMining();
      haptic('success');
      toast.show(`Collected ${usdt(r.collected)} ICE to your pool`, 'success');
    } catch (e) {
      toast.show(e instanceof ApiError ? e.message : 'Nothing to collect', 'error');
    } finally {
      setBusy(null);
    }
  }

  async function openBuy(level: number) {
    haptic('light');
    try {
      const info = await api.buyLevel(level);
      setBuy(info);
    } catch (e) {
      toast.show(e instanceof ApiError ? e.message : 'Could not open level', 'error');
    }
  }

  const jumpTo = () => {
    const n = Math.floor(Number(jump));
    if (Number.isFinite(n) && n >= 1 && n <= c.count) {
      // Grow the window so the target is included.
      setShown(Math.max(shown, n - start + 3));
      setTimeout(() => document.getElementById(`lvl-${n}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50);
    }
    setJump('');
  };

  const levels = useMemo(() => {
    const out: number[] = [];
    for (let i = 0; i < shown && start + i <= c.count; i++) out.push(start + i);
    return out;
  }, [shown, start, c.count]);

  return (
    <div className="space-y-4 pb-24">
      {/* Wallets */}
      <div className="card p-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs text-white/45">Holding Wallet · on-chain</div>
            <div className="mt-0.5 text-2xl font-extrabold">
              {usdt(mining.holding.tokens)} <span className="text-sm text-ice-300">ICE</span>
            </div>
            <div className="text-[11px] text-white/40">≈ {fmtUsd(mining.holding.usd)}</div>
          </div>
          <div className="text-right">
            <div className="text-xs text-white/45">Level</div>
            <div className="text-3xl font-extrabold text-ice-300">{mining.level}</div>
            <div className="text-[11px] text-white/40">{fmtSpeed(mining.speed, mining.speedUnit)}</div>
          </div>
        </div>
      </div>

      {/* Live on-chain price */}
      <div className="flex items-center justify-between rounded-2xl bg-white/5 px-4 py-2.5 text-xs">
        <span className="text-white/50">ICE price · live on-chain</span>
        <span className="font-bold text-emerald-300">{fmtPrice(mining.price)}</span>
      </div>

      {/* Wallet connect / status */}
      {mining.wallet.verified ? (
        <div className="flex items-center justify-between rounded-2xl bg-white/5 px-4 py-3 text-xs">
          <span className="text-white/60">
            Wallet <b className="text-white/80">{mining.wallet.address?.slice(0, 6)}…{mining.wallet.address?.slice(-4)}</b>
          </span>
          <button
            onClick={async () => {
              await api.walletDisconnect().catch(() => {});
              await refreshMining();
            }}
            className="text-red-300"
          >
            Disconnect
          </button>
        </div>
      ) : (
        <ConnectWallet onConnected={refreshMining} busy={busy === 'connect'} setBusy={(b) => setBusy(b ? 'connect' : null)} />
      )}

      {/* Pool wallet + collect */}
      <div className="card p-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs text-white/45">Pool Wallet · earned</div>
            <div className="mt-0.5 text-2xl font-extrabold tabular-nums text-usdt">
              {livePool.toFixed(4)}
            </div>
            <div className="text-[11px] text-white/40">
              {usdt(mining.perDay)} ICE / day · {mining.referral.miners} ref boost (+{usdt(mining.referral.bonus)}/day)
            </div>
          </div>
          <button
            disabled={busy === 'collect' || livePool <= 0}
            onClick={collect}
            className="btn-primary px-5 py-2.5 text-sm disabled:opacity-40"
          >
            {busy === 'collect' ? '…' : 'Claim'}
          </button>
        </div>
      </div>

      {/* Next level nudge */}
      {mining.nextLevel && (
        <button
          onClick={() => openBuy(mining.nextLevel!.level)}
          className="flex w-full items-center justify-between rounded-2xl border border-ice-400/30 bg-ice-400/10 px-4 py-3 text-left"
        >
          <div>
            <div className="text-sm font-bold">Reach Level {mining.nextLevel.level}</div>
            <div className="text-[11px] text-white/50">
              Need {usdt(mining.nextLevel.missingTokens)} more ICE ({fmtUsd(mining.nextLevel.missingUsd)})
            </div>
          </div>
          <span className="rounded-full bg-ice-400 px-3 py-1 text-xs font-bold text-night-900">Buy</span>
        </button>
      )}

      {/* Miner store */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-extrabold">Miner Store</h3>
        <div className="flex items-center gap-1">
          <input
            value={jump}
            onChange={(e) => setJump(e.target.value.replace(/[^0-9]/g, ''))}
            onKeyDown={(e) => e.key === 'Enter' && jumpTo()}
            placeholder="Level #"
            inputMode="numeric"
            className="w-20 rounded-lg bg-white/5 px-2 py-1 text-xs outline-none"
          />
          <button onClick={jumpTo} className="rounded-lg bg-white/10 px-2 py-1 text-xs">Go</button>
        </div>
      </div>
      <p className="-mt-2 text-[11px] text-white/40">
        Auto-unlocks from your on-chain ICE holding. Tap a locked level to buy in.
      </p>

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

      {/* Buy-level sheet */}
      <Sheet open={!!buy} onClose={() => setBuy(null)} title={buy ? `Level ${buy.level}` : ''}>
        {buy && (
          <div className="space-y-4">
            <Row label="Required holding" value={`${usdt(buy.requiredTokens)} ICE`} sub={fmtUsd(buy.requiredUsd)} />
            <Row label="Your holding" value={`${usdt(mining.holding.tokens)} ICE`} sub={fmtUsd(mining.holding.usd)} />
            <Row
              label="Missing to unlock"
              value={`${usdt(buy.missingTokens)} ICE`}
              sub={fmtUsd(buy.missingUsd)}
              danger={buy.missingUsd > 0}
            />
            {buy.missingUsd <= 0 ? (
              <div className="rounded-xl bg-emerald-400/10 p-3 text-center text-sm text-emerald-300">
                You already hold enough — this level is unlocked.
              </div>
            ) : (
              <>
                <p className="text-center text-[11px] text-white/40">
                  Buy {usdt(buy.missingTokens)} more ICE into your connected wallet to unlock. Sending tokens out
                  later lowers your level.
                </p>
                <a
                  href={buy.swapUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn-primary block w-full py-3 text-center"
                >
                  Buy ICE (swap)
                </a>
                <button onClick={() => { setBuy(null); onDeposit(); }} className="btn-ghost w-full py-3">
                  Deposit on IceBox instead
                </button>
              </>
            )}
          </div>
        )}
      </Sheet>
    </div>
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
function ConnectWallet({
  onConnected,
  busy,
  setBusy,
}: {
  onConnected: () => Promise<void>;
  busy: boolean;
  setBusy: (b: boolean) => void;
}) {
  const toast = useToast();
  const [address, setAddress] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [signature, setSignature] = useState('');

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
    <div className="card space-y-3 p-4">
      <div className="text-sm font-bold">Connect your BSC wallet</div>
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
