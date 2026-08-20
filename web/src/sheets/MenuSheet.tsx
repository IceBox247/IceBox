import { Sheet } from '../components/Sheet';
import { RefreshIcon, ClockIcon, ShareIcon } from '../components/icons';
import { haptic, shareReferral } from '../telegram';
import { useStore } from '../store';
import { useToast } from '../components/Toast';
import { APP_VERSION } from '../brand';

interface Props {
  open: boolean;
  onClose: () => void;
  onHistory: () => void;
  onAdmin: () => void;
}

export function MenuSheet({ open, onClose, onHistory, onAdmin }: Props) {
  const { me, refreshAll } = useStore();
  const toast = useToast();

  const rows = [
    ...(me?.config.isAdmin
      ? [
          {
            icon: ClockIcon,
            title: 'Admin dashboard',
            subtitle: 'Platform stats & totals',
            onClick: () => {
              onClose();
              setTimeout(onAdmin, 200);
            },
          },
        ]
      : []),
    {
      icon: RefreshIcon,
      title: 'Refresh balance',
      subtitle: 'Sync your latest USD balance',
      onClick: async () => {
        haptic('light');
        await refreshAll();
        toast.show('Balance synced', 'success');
        onClose();
      },
    },
    {
      icon: ClockIcon,
      title: 'Withdrawal history',
      subtitle: 'See your past payouts',
      onClick: () => {
        onClose();
        setTimeout(onHistory, 200);
      },
    },
    {
      icon: ShareIcon,
      title: 'Invite friends',
      subtitle: 'Share your referral link',
      onClick: () => {
        if (me) shareReferral(me.referralLink, '❄️ Join IceBox Wallet and earn USD with me!');
        onClose();
      },
    },
  ];

  return (
    <Sheet open={open} onClose={onClose} title="Menu">
      <div className="space-y-1">
        {rows.map(({ icon: Icon, title, subtitle, onClick }) => (
          <button
            key={title}
            onClick={onClick}
            className="flex w-full items-center gap-4 rounded-2xl px-2 py-4 text-left transition active:bg-white/5"
          >
            <span className="grid h-11 w-11 place-items-center rounded-xl bg-ice-400/15 text-ice-300">
              <Icon width={20} height={20} />
            </span>
            <span>
              <span className="block font-bold">{title}</span>
              <span className="block text-sm text-white/45">{subtitle}</span>
            </span>
          </button>
        ))}
      </div>
      <button onClick={onClose} className="btn-ghost mt-4 w-full py-4">
        Close
      </button>
      <p className="mt-3 text-center text-xs text-white/30">IceBox {APP_VERSION}</p>
    </Sheet>
  );
}
