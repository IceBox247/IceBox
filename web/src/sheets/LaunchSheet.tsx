import { Sheet } from '../components/Sheet';
import { useStore } from '../store';
import { useCountdown, CountdownDigits } from '../components/Countdown';
import { Mascot } from '../components/Mascot';
import { LINKS } from '../content/site';

export function LaunchSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { me } = useStore();
  const cfg = me?.config;
  // ICE is already live & tradeable on-chain. The countdown (if a date is set)
  // now points at the next scheduled liquidity top-up, not "becomes tradeable".
  const left = useCountdown(cfg?.tokenLaunchAt);
  const tradeUrl = cfg?.tokenTradeUrl || LINKS.swap;

  const nextDate = cfg?.tokenLaunchAt ? new Date(cfg.tokenLaunchAt) : null;
  const dateLabel = nextDate
    ? nextDate.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
    : null;

  return (
    <Sheet open={open} onClose={onClose} title="ICE Token">
      <div className="space-y-5">
        <div className="grid place-items-center">
          <Mascot size={120} />
        </div>

        <div className="text-center">
          <div className="mx-auto mb-2 w-fit rounded-full border border-emerald-400/40 bg-emerald-400/10 px-3 py-1 text-[11px] font-bold uppercase tracking-widest text-emerald-400">
            ● Live & Tradeable on-chain
          </div>
          <h2 className="text-2xl font-extrabold leading-tight">
            {left && !left.done ? 'Next liquidity boost in' : 'ICE is live on-chain 🎉'}
          </h2>
          <p className="mt-1 text-sm text-white/50">
            {cfg?.tokenLaunchLabel ?? 'ICE is already tradeable — liquidity is topped up over time.'}
          </p>
        </div>

        {left && !left.done && (
          <div className="rounded-3xl border border-ice-400/20 bg-ice-400/5 p-5">
            <CountdownDigits left={left} size="lg" />
            {dateLabel && (
              <p className="mt-4 text-center text-xs uppercase tracking-widest text-white/40">
                Liquidity boost · {dateLabel}
              </p>
            )}
          </div>
        )}

        <a
          href={tradeUrl}
          target="_blank"
          rel="noreferrer"
          className="btn-primary block w-full py-4 text-center text-lg"
        >
          Trade ICE Now
        </a>

        <div className="rounded-2xl bg-white/5 p-4 text-sm text-white/60">
          <p className="font-semibold text-white/80">Good to know</p>
          <ul className="mt-2 space-y-1.5 text-white/55">
            <li>❄️ ICE is a live, tradeable token on-chain right now.</li>
            <li>💧 Liquidity keeps getting topped up so ICE stays easy to buy & sell.</li>
            <li>🔓 Your earned ICE is withdrawable now — staking rewards can be taken as USDT.</li>
          </ul>
        </div>

        <button onClick={onClose} className="btn-ghost w-full py-3">
          Close
        </button>
      </div>
    </Sheet>
  );
}
