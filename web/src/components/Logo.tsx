import markUrl from '../assets/icebox-mark.png';
import logoUrl from '../assets/icebox-logo.png';

/** The IceBox emblem — the faceted ice "B" mark, in a rounded glowing tile. */
export function IceBoxMark({ size = 40 }: { size?: number }) {
  return (
    <div
      className="relative shrink-0 overflow-hidden rounded-2xl"
      style={{ width: size, height: size }}
    >
      <div className="absolute inset-0 rounded-2xl bg-ice-400/25 blur-md" />
      <img
        src={markUrl}
        alt="IceBox"
        width={size}
        height={size}
        className="relative h-full w-full object-cover drop-shadow-[0_0_10px_rgba(51,194,255,0.5)]"
      />
    </div>
  );
}

/** Emblem + wordmark lockup used in the header. */
export function IceBoxLogo({ size = 40, withText = true }: { size?: number; withText?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <IceBoxMark size={size} />
      {withText && (
        <div className="leading-none">
          <div className="text-lg font-extrabold tracking-tight text-white">
            ICE<span className="text-ice-300">BOX</span>
          </div>
          <div className="text-[10px] font-semibold tracking-[0.25em] text-ice-300/80">WALLET</div>
        </div>
      )}
    </div>
  );
}

/** Full brand lockup image (mark + "ICE BOX" wordmark) for splash/hero. */
export function IceBoxLockup({ size = 180 }: { size?: number }) {
  return (
    <img
      src={logoUrl}
      alt="IceBox Wallet"
      width={size}
      height={size}
      className="drop-shadow-[0_0_24px_rgba(51,194,255,0.35)]"
    />
  );
}
