import { useStore } from '../store';
import { Mascot } from '../components/Mascot';
import {
  UpArrowIcon,
  ClockIcon,
  ChevronRightIcon,
  WalletIcon,
  ReferralsIcon,
  TasksIcon,
  UsdtCoin,
} from '../components/icons';
import { usdt } from '../lib/format';
import type { Tab } from '../components/BottomNav';

interface Props {
  onWithdraw: () => void;
  onHistory: () => void;
  onNavigate: (t: Tab) => void;
}

export function Home({ onWithdraw, onHistory, onNavigate }: Props) {
  const { me } = useStore();
  if (!me) return null;
  const { overview } = me;

  const stats = [
    { icon: WalletIcon, label: 'Total Earned', value: `${usdt(overview.totalEarned)}`, unit: 'USDT', tint: 'text-ice-300 bg-ice-400/15' },
    { icon: ReferralsIcon, label: 'Total Referrals', value: `${overview.totalReferrals}`, unit: '', tint: 'text-usdt bg-usdt/15' },
    { icon: TasksIcon, label: 'Tasks Done', value: `${overview.tasksDone}`, unit: '', tint: 'text-violet-300 bg-violet-400/15' },
    { icon: WalletIcon, label: 'Available', value: `${usdt(overview.available)}`, unit: 'USDT', tint: 'text-sky-300 bg-sky-400/15' },
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
          <UsdtCoin size={46} />
          <div>
            <div className="text-5xl font-extrabold leading-none tracking-tight">
              {usdt(overview.balance)}
            </div>
            <div className="mt-1 text-sm font-bold tracking-widest text-white/40">USDT</div>
          </div>
        </div>
        <div className="mt-3 inline-block rounded-full bg-ice-400/10 px-3 py-1 text-sm font-semibold text-ice-200">
          ≈ ${usdt(overview.balance * overview.usdRate)} USD
        </div>

        <div className="mt-5 grid grid-cols-2 gap-3">
          <button onClick={onWithdraw} className="btn-primary py-4">
            <UpArrowIcon width={20} height={20} /> Withdraw
          </button>
          <button onClick={onHistory} className="btn-ghost py-4">
            <ClockIcon width={20} height={20} /> History
          </button>
        </div>
      </div>

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
