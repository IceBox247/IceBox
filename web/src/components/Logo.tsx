/** IceBox brand mark — a faceted ice cube "B/box" with an ice-blue glow. */
export function IceBoxLogo({ size = 40, withText = true }: { size?: number; withText?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <div
        className="relative grid place-items-center rounded-2xl"
        style={{ width: size, height: size }}
      >
        <div className="absolute inset-0 rounded-2xl bg-ice-400/25 blur-md" />
        <svg
          width={size}
          height={size}
          viewBox="0 0 48 48"
          fill="none"
          className="relative drop-shadow-[0_0_10px_rgba(51,194,255,0.6)]"
        >
          <defs>
            <linearGradient id="ice" x1="0" y1="0" x2="48" y2="48">
              <stop stopColor="#c9f2ff" />
              <stop offset="0.5" stopColor="#5fd6ff" />
              <stop offset="1" stopColor="#0a86d6" />
            </linearGradient>
          </defs>
          <rect x="6" y="6" width="36" height="36" rx="9" fill="url(#ice)" opacity="0.18" />
          <rect x="6" y="6" width="36" height="36" rx="9" stroke="url(#ice)" strokeWidth="2" />
          <path
            d="M17 15h8a6 6 0 0 1 0 12h-8V15Zm0 12h9a6 6 0 0 1 0 12h-9V27Z"
            fill="url(#ice)"
          />
          <path d="M13 14v20" stroke="url(#ice)" strokeWidth="3" strokeLinecap="round" />
        </svg>
      </div>
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
