import { useEffect, useState } from 'react';
import { api } from '../api';
import type { ReferralsResponse } from '../types';
import { Mascot } from '../components/Mascot';
import {
  LinkIcon,
  CopyIcon,
  SendIcon,
  ReferralsIcon,
  CheckIcon,
  DollarIcon,
  TrophyIcon,
  ChevronRightIcon,
} from '../components/icons';
import { usdt, compact } from '../lib/format';
import { haptic, shareReferral } from '../telegram';
import { useToast } from '../components/Toast';

const medal = ['🥇', '🥈', '🥉'];

export function Referrals() {
  const toast = useToast();
  const [data, setData] = useState<ReferralsResponse | null>(null);

  useEffect(() => {
    api.referrals().then(setData).catch(() => setData(null));
  }, []);

  if (!data) {
    return <div className="px-5 py-20 text-center text-white/40">Loading referrals…</div>;
  }

  async function copy() {
    haptic('light');
    try {
      await navigator.clipboard.writeText(data!.referralLink);
      toast.show('Referral link copied', 'success');
    } catch {
      toast.show('Copy failed', 'error');
    }
  }

  const stats = [
    { icon: ReferralsIcon, label: 'Total Referrals', value: compact(data.stats.totalReferrals) },
    { icon: CheckIcon, label: 'Active Referrals', value: compact(data.stats.activeReferrals) },
    { icon: DollarIcon, label: 'Total Earned', value: usdt(data.stats.totalEarned) },
  ];

  return (
    <div className="animate-fade-in space-y-6 px-5 pb-28 pt-2">
      {/* Hero */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-extrabold">Refer &amp; Earn</h1>
          <p className="mt-1 max-w-[10rem] text-white/50">Invite friends and earn more</p>
        </div>
        <Mascot size={110} />
      </div>

      {/* Per invite */}
      <div className="card relative overflow-hidden p-5">
        <div className="absolute -right-6 -top-6 h-24 w-24 rounded-full bg-ice-400/20 blur-2xl" />
        <p className="text-sm font-semibold uppercase tracking-wide text-white/50">Per Invite</p>
        <p className="mt-1 text-5xl font-extrabold">
          {usdt(data.perInvite)} <span className="text-2xl text-ice-300">USD</span>
        </p>
      </div>

      {/* Two-level deposit commission — paid in real USDT */}
      <div className="card space-y-4 border border-usdt/25 p-5">
        <div>
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-usdt/15 px-2.5 py-1 text-xs font-bold text-usdt">
              USDT · Withdrawable
            </span>
          </div>
          <h3 className="mt-3 text-xl font-extrabold">Earn on every deposit</h3>
          <p className="mt-1.5 text-sm leading-relaxed text-white/60">
            Get <b className="text-usdt">{data.commission.level1Pct}%</b> in real USDT on{' '}
            <b>every deposit your invites make</b> — and another{' '}
            <b className="text-usdt">{data.commission.level2Pct}%</b> on deposits made by{' '}
            <b>their</b> invites. Two levels deep, credited instantly, and withdrawable as USDT.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-2xl border border-usdt/20 bg-usdt/10 p-3 text-center">
            <div className="text-3xl font-extrabold text-usdt">{data.commission.level1Pct}%</div>
            <div className="mt-0.5 text-[11px] text-white/50">Level 1 · your invites</div>
            <div className="mt-1.5 text-sm font-bold">{usdt(data.commission.level1)} USDT</div>
          </div>
          <div className="rounded-2xl border border-usdt/20 bg-usdt/10 p-3 text-center">
            <div className="text-3xl font-extrabold text-usdt">{data.commission.level2Pct}%</div>
            <div className="mt-0.5 text-[11px] text-white/50">Level 2 · their invites</div>
            <div className="mt-1.5 text-sm font-bold">{usdt(data.commission.level2)} USDT</div>
          </div>
        </div>
      </div>

      {/* Earnings split: deposit commission (USDT) vs invite/task rewards (ICE USD) */}
      <div className="grid grid-cols-2 gap-3">
        <div className="card p-4">
          <div className="text-xs text-white/45">Deposit commission</div>
          <div className="mt-1 text-2xl font-extrabold text-usdt">
            {usdt(data.commission.total)}
          </div>
          <div className="text-[11px] font-semibold text-white/40">USDT · withdrawable</div>
        </div>
        <div className="card p-4">
          <div className="text-xs text-white/45">Invite &amp; task rewards</div>
          <div className="mt-1 text-2xl font-extrabold text-ice-300">
            {usdt(data.stats.totalEarned)}
          </div>
          <div className="text-[11px] font-semibold text-white/40">ICE USD</div>
        </div>
      </div>

      {/* Referral link */}
      <div className="card space-y-3 p-5">
        <p className="text-xs font-bold uppercase tracking-wide text-white/40">Your Referral Link</p>
        <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-night-800 px-3 py-3">
          <LinkIcon width={18} height={18} className="shrink-0 text-ice-300" />
          <span className="truncate text-sm text-white/70">{data.referralLink}</span>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <button onClick={copy} className="btn-ghost py-3">
            <CopyIcon width={18} height={18} /> Copy Link
          </button>
          <button
            onClick={() => {
              haptic('light');
              shareReferral(data.referralLink, '❄️ Join IceBox Wallet and earn USD with me!');
            }}
            className="btn-primary py-3"
          >
            <SendIcon width={18} height={18} /> Share
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="card grid grid-cols-3 divide-x divide-white/5 p-4">
        {stats.map(({ icon: Icon, label, value }) => (
          <div key={label} className="px-2 text-center">
            <span className="mx-auto mb-1 grid h-9 w-9 place-items-center rounded-xl bg-ice-400/12 text-ice-300">
              <Icon width={18} height={18} />
            </span>
            <div className="text-xl font-extrabold">{value}</div>
            <div className="text-[11px] text-white/45">{label}</div>
          </div>
        ))}
      </div>

      {/* Leaderboard */}
      <div>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-xl font-extrabold">Top Referrals</h2>
          <span className="flex items-center gap-1 text-sm font-semibold text-white/40">
            View All <ChevronRightIcon width={16} height={16} />
          </span>
        </div>

        <div className="mb-3 flex items-center justify-center gap-2 rounded-2xl border border-ice-400/20 bg-ice-400/10 px-4 py-3 text-sm font-bold text-ice-200">
          <TrophyIcon width={18} height={18} /> Top 100 referrers win USD prizes
        </div>

        <div className="space-y-2">
          {data.leaderboard.length === 0 && (
            <div className="card py-8 text-center text-white/45">
              Be the first on the leaderboard — invite friends now!
            </div>
          )}
          {data.leaderboard.map((row) => (
            <div
              key={row.rank}
              className={`flex items-center gap-3 rounded-2xl p-3 ${
                row.isMe ? 'bg-ice-400/15 border border-ice-400/30' : 'bg-white/5'
              }`}
            >
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-night-700 text-xs font-bold">
                {row.rank <= 3 ? medal[row.rank - 1] : row.rank}
              </span>
              <span className="grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-full bg-usdt/20 text-usdt">
                {row.photoUrl ? (
                  <img src={row.photoUrl} alt="" className="h-full w-full object-cover" />
                ) : (
                  <ReferralsIcon width={16} height={16} />
                )}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-bold">
                  {row.name} {row.isMe && <span className="text-ice-300">(You)</span>}
                </p>
                <p className="text-xs text-white/45">{compact(row.referrals)} Referrals</p>
              </div>
              <div className="text-right">
                <p className="font-extrabold text-ice-300">{compact(row.prize)}</p>
                <p className="text-[10px] font-semibold text-white/40">USD</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
