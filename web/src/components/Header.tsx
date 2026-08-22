import { IceBoxLogo } from './Logo';
import { BellIcon, MenuDotsIcon } from './icons';
import { haptic } from '../telegram';

export function Header({
  onMenu,
  onBell,
  unread = false,
}: {
  onMenu: () => void;
  onBell: () => void;
  unread?: boolean;
}) {
  return (
    <header className="flex items-center justify-between px-5 pt-4">
      <button
        onClick={() => {
          haptic('light');
          onMenu();
        }}
        className="grid h-11 w-11 place-items-center rounded-2xl bg-white/5 text-white/80 border border-white/5"
        aria-label="Menu"
      >
        <MenuDotsIcon width={20} height={20} />
      </button>

      <IceBoxLogo size={38} />

      <button
        onClick={() => {
          haptic('light');
          onBell();
        }}
        className="relative grid h-11 w-11 place-items-center rounded-2xl bg-white/5 text-white/80 border border-white/5"
        aria-label="Notifications"
      >
        <BellIcon width={20} height={20} />
        {unread && (
          <span className="absolute right-3 top-3 h-2 w-2 rounded-full bg-ice-300 ring-2 ring-night-900" />
        )}
      </button>
    </header>
  );
}
