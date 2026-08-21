import { Sheet } from '../components/Sheet';
import { useStore } from '../store';
import { useCountdown, CountdownDigits } from '../components/Countdown';
import { Mascot } from '../components/Mascot';

export function LaunchSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { me } = useStore();
  const cfg = me?.config;
  const left = useCountdown(cfg?.tokenLaunchAt);

  const launchDate = cfg?.tokenLaunchAt ? new Date(cfg.tokenLaunchAt) : null;
  const dateLabel = launchDate
    ? launchDate.toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    : null;

  return (
    <Sheet open={open} onClose={onClose} title="ICE Token Launch">
      <div className="space-y-5">
        <div className="grid place-items-center">
          <Mascot size={120} />
        </div>

        <div className="text-center">
          <h2 className="text-2xl font-extrabold leading-tight">
            {left?.done ? 'ICE Token is Live! 🎉' : 'ICE Token goes tradeable in'}
          </h2>
          <p className="mt-1 text-sm text-white/50">
            {cfg?.tokenLaunchLabel ?? 'ICE Token goes live on-chain'}
          </p>
        </div>

        {left && !left.done && (
          <div className="rounded-3xl border border-ice-400/20 bg-ice-400/5 p-5">
            <CountdownDigits left={left} size="lg" />
            {dateLabel && (
              <p className="mt-4 text-center text-xs uppercase tracking-widest text-white/40">
                Launch · {dateLabel}
              </p>
            )}
          </div>
        )}

        {left?.done &&
          (cfg?.tokenTradeUrl ? (
            <a
              href={cfg.tokenTradeUrl}
              target="_blank"
              rel="noreferrer"
              className="btn-primary block w-full py-4 text-center text-lg"
            >
              Trade ICE Now
            </a>
          ) : (
            <div className="rounded-2xl bg-usdt/10 py-4 text-center font-semibold text-usdt">
              Trading is now open on-chain 🎉
            </div>
          ))}

        <div className="rounded-2xl bg-white/5 p-4 text-sm text-white/60">
          <p className="font-semibold text-white/80">What happens at launch?</p>
          <ul className="mt-2 space-y-1.5 text-white/55">
            <li>❄️ ICE becomes a live, tradeable token on-chain.</li>
            <li>💧 Liquidity opens so ICE can be bought and sold.</li>
            <li>🔓 Your earned & staked ICE converts to the ICE token.</li>
          </ul>
        </div>

        <button onClick={onClose} className="btn-ghost w-full py-3">
          Close
        </button>
      </div>
    </Sheet>
  );
}
