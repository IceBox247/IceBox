import { useEffect, useMemo, useState } from 'react';
import { Sheet } from '../components/Sheet';
import { useStore } from '../store';
import { useToast } from '../components/Toast';
import { api, ApiError } from '../api';
import { haptic } from '../telegram';
import { usdt, shortAddress } from '../lib/format';
import { CopyIcon, DownArrowIcon, ChevronRightIcon } from '../components/icons';
import type { DepositCatalog, FeaturedToken, DepositAddressInfo } from '../types';

interface Picked {
  chainId: number;
  asset: string;
  symbol: string;
  chainName: string;
  logoURI: string;
}

/** Small round coin logo with a letter-disc fallback. */
function Coin({ symbol, logo, size = 32 }: { symbol: string; logo?: string; size?: number }) {
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
      style={{ width: size, height: size, fontSize: size * 0.4 }}
    >
      {(symbol || '?').slice(0, 2)}
    </span>
  );
}

export function DepositSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { deposit, refreshDeposit } = useStore();
  const toast = useToast();
  const [catalog, setCatalog] = useState<DepositCatalog | null>(null);
  const [picked, setPicked] = useState<Picked | null>(null);
  const [addr, setAddr] = useState<DepositAddressInfo | null>(null);
  const [addrLoading, setAddrLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [checking, setChecking] = useState(false);

  // Load history + the coin catalog when the sheet opens.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    refreshDeposit().catch(() => {});
    api
      .depositTokens()
      .then((c) => !cancelled && setCatalog(c))
      .catch(() => {});
    const timer = setInterval(() => refreshDeposit().catch(() => {}), 7000);
    return () => {
      cancelled = true;
      clearInterval(timer);
      setPicked(null);
      setAddr(null);
      setQuery('');
    };
  }, [open, refreshDeposit]);

  // Fetch the deposit address whenever a coin is picked.
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

  const allTokens = useMemo(() => {
    if (!catalog) return [] as FeaturedToken[];
    const out: FeaturedToken[] = [];
    for (const c of catalog.chains) {
      for (const t of c.tokens) {
        out.push({
          chainId: c.chainId,
          chainName: c.name,
          family: c.family,
          symbol: t.symbol,
          name: t.name,
          asset: t.address || t.symbol,
          decimals: t.decimals,
          logoURI: t.logoURI,
        });
      }
    }
    return out;
  }, [catalog]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return allTokens
      .filter(
        (t) =>
          t.symbol.toLowerCase().includes(q) ||
          (t.name || '').toLowerCase().includes(q) ||
          (t.chainName || '').toLowerCase().includes(q),
      )
      .slice(0, 40);
  }, [query, allTokens]);

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

  const pick = (t: FeaturedToken) => {
    haptic('light');
    setPicked({ chainId: t.chainId, asset: t.asset, symbol: t.symbol, chainName: t.chainName, logoURI: t.logoURI });
  };

  // ── Coin picker view ──
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

  if (!picked) {
    return (
      <Sheet open={open} onClose={onClose} title="Deposit — pick a coin">
        <div className="space-y-4">
          <div className="rounded-2xl bg-ice-400/10 p-3 text-center text-xs text-white/60">
            Deposit <b className="text-ice-200">any crypto</b>. It’s converted and credited as{' '}
            <b className="text-ice-200">ICE USD</b> (1:1 with USD) to stake.
          </div>

          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search 70+ coins & chains…"
            className="w-full rounded-xl border border-white/10 bg-night-700 px-4 py-3 text-white outline-none focus:border-ice-400"
          />

          {!catalog ? (
            <div className="py-8 text-center text-white/50">Loading coins…</div>
          ) : query ? (
            <div className="max-h-[46vh] space-y-1 overflow-y-auto">
              {results.map((t) => (
                <button
                  key={`${t.chainId}:${t.asset}`}
                  onClick={() => pick(t)}
                  className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-white/5"
                >
                  <Coin symbol={t.symbol} logo={t.logoURI} />
                  <div className="min-w-0 flex-1">
                    <div className="font-bold">{t.symbol}</div>
                    <div className="truncate text-xs text-white/40">{t.chainName}</div>
                  </div>
                  <ChevronRightIcon width={16} height={16} />
                </button>
              ))}
              {results.length === 0 && (
                <div className="py-6 text-center text-sm text-white/40">No coins match “{query}”.</div>
              )}
            </div>
          ) : (
            <div>
              <p className="mb-2 text-xs font-bold uppercase tracking-wide text-white/40">Popular</p>
              <div className="grid grid-cols-2 gap-2">
                {catalog.featured.map((t) => (
                  <button
                    key={`${t.chainId}:${t.asset}`}
                    onClick={() => pick(t)}
                    className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/5 px-3 py-3 text-left"
                  >
                    <Coin symbol={t.symbol} logo={t.logoURI} />
                    <div className="min-w-0">
                      <div className="font-bold leading-tight">{t.symbol}</div>
                      <div className="truncate text-[11px] text-white/40">{t.chainName}</div>
                    </div>
                  </button>
                ))}
              </div>
              <p className="mt-3 text-center text-xs text-white/40">
                …or search above for any of 70+ supported coins.
              </p>
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

  // ── Address view for the picked coin ──
  return (
    <Sheet open={open} onClose={onClose} title={`Deposit ${picked.symbol}`}>
      <div className="space-y-4">
        <button
          onClick={() => setPicked(null)}
          className="flex items-center gap-2 text-sm font-semibold text-white/50"
        >
          ‹ Change coin
        </button>

        <div className="flex items-center gap-3 rounded-2xl bg-white/5 p-4">
          <Coin symbol={picked.symbol} logo={picked.logoURI} size={40} />
          <div>
            <div className="font-extrabold">{picked.symbol}</div>
            <div className="text-xs text-white/45">on {picked.chainName}</div>
          </div>
        </div>

        <div className="rounded-2xl bg-ice-400/10 p-3 text-center text-xs text-white/60">
          Send <b className="text-ice-200">{picked.symbol}</b> (on {picked.chainName}) to this address.
          It’s credited as <b className="text-ice-200">ICE USD</b> (1:1) once it settles.
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
                ⚠️ Send only {picked.symbol} on {picked.chainName}. Min ≈ {usdt(addr.minDeposit)} USD.
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
                    <div className="font-semibold">{usdt(d.amount)} ICE USD</div>
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
