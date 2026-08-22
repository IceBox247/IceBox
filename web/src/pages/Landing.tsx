import { useState } from 'react';
import { LINKS, TOKEN_FACTS } from '../content/site';
import { WhitepaperView } from './Whitepaper';

function Feature({ icon, title, body }: { icon: string; title: string; body: string }) {
  return (
    <div className="rounded-2xl border border-ice-400/15 bg-white/[0.03] p-5">
      <div className="grid h-11 w-11 place-items-center rounded-xl bg-ice-400/15 text-2xl">{icon}</div>
      <h3 className="mt-3 text-lg font-extrabold">{title}</h3>
      <p className="mt-1 text-sm leading-relaxed text-white/55">{body}</p>
    </div>
  );
}

function Step({ n, title, body }: { n: number; title: string; body: string }) {
  return (
    <div className="flex gap-4">
      <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-ice-400 text-sm font-black text-night-900">
        {n}
      </div>
      <div>
        <h4 className="font-extrabold">{title}</h4>
        <p className="mt-0.5 text-sm text-white/55">{body}</p>
      </div>
    </div>
  );
}

function SocialBtn({ href, icon, label }: { href: string; icon: string; label: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold transition hover:border-ice-400/40 hover:bg-ice-400/10"
    >
      <span className="text-lg">{icon}</span> {label}
    </a>
  );
}

/** Public marketing site — shown to normal web visitors (outside Telegram). */
export function Landing() {
  const [view, setView] = useState<'home' | 'paper'>('home');

  if (view === 'paper') {
    return (
      <div className="min-h-screen bg-night-900 hex-bg text-white">
        <WhitepaperView onBack={() => setView('home')} />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-night-900 hex-bg text-white">
      <div className="mx-auto max-w-3xl px-5">
        {/* Nav */}
        <nav className="flex items-center justify-between py-5">
          <div className="flex items-center gap-2">
            <img src="/icebox-mark.png" alt="IceBox" className="h-9 w-auto" />
            <span className="text-lg font-black tracking-tight">
              ICE<span className="text-ice-300">BOX</span>
            </span>
          </div>
          <a href={LINKS.miniApp} target="_blank" rel="noopener noreferrer" className="btn-primary px-4 py-2 text-sm">
            Open App
          </a>
        </nav>

        {/* Hero */}
        <header className="pt-8 pb-10 text-center">
          <img
            src="/coin.png"
            alt="ICE coin"
            className="mx-auto h-36 w-36"
            style={{ filter: 'drop-shadow(0 10px 34px rgba(51,194,255,.55))' }}
          />
          <h1 className="mt-5 text-4xl font-black leading-tight tracking-tight sm:text-5xl">
            Mine <span className="text-ice-300">ICE</span> just by holding.
          </h1>
          <p className="mx-auto mt-3 max-w-xl text-white/60">
            IceBox is a Telegram-native wallet where your ICE holding powers your mining. Earn from
            mining, tasks, referrals and daily check-ins — all self-custodial on {TOKEN_FACTS.network}.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <a href={LINKS.miniApp} target="_blank" rel="noopener noreferrer" className="btn-primary px-6 py-3">
              🚀 Launch Mini App
            </a>
            <a href={LINKS.swap} target="_blank" rel="noopener noreferrer" className="btn-ghost px-6 py-3">
              Buy ICE
            </a>
            <button onClick={() => setView('paper')} className="btn-ghost px-6 py-3">
              📄 White Paper
            </button>
          </div>
        </header>

        {/* Features */}
        <section className="grid gap-4 py-8 sm:grid-cols-2">
          <Feature icon="⛏️" title="Holding-based mining" body="Your ICE holding sets your Level across 1,000 tiers — hold more, mine faster. Claim anytime." />
          <Feature icon="✅" title="Earn free ICE" body="Complete tasks, invite friends and check in daily to stack ICE — credited straight to your balance." />
          <Feature icon="📈" title="Stake to earn" body="Lock funds into tiered plans and earn daily rewards on top of your mining." />
          <Feature icon="🔒" title="Self-custodial" body="Your ICE stays in your own wallet. The app only reads your balance to set your Level." />
        </section>

        {/* How it works */}
        <section className="py-8">
          <h2 className="text-2xl font-black">How mining works</h2>
          <div className="mt-5 space-y-5">
            <Step n={1} title="Open the Mini App" body="Launch IceBox inside Telegram and start mining instantly — no setup." />
            <Step n={2} title="Hold ICE" body="Buy or earn ICE. Your total ICE assets raise your Level and mining speed." />
            <Step n={3} title="Claim & grow" body="Your Pool Wallet fills continuously. Claim ICE, climb the leaderboard, and level up." />
          </div>
        </section>

        {/* Token */}
        <section className="rounded-2xl border border-ice-400/20 bg-gradient-to-br from-ice-400/10 to-transparent p-6">
          <h2 className="text-2xl font-black">
            {TOKEN_FACTS.name} <span className="text-ice-300">{TOKEN_FACTS.symbol}</span>
          </h2>
          <p className="mt-1 text-sm text-white/55">{TOKEN_FACTS.network} · price read live from the on-chain pool</p>
          <a
            href={LINKS.bscscan}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-4 block truncate rounded-xl bg-black/30 px-4 py-3 text-center text-xs text-ice-200"
          >
            {TOKEN_FACTS.contract}
          </a>
          <div className="mt-4 flex flex-wrap gap-3">
            <a href={LINKS.swap} target="_blank" rel="noopener noreferrer" className="btn-primary px-5 py-2.5 text-sm">
              Buy on PancakeSwap
            </a>
            <a href={LINKS.bscscan} target="_blank" rel="noopener noreferrer" className="btn-ghost px-5 py-2.5 text-sm">
              View on BscScan
            </a>
            <button onClick={() => setView('paper')} className="btn-ghost px-5 py-2.5 text-sm">
              Read White Paper
            </button>
          </div>
        </section>

        {/* Community */}
        <section className="py-10">
          <h2 className="text-2xl font-black">Join the community</h2>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <SocialBtn href={LINKS.miniApp} icon="🤖" label="Telegram Mini App" />
            <SocialBtn href={LINKS.telegramChannel} icon="📢" label="Announcements Channel" />
            <SocialBtn href={LINKS.telegramGroup} icon="💬" label="Community Chat" />
            <SocialBtn href={LINKS.twitter} icon="𝕏" label="Follow on X" />
          </div>
        </section>

        {/* Footer */}
        <footer className="border-t border-white/10 py-8 text-center text-xs text-white/35">
          <div className="mb-2 flex items-center justify-center gap-2">
            <img src="/icebox-mark.png" alt="" className="h-6 w-auto" />
            <span className="font-bold text-white/60">IceBox</span>
          </div>
          <p>{LINKS.website.replace(/^https?:\/\//, '')} · {LINKS.email}</p>
          <p className="mt-2 max-w-lg mx-auto leading-relaxed">
            Not financial advice. Crypto involves risk — only participate with what you can afford to
            lose. Always verify the contract on BscScan.
          </p>
        </footer>
      </div>
    </div>
  );
}
