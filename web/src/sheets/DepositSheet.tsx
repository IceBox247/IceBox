import { useEffect, useMemo, useState } from 'react';
import { Sheet } from '../components/Sheet';
import { useStore } from '../store';
import { useToast } from '../components/Toast';
import { api, ApiError } from '../api';
import { haptic } from '../telegram';
import { usdt, shortAddress } from '../lib/format';
import { CopyIcon, DownArrowIcon, ChevronRightIcon } from '../components/icons';
import type { DepositCatalog, DepositAddressInfo } from '../types';

interface ChainOption {
  chainId: number;
  chainName: string;
  family: string;
  asset: string;
  decimals: number;
  logoURI: string;
}
interface Coin {
  symbol: string;
  name: string;
  logo: string;
  chains: ChainOption[];
}
interface Picked extends ChainOption {
  symbol: string;
}

// Coins shown up front, in this order. Everything else is reachable via search.
const POPULAR_SYMBOLS = ['USDT', 'USDC', 'BTC', 'ETH', 'BNB', 'SOL', 'TRX', 'POL', 'MATIC', 'AVAX', 'DAI'];
// Chain ordering when choosing where to send the picked coin.
const POPULAR_CHAINS = [56, 1, 8453, 42161, 10, 137, 43114, 792703809, 8253038, 728126428];
const chainRank = (id: number) => {
  const i = POPULAR_CHAINS.indexOf(id);
  return i === -1 ? 99 : i;
};

/** Round logo with a letter-disc fallback. */
function Logo({ symbol, logo, size = 34 }: { symbol: string; logo?: string; size?: number }) {
  const [broken, setBroken] = useState(false);
  if (logo && !broken) {
    return (
      <img
        src={logo}
        onError={() => setBroken(true)}
        width={size}
        height={size}
        className="rounded-full bg-white/10 object-cover"
        alt={symbol}
      />
    );
  }
  return (
    <span
      className="grid place-items-center rounded-full bg-ice-400/20 font-bold text-ice-200"
      style={{ width: size, height: size, fontSize: size * 0.38 }}
    >
      {(symbol || '?').slice(0, 2)}
    </span>
  );
}

const chainIcon = (chainId: number) => `https://assets.relay.link/icons/${chainId}/light.png`;

export function DepositSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { deposit, refreshDeposit } = useStore();
  const toast = useToast();
  const [catalog, setCatalog] = useState<DepositCatalog | null>(null);
  const [coin, setCoin] = useState<Coin | null>(null); // step 1 → 2
  const [picked, setPicked] = useState<Picked | null>(null); // step 2 → 3
  const [addr, setAddr] = useState<DepositAddressInfo | null>(null);
  const [addrLoading, setAddrLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    refreshDeposit().catch(() => {});
    api.depositTokens().then((c) => !cancelled && setCatalog(c)).catch(() => {});
    const timer = setInterval(() => refreshDeposit().catch(() => {}), 7000);
    return () => {
      cancelled = true;
      clearInterval(timer);
      setCoin(null);
      setPicked(null);
      setAddr(null);
      setQuery('');
    };
  }, [open, refreshDeposit]);

  // Fetch the deposit address once a chain is picked.
  useEffect(() => {
    if (!picked) return;
    let cancelled = false;
    setAddr(null);
    setAddrLoading(true);
    api
      .depositAddress(picked.chainId, picked.asset)
      .then((a) => !cancelled && setAddr(a))
      .catch((e) => {
        if (!cancelled) toast.show(e instanceof ApiError ? e.message : 'Could not get address', 'error');
      })
      .finally(() => !cancelled && setAddrLoading(false));
    return () => {
      cancelled = true;
    };
  }, [picked, toast]);

  // Group the flat catalog into coins (by symbol) → list of chains.
  const coins = useMemo(() => {
    const m = new Map<string, Coin>();
    for (const c of catalog?.chains ?? []) {
      for (const t of c.tokens) {
        const sym = (t.symbol || '').toUpperCase();
        if (!sym) continue;
        if (!m.has(sym)) m.set(sym, { symbol: sym, name: t.name || sym, logo: t.logoURI, chains: [] });
        const e = m.get(sym)!;
        if (!e.logo && t.logoURI) e.logo = t.logoURI;
        e.chains.push({
          chainId: c.chainId,
          chainName: c.name,
          family: c.family,
          asset: t.address || t.symbol,
          decimals: t.decimals,
          logoURI: t.logoURI,
        });
      }
    }
    return m;
  }, [catalog]);

  // Step-1 order: popular symbols first, then the rest alphabetically.
  const orderedCoins = useMemo(() => {
    const all = [...coins.values()];
    const rank = (s: string) => {
      const i = POPULAR_SYMBOLS.indexOf(s);
      return i === -1 ? 99 : i;
    };
    return all.sort((a, b) => rank(a.symbol) - rank(b.symbol) || a.symbol.localeCompare(b.symbol));
  }, [coins]);

  const coinResults = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return orderedCoins.slice(0, 12); // the popular grid
    return orderedCoins
      .filter((c) => c.symbol.toLowerCase().includes(q) || c.name.toLowerCase().includes(q))
      .slice(0, 40);
  }, [orderedCoins, query]);

  const chainResults = useMemo(() => {
    if (!coin) return [];
    const q = query.trim().toLowerCase();
    return [...coin.chains]
      .filter((c) => !q || c.chainName.toLowerCase().includes(q))
      .sort((a, b) => chainRank(a.chainId) - chainRank(b.chainId));
  }, [coin, query]);

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      haptic('success');
      toast.show('Address copied', 'success');
    } catch {
      toast.show('Copy failed — long-press to copy', 'error');
    }
  }

  async function checkNow() {
    setChecking(true);
    try {
      await api.refreshDeposits();
      await refreshDeposit();
      haptic('light');
      toast.show('Checked for your deposit', 'info');
    } catch (e) {
      toast.show(e instanceof ApiError ? e.message : 'Check failed', 'error');
    } finally {
      setChecking(false);
    }
  }

  // ── Disabled state ──
  if (deposit && !deposit.enabled) {
    return (
      <Sheet open={open} onClose={onClose} title="Deposit">
        <div className="py-8 text-center">
          <div className="mb-3 text-5xl">❄️</div>
          <p className="text-lg font-bold">Deposits aren’t available yet</p>
          <p className="mx-auto mt-2 max-w-xs text-white/55">
            {deposit.message || 'The deposit provider isn’t configured on this deployment yet.'}
          </p>
          <button onClick={onClose} className="btn-ghost mt-6 w-full py-4">
            Close
          </button>
        </div>
      </Sheet>
    );
  }

  // ── Step 1: pick a coin ──
  if (!coin) {
    return (
      <Sheet open={open} onClose={onClose} title="Deposit — pick a coin">
        <div className="space-y-4">
          <div className="rounded-2xl bg-ice-400/10 p-3 text-center text-xs text-white/60">
            Deposit <b className="text-ice-200">any crypto</b>. It’s credited as{' '}
            <b className="text-ice-200">USDT</b> to stake.
          </div>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search coins…"
            className="w-full rounded-xl border border-white/10 bg-night-700 px-4 py-3 text-white outline-none focus:border-ice-400"
          />
          {!catalog ? (
            <div className="py-8 text-center text-white/50">Loading coins…</div>
          ) : query ? (
            <div className="max-h-[46vh] space-y-1 overflow-y-auto">
              {coinResults.map((c) => (
                <button
                  key={c.symbol}
                  onClick={() => {
                    haptic('light');
                    setQuery('');
                    setCoin(c);
                  }}
                  className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-white/5"
                >
                  <Logo symbol={c.symbol} logo={c.logo} />
                  <div className="min-w-0 flex-1">
                    <div className="font-bold">{c.symbol}</div>
                    <div className="truncate text-xs text-white/40">
                      {c.chains.length} chain{c.chains.length > 1 ? 's' : ''}
                    </div>
                  </div>
                  <ChevronRightIcon width={16} height={16} />
                </button>
              ))}
              {coinResults.length === 0 && (
                <div className="py-6 text-center text-sm text-white/40">No coins match “{query}”.</div>
              )}
            </div>
          ) : (
            <div>
              <p className="mb-2 text-xs font-bold uppercase tracking-wide text-white/40">Popular</p>
              <div className="grid grid-cols-3 gap-2">
                {coinResults.map((c) => (
                  <button
                    key={c.symbol}
                    onClick={() => {
                      haptic('light');
                      setCoin(c);
                    }}
                    className="flex flex-col items-center gap-1.5 rounded-2xl border border-white/10 bg-white/5 px-2 py-3"
                  >
                    <Logo symbol={c.symbol} logo={c.logo} size={36} />
                    <span className="text-sm font-bold">{c.symbol}</span>
                  </button>
                ))}
              </div>
              <p className="mt-3 text-center text-xs text-white/40">…or search for 70+ more coins.</p>
            </div>
          )}
          {deposit && deposit.deposits.length > 0 && (
            <button onClick={checkNow} disabled={checking} className="btn-ghost w-full py-3 text-sm">
              {checking ? 'Checking…' : 'Check recent deposits'}
            </button>
          )}
        </div>
      </Sheet>
    );
  }

  // ── Step 2: pick a chain for the coin ──
  if (!picked) {
    return (
      <Sheet open={open} onClose={onClose} title={`Deposit ${coin.symbol}`}>
        <div className="space-y-4">
          <button
            onClick={() => {
              setCoin(null);
              setQuery('');
            }}
            className="flex items-center gap-2 text-sm font-semibold text-white/50"
          >
            ‹ Change coin
          </button>
          <div className="flex items-center gap-3 rounded-2xl bg-white/5 p-4">
            <Logo symbol={coin.symbol} logo={coin.logo} size={40} />
            <div>
              <div className="font-extrabold">{coin.symbol}</div>
              <div className="text-xs text-white/45">Choose the network to send on</div>
            </div>
          </div>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search networks…"
            className="w-full rounded-xl border border-white/10 bg-night-700 px-4 py-3 text-white outline-none focus:border-ice-400"
          />
          <div className="max-h-[46vh] space-y-1 overflow-y-auto">
            {chainResults.map((ch) => (
              <button
                key={`${ch.chainId}:${ch.asset}`}
                onClick={() => {
                  haptic('light');
                  setQuery('');
                  setPicked({ ...ch, symbol: coin.symbol });
                }}
                className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-white/5"
              >
                <Logo symbol={ch.chainName} logo={chainIcon(ch.chainId)} size={30} />
                <div className="min-w-0 flex-1 font-semibold">{ch.chainName}</div>
                <ChevronRightIcon width={16} height={16} />
              </button>
            ))}
          </div>
        </div>
      </Sheet>
    );
  }

  // ── Step 3: address ──
  return (
    <Sheet open={open} onClose={onClose} title={`Deposit ${picked.symbol}`}>
      <div className="space-y-4">
        <button
          onClick={() => {
            setPicked(null);
            setAddr(null);
          }}
          className="flex items-center gap-2 text-sm font-semibold text-white/50"
        >
          ‹ Change network
        </button>
        <div className="flex items-center gap-3 rounded-2xl bg-white/5 p-4">
          <Logo symbol={picked.symbol} logo={picked.logoURI} size={40} />
          <div>
            <div className="font-extrabold">{picked.symbol}</div>
            <div className="text-xs text-white/45">on {picked.chainName}</div>
          </div>
        </div>
        <div className="rounded-2xl bg-ice-400/10 p-3 text-center text-xs text-white/60">
          Send <b className="text-ice-200">{picked.symbol}</b> (on {picked.chainName}) to this address.
          It’s credited as <b className="text-ice-200">USDT</b> once it settles.
        </div>
        {addrLoading || !addr ? (
          <div className="py-8 text-center text-white/50">Generating your address…</div>
        ) : (
          <div className="rounded-2xl border border-white/10 bg-night-700 p-4">
            <div className="mb-1 text-xs uppercase tracking-wide text-white/40">
              Your {picked.symbol} deposit address
            </div>
            <button
              onClick={() => copy(addr.address)}
              className="flex w-full items-center justify-between gap-3 text-left"
            >
              <span className="break-all font-mono text-sm text-white/90">{addr.address}</span>
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-ice-400/15 text-ice-300">
                <CopyIcon width={16} height={16} />
              </span>
            </button>
            {addr.minDeposit ? (
              <p className="mt-2 text-xs text-white/40">
                ⚠️ Send only {picked.symbol} on {picked.chainName}. Min ≈ {usdt(addr.minDeposit)} USDT.
              </p>
            ) : null}
          </div>
        )}
        <button onClick={checkNow} disabled={checking} className="btn-primary w-full py-4 disabled:opacity-50">
          {checking ? 'Checking…' : "I've sent it — check now"}
        </button>
        {deposit && deposit.deposits.length > 0 && (
          <div className="space-y-2">
            <p className="text-sm font-bold uppercase tracking-wide text-white/40">Recent</p>
            {deposit.deposits.map((d) => (
              <div
                key={d.id}
                className="flex items-center justify-between rounded-xl bg-white/5 px-4 py-3 text-sm"
              >
                <div className="flex items-center gap-2">
                  <span
                    className={`grid h-8 w-8 place-items-center rounded-lg ${
                      d.credited ? 'bg-usdt/15 text-usdt' : 'bg-white/10 text-white/50'
                    }`}
                  >
                    <DownArrowIcon width={16} height={16} />
                  </span>
                  <div>
                    <div className="font-semibold">{usdt(d.amount)} USDT</div>
                    <div className="text-xs text-white/40">
                      {d.credited ? 'Credited' : d.status || 'pending'}
                      {d.originTxHash ? ` · ${shortAddress(d.originTxHash)}` : ''}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
        <button onClick={onClose} className="btn-ghost w-full py-4">
          Close
        </button>
      </div>
    </Sheet>
  );
}
