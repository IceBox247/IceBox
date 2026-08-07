import { HomeIcon, TasksIcon, ReferralsIcon } from './icons';
import { haptic } from '../telegram';

export type Tab = 'home' | 'tasks' | 'referrals';

const items: { key: Tab; label: string; Icon: typeof HomeIcon }[] = [
  { key: 'home', label: 'Home', Icon: HomeIcon },
  { key: 'tasks', label: 'Tasks', Icon: TasksIcon },
  { key: 'referrals', label: 'Referrals', Icon: ReferralsIcon },
];

export function BottomNav({ tab, onChange }: { tab: Tab; onChange: (t: Tab) => void }) {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-white/5 bg-night-800/95 backdrop-blur-lg pb-[env(safe-area-inset-bottom)]">
      <div className="mx-auto flex max-w-md items-center justify-around px-4 py-2">
        {items.map(({ key, label, Icon }) => {
          const active = tab === key;
          return (
            <button
              key={key}
              onClick={() => {
                haptic('light');
                onChange(key);
              }}
              className={`flex flex-1 flex-col items-center gap-1 rounded-2xl py-2 transition ${
                active ? 'text-ice-300' : 'text-white/45'
              }`}
            >
              <span
                className={`grid place-items-center rounded-xl px-5 py-1.5 transition ${
                  active ? 'bg-ice-400/15 shadow-glow' : ''
                }`}
              >
                <Icon width={22} height={22} />
              </span>
              <span className="text-xs font-semibold">{label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
