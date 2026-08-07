import { IceBoxLockup } from './Logo';

export function LoadingScreen() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-8 bg-night-900 hex-bg">
      <div className="relative grid place-items-center rounded-[32px] border border-ice-400/30 bg-night-800 p-8 shadow-glow">
        <IceBoxLockup size={200} />
      </div>
      <div className="relative">
        <div className="h-10 w-10 animate-[spin-slow_1s_linear_infinite] rounded-full border-4 border-white/10 border-t-ice-400" />
      </div>
      <p className="text-white/50">Loading IceBox Wallet…</p>
    </div>
  );
}
