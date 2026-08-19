import { useEffect, useState } from 'react';

export interface TimeLeft {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  total: number; // ms remaining (<= 0 means launched)
  done: boolean;
}

function diff(target: number): TimeLeft {
  const total = Math.max(0, target - Date.now());
  const s = Math.floor(total / 1000);
  return {
    days: Math.floor(s / 86400),
    hours: Math.floor((s % 86400) / 3600),
    minutes: Math.floor((s % 3600) / 60),
    seconds: s % 60,
    total,
    done: total <= 0,
  };
}

/** Live countdown to an ISO/epoch target, ticking once per second. */
export function useCountdown(target: string | number | undefined): TimeLeft | null {
  const ts = target ? new Date(target).getTime() : NaN;
  const [left, setLeft] = useState<TimeLeft | null>(() =>
    Number.isFinite(ts) ? diff(ts) : null,
  );

  useEffect(() => {
    if (!Number.isFinite(ts)) {
      setLeft(null);
      return;
    }
    setLeft(diff(ts));
    const id = setInterval(() => setLeft(diff(ts)), 1000);
    return () => clearInterval(id);
  }, [ts]);

  return left;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** A row of D / H / M / S tiles. */
export function CountdownDigits({ left, size = 'lg' }: { left: TimeLeft; size?: 'lg' | 'sm' }) {
  const cells: Array<[string, number]> = [
    ['Days', left.days],
    ['Hrs', left.hours],
    ['Min', left.minutes],
    ['Sec', left.seconds],
  ];
  const big = size === 'lg';
  return (
    <div className="flex items-stretch justify-center gap-2">
      {cells.map(([label, val], i) => (
        <div key={label} className="flex items-center gap-2">
          <div
            className={`min-w-[3.25rem] rounded-2xl border border-ice-400/20 bg-white/5 px-2 ${
              big ? 'py-3' : 'py-2'
            } text-center`}
          >
            <div
              className={`font-extrabold tabular-nums leading-none text-ice-100 ${
                big ? 'text-3xl' : 'text-xl'
              }`}
            >
              {pad(val)}
            </div>
            <div className="mt-1 text-[10px] uppercase tracking-widest text-white/40">{label}</div>
          </div>
          {i < cells.length - 1 && big && (
            <span className="text-2xl font-bold text-ice-400/40">:</span>
          )}
        </div>
      ))}
    </div>
  );
}
