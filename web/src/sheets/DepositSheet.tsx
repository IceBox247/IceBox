import { useEffect, useState } from 'react';
import { Sheet } from '../components/Sheet';
import { useStore } from '../store';
import { useToast } from '../components/Toast';
import { api, ApiError } from '../api';
import { haptic } from '../telegram';
import { usdt, shortAddress } from '../lib/format';
import { CopyIcon, DownArrowIcon } from '../components/icons';

export function DepositSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { deposit, refreshDeposit } = useStore();
  const toast = useToast();
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        await refreshDeposit();
      } catch {
        /* surfaced via the sheet's empty state */
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, refreshDeposit]);

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

  const info = deposit;
  const address = info?.address;

  return (
    <Sheet open={open} onClose={onClose} title="Deposit USDT">
      {loading && !info ? (
        <div className="py-10 text-center text-white/50">Loading your deposit address…</div>
      ) : !info?.enabled ? (
        <div className="py-8 text-center">
          <div className="mb-3 text-5xl">❄️</div>
          <p className="text-lg font-bold">Deposits aren’t available yet</p>
          <p className="mx-auto mt-2 max-w-xs text-white/55">
            {info?.message || 'The deposit provider isn’t configured on this deployment yet.'}
          </p>
          <button onClick={onClose} className="btn-ghost mt-6 w-full py-4">
            Close
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="rounded-2xl bg-ice-400/10 p-4 text-center">
            <p className="text-sm text-white/60">
              Send <b className="text-ice-200">USDT</b> to this address. It’s credited as{' '}
              <b className="text-ice-200">ICE USD</b> (1:1) once it settles — then you can stake it.
            </p>
          </div>

          {address && (
            <div className="rounded-2xl border border-white/10 bg-night-700 p-4">
              <div className="mb-1 text-xs uppercase tracking-wide text-white/40">
                Your deposit address {info.originAsset ? `· ${info.originAsset}` : ''}
              </div>
              <button
                onClick={() => copy(address)}
                className="flex w-full items-center justify-between gap-3 text-left"
              >
                <span className="break-all font-mono text-sm text-white/90">{address}</span>
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-ice-400/15 text-ice-300">
                  <CopyIcon width={16} height={16} />
                </span>
              </button>
              {info.minDeposit ? (
                <p className="mt-2 text-xs text-white/40">
                  Minimum recommended deposit: {usdt(info.minDeposit)} USDT
                </p>
              ) : null}
            </div>
          )}

          <button
            onClick={checkNow}
            disabled={checking}
            className="btn-primary w-full py-4 disabled:opacity-50"
          >
            {checking ? 'Checking…' : "I've sent it — check now"}
          </button>

          {info.deposits.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-bold uppercase tracking-wide text-white/40">Recent</p>
              {info.deposits.map((d) => (
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
      )}
    </Sheet>
  );
}
