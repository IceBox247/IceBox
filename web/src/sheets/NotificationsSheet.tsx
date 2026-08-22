import { useEffect, useState } from 'react';
import { Sheet } from '../components/Sheet';
import { api } from '../api';
import type { AppNotification } from '../types';
import { usdt, ice, timeAgo } from '../lib/format';

const SEEN_KEY = 'icebox.notif.lastSeen';

/** Last notification id this device has marked seen (persisted). */
export function getLastSeen(): number {
  try {
    return Number(localStorage.getItem(SEEN_KEY)) || 0;
  } catch {
    return 0;
  }
}
export function setLastSeen(id: number): void {
  try {
    localStorage.setItem(SEEN_KEY, String(id));
  } catch {
    /* ignore */
  }
}

export function NotificationsSheet({
  open,
  onClose,
  onSeen,
}: {
  open: boolean;
  onClose: () => void;
  onSeen?: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<AppNotification[]>([]);
  const [lastSeen] = useState(getLastSeen);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    api
      .notifications()
      .then((r) => {
        setItems(r.notifications);
        // Opening the feed marks everything up to the newest as read.
        if (r.latestId > getLastSeen()) setLastSeen(r.latestId);
        onSeen?.();
      })
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <Sheet open={open} onClose={onClose} title="Notifications">
      {loading ? (
        <div className="py-10 text-center text-white/50">Loading…</div>
      ) : items.length === 0 ? (
        <div className="py-8 text-center">
          <div className="mb-3 text-5xl">🔔</div>
          <p className="text-lg font-bold">Nothing yet</p>
          <p className="mt-1 text-white/50">Your rewards, deposits and payouts will appear here.</p>
        </div>
      ) : (
        <div className="max-h-[60vh] space-y-2.5 overflow-y-auto no-scrollbar">
          {items.map((n) => {
            const isNew = n.id > lastSeen;
            const positive = n.amount >= 0;
            const amt = n.token === 'ice' ? `${ice(Math.abs(n.amount))} ICE` : `${usdt(Math.abs(n.amount))} USDT`;
            return (
              <div
                key={n.id}
                className={`flex items-center gap-3 rounded-2xl p-3 ${
                  isNew ? 'border border-ice-400/25 bg-ice-400/[0.06]' : 'bg-white/5'
                }`}
              >
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white/5 text-xl">
                  {n.icon}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <p className="truncate font-bold">{n.title}</p>
                    {isNew && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-ice-300" />}
                  </div>
                  <p className="truncate text-xs text-white/45">
                    {n.detail} · {timeAgo(n.at)}
                  </p>
                </div>
                <span
                  className={`shrink-0 text-sm font-extrabold tabular-nums ${
                    positive ? 'text-usdt' : 'text-white/50'
                  }`}
                >
                  {positive ? '+' : '−'}
                  {amt}
                </span>
              </div>
            );
          })}
        </div>
      )}
      <button onClick={onClose} className="btn-ghost mt-5 w-full py-4">
        Close
      </button>
    </Sheet>
  );
}
