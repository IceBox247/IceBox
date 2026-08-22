import { LINKS, TOKEN_FACTS, WHITEPAPER } from '../content/site';

function Stat({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return (
    <div className="rounded-xl border border-ice-400/15 bg-white/[0.03] px-3 py-2 text-center">
      <div className="text-[10px] uppercase tracking-wide text-white/40">{label}</div>
      <div className="mt-0.5 text-sm font-bold text-ice-100">{value}</div>
    </div>
  );
}

/** The ICE whitepaper — a scrollable document. Used in-app and on the web. */
export function WhitepaperView({ onBack }: { onBack?: () => void }) {
  return (
    <div className="mx-auto max-w-2xl px-5 pb-16 pt-4">
      {onBack && (
        <button
          onClick={onBack}
          className="mb-4 rounded-full border border-ice-400/30 bg-ice-400/10 px-4 py-2 text-sm font-bold text-ice-200"
        >
          ← Back
        </button>
      )}

      {/* Hero */}
      <div className="text-center">
        <img src="/coin.png" alt="ICE" className="mx-auto h-24 w-24" style={{ filter: 'drop-shadow(0 6px 20px rgba(51,194,255,.5))' }} />
        <h1 className="mt-3 text-3xl font-black tracking-tight">
          {TOKEN_FACTS.name} <span className="text-ice-300">White Paper</span>
        </h1>
        <p className="mt-1 text-sm text-white/50">Holding-based mining · Telegram-native · {TOKEN_FACTS.network}</p>
      </div>

      {/* Token card */}
      <div className="mt-5 rounded-2xl border border-ice-400/20 bg-gradient-to-br from-ice-400/10 to-transparent p-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-lg font-extrabold">
              {TOKEN_FACTS.name} <span className="text-ice-300">{TOKEN_FACTS.symbol}</span>
            </div>
            <div className="text-[11px] text-white/50">{TOKEN_FACTS.network}</div>
          </div>
          <a
            href={LINKS.swap}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-full bg-ice-400 px-4 py-2 text-xs font-bold text-night-900"
          >
            Buy ICE
          </a>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2">
          <Stat label="Max Supply" value={TOKEN_FACTS.maxSupply} />
          <Stat label="Minting" value={TOKEN_FACTS.mintDisabled} />
          <Stat label="Team" value={TOKEN_FACTS.teamHolding} />
        </div>
        <a
          href={LINKS.bscscan}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 block truncate rounded-xl bg-black/30 px-3 py-2 text-center text-[11px] text-ice-200"
        >
          {TOKEN_FACTS.contract}
        </a>
      </div>

      {/* Sections */}
      <div className="mt-6 space-y-6">
        {WHITEPAPER.map((s) => (
          <section key={s.title}>
            <h2 className="text-xl font-extrabold text-ice-100">{s.title}</h2>
            {s.body.split(/\n\s*\n/).map((p, i) => (
              <p key={i} className="mt-2 leading-relaxed text-white/70">
                {p}
              </p>
            ))}
          </section>
        ))}
      </div>

      {/* CTA footer */}
      <div className="mt-8 grid grid-cols-2 gap-3">
        <a href={LINKS.miniApp} target="_blank" rel="noopener noreferrer" className="btn-primary py-3 text-center text-sm">
          Open Mini App
        </a>
        <a href={LINKS.swap} target="_blank" rel="noopener noreferrer" className="btn-ghost py-3 text-center text-sm">
          Buy ICE
        </a>
      </div>
      <p className="mt-6 text-center text-[11px] leading-relaxed text-white/30">
        This document is for information only and is not financial advice. Crypto involves risk;
        only participate with what you can afford to lose. Always verify the contract on BscScan.
      </p>
    </div>
  );
}
