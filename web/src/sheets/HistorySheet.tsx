import { useEffect, useState } from 'react';
import { Sheet } from '../components/Sheet';
import { api } from '../api';
import type { Withdrawal } from '../types';
import { usdt, shortAddress, timeAgo } from '../lib/format';

export function HistorySheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<Withdrawal[]>([]);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    api
      .withdrawals()
      .then((r) => setItems(r.withdrawals))
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, [open]);

  const statusColor: Record<string, string> = {
    pending: 'text-amber-300 bg-amber-300/10',
    processing: 'text-ice-300 bg-ice-300/10',
    paid: 'text-usdt bg-usdt/10',
    rejected: 'text-red-400 bg-red-400/10',
  };

  return (
    <Sheet open={open} onClose={onClose} title="Withdrawal History">
      {loading ? (
        <div className="py-10 text-center text-white/50">Loading…</div>
      ) : items.length === 0 ? (
        <div className="py-8 text-center">
          <div className="mb-3 text-5xl">❄️</div>
          <p className="text-lg font-bold">No withdrawals yet</p>
          <p className="mt-1 text-white/50">Complete tasks to earn — payouts show up here.</p>
        </div>
      ) : (
        <div className="max-h-[50vh] space-y-3 overflow-y-auto no-scrollbar">
          {items.map((w) => (
            <div key={w.id} className="flex items-center justify-between rounded-2xl bg-white/5 p-4">
              <div>
                <p className="font-bold">{usdt(w.amount)} USD</p>
                <p className="text-xs text-white/45">
                  {w.network} · {shortAddress(w.address)} · {timeAgo(w.createdAt)}
                </p>
              </div>
              <span
                className={`rounded-full px-3 py-1 text-xs font-bold capitalize ${
                  statusColor[w.status] ?? 'text-white/60 bg-white/10'
                }`}
              >
                {w.status}
              </span>
            </div>
          ))}
        </div>
      )}
      <button onClick={onClose} className="btn-ghost mt-5 w-full py-4">
        Close
      </button>
    </Sheet>
  );
}
