import { useStore } from '../store';
import { Mascot } from '../components/Mascot';
import {
  UpArrowIcon,
  DownArrowIcon,
  ClockIcon,
  ChevronRightIcon,
  WalletIcon,
  ReferralsIcon,
  TasksIcon,
  StakeIcon,
  IceUsdCoin,
} from '../components/icons';
import { usdt, ice } from '../lib/format';
import { useCountdown, CountdownDigits } from '../components/Countdown';
import type { Tab } from '../components/BottomNav';

interface Props {
  onWithdraw: () => void;
  onHistory: () => void;
  onDeposit: () => void;
  onCheckin: () => void;
  onLaunch: () => void;
  onNavigate: (t: Tab) => void;
}

export function Home({ onWithdraw, onHistory, onDeposit, onCheckin, onLaunch, onNavigate }: Props) {
  const { me, checkin } = useStore();
  const launch = useCountdown(me?.config.tokenLaunchAt);
  if (!me) return null;
  const { overview } = me;

  // ICE balance (earned, token-denominated) shown big; deposited USDT + total USD beneath.
  const iceBalance = overview.earnedBalance;
  const deposited = overview.stakeable;
  const price = me.config.icePrice ?? 0;
  const usdValue = deposited + iceBalance * price;

  const stats = [
    { icon: WalletIcon, label: 'Total Earned', value: `${usdt(overview.totalEarned)}`, unit: 'ICE', tint: 'text-ice-300 bg-ice-400/15' },
    { icon: ReferralsIcon, label: 'Total Referrals', value: `${overview.totalReferrals}`, unit: '', tint: 'text-usdt bg-usdt/15' },
    { icon: TasksIcon, label: 'Tasks Done', value: `${overview.tasksDone}`, unit: '', tint: 'text-violet-300 bg-violet-400/15' },
    { icon: WalletIcon, label: 'Available', value: `${ice(iceBalance)}`, unit: 'ICE', tint: 'text-sky-300 bg-sky-400/15' },
  ];

  return (
    <div className="animate-fade-in space-y-6 px-5 pb-28">
      {/* Mascot */}
      <div className="grid place-items-center pt-2">
        <Mascot size={150} />
      </div>

      {/* Balance card */}
      <div className="card -mt-6 p-5">
        <div className="flex items-center gap-2 text-white/50">
          <span className="text-sm font-medium">Total Balance</span>
        </div>
        <div className="mt-2 flex items-center gap-3">
          <IceUsdCoin size={46} />
          <div>
            <div className="text-5xl font-extrabold leading-none tracking-tight">
              {ice(iceBalance)}
            </div>
            <div className="mt-1 text-sm font-bold tracking-widest text-white/40">ICE</div>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
          <span className="rounded-full bg-white/5 px-3 py-1 text-white/60">≈ ${usdt(usdValue)}</span>
          <span className="rounded-full bg-usdt/10 px-3 py-1 font-semibold text-usdt">
            {usdt(deposited)} USDT deposited
          </span>
          <span className="rounded-full bg-ice-400/10 px-3 py-1 font-semibold text-ice-200">
            ICE · BSC (BEP-20)
          </span>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-3">
          {me.config.depositEnabled ? (
            <button onClick={onDeposit} className="btn-primary py-4">
              <DownArrowIcon width={20} height={20} /> Deposit
            </button>
          ) : (
            <button onClick={onWithdraw} className="btn-primary py-4">
              <UpArrowIcon width={20} height={20} /> Withdraw
            </button>
          )}
          <button onClick={onHistory} className="btn-ghost py-4">
            <ClockIcon width={20} height={20} /> History
          </button>
        </div>
        {me.config.depositEnabled && (
          <button onClick={onWithdraw} className="btn-ghost mt-3 w-full py-4">
            <UpArrowIcon width={20} height={20} /> Withdraw to USDT
          </button>
        )}
      </div>

      {/* ICE token launch countdown */}
      {launch && (
        <button
          onClick={onLaunch}
          className="card w-full border border-ice-400/25 bg-gradient-to-br from-ice-400/10 to-transparent p-4 text-left"
        >
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h3 className="text-lg font-extrabold leading-tight">❄️ ICE Token Launch</h3>
              <p className="text-sm text-white/50">
                {launch.done ? 'Now tradeable on-chain 🎉' : 'Tradeable on-chain in'}
              </p>
            </div>
            <ChevronRightIcon width={18} height={18} />
          </div>
          {!launch.done && <CountdownDigits left={launch} size="sm" />}
        </button>
      )}

      {/* Daily check-in */}
      {checkin?.enabled && (
        <button
          onClick={onCheckin}
          className="card flex w-full items-center gap-4 border border-ice-400/20 p-4 text-left"
        >
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-ice-400/15 text-2xl">
            🔥
          </span>
          <div className="flex-1">
            <h3 className="text-lg font-extrabold leading-tight">Daily Check-in</h3>
            <p className="text-sm text-white/50">
              {checkin.canClaim
                ? `Day ${checkin.nextStreak} · claim ${usdt(checkin.reward)} ICE`
                : `Day ${checkin.streak} streak · claimed today ✓`}
            </p>
          </div>
          {checkin.canClaim ? (
            <span className="rounded-full bg-ice-400 px-4 py-2 text-sm font-bold text-night-900">
              Claim
            </span>
          ) : (
            <ChevronRightIcon width={18} height={18} />
          )}
        </button>
      )}

      {/* Stake to Earn CTA */}
      {me.config.stakingEnabled && (
        <button
          onClick={() => onNavigate('stake')}
          className="card flex w-full items-center gap-4 border border-ice-400/20 p-4 text-left"
        >
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-ice-400/15 text-ice-300">
            <StakeIcon width={22} height={22} />
          </span>
          <div className="flex-1">
            <h3 className="text-lg font-extrabold leading-tight">Stake to Earn</h3>
            <p className="text-sm text-white/50">
              {overview.totalStaked > 0
                ? `${usdt(overview.totalStaked)} USDT staked · earning daily`
                : 'Lock ICE and earn daily rewards'}
            </p>
          </div>
          <ChevronRightIcon width={18} height={18} />
        </button>
      )}

      {/* Overview */}
      <div>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-xl font-extrabold">Overview</h2>
          <button
            onClick={() => onNavigate('referrals')}
            className="flex items-center gap-1 text-sm font-semibold text-white/50"
          >
            View All <ChevronRightIcon width={16} height={16} />
          </button>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {stats.map(({ icon: Icon, label, value, unit, tint }) => (
            <div key={label} className="card p-4">
              <div className="flex items-center gap-2">
                <span className={`grid h-9 w-9 place-items-center rounded-xl ${tint}`}>
                  <Icon width={18} height={18} />
                </span>
                <span className="text-sm text-white/50">{label}</span>
              </div>
              <div className="mt-2 text-2xl font-extrabold">
                {value}{' '}
                {unit && <span className="text-sm font-semibold text-white/40">{unit}</span>}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Referral promo */}
      <button
        onClick={() => onNavigate('referrals')}
        className="card flex w-full items-center gap-4 overflow-hidden p-5 text-left"
      >
        <div className="flex-1">
          <h3 className="text-xl font-extrabold leading-tight">
            More Referrals
            <br />
            More <span className="text-ice-300">Earnings!</span>
          </h3>
          <p className="mt-1 text-sm text-white/50">Invite friends & earn per invite</p>
        </div>
        <Mascot size={84} />
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-ice-400 text-night-900">
          <ChevronRightIcon width={18} height={18} />
        </span>
      </button>
    </div>
  );
}
