/**
 * Lightweight illustrated mascot: a cool penguin holding a USDT coin, on an
 * icy pedestal. Pure SVG so there are no image assets to ship.
 */
export function Mascot({ size = 150 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 200 200" fill="none" className="animate-float">
      <defs>
        <radialGradient id="mglow" cx="50%" cy="45%" r="55%">
          <stop offset="0%" stopColor="#33c2ff" stopOpacity="0.5" />
          <stop offset="100%" stopColor="#33c2ff" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="body" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#20304a" />
          <stop offset="1" stopColor="#0c1728" />
        </linearGradient>
      </defs>
      <circle cx="100" cy="95" r="90" fill="url(#mglow)" />
      {/* body */}
      <ellipse cx="100" cy="112" rx="46" ry="54" fill="url(#body)" />
      <ellipse cx="100" cy="120" rx="30" ry="40" fill="#eaf6ff" />
      {/* feet */}
      <ellipse cx="84" cy="164" rx="12" ry="6" fill="#ffb020" />
      <ellipse cx="116" cy="164" rx="12" ry="6" fill="#ffb020" />
      {/* head */}
      <circle cx="100" cy="66" r="34" fill="url(#body)" />
      <ellipse cx="100" cy="74" rx="20" ry="18" fill="#eaf6ff" />
      {/* sunglasses */}
      <rect x="72" y="58" width="24" height="14" rx="4" fill="#05070d" />
      <rect x="104" y="58" width="24" height="14" rx="4" fill="#05070d" />
      <rect x="96" y="62" width="8" height="4" fill="#05070d" />
      <rect x="75" y="61" width="8" height="4" rx="2" fill="#33c2ff" opacity="0.8" />
      <rect x="107" y="61" width="8" height="4" rx="2" fill="#33c2ff" opacity="0.8" />
      {/* beak */}
      <path d="M94 80 h12 l-6 8 z" fill="#ffb020" />
      {/* USDT coin */}
      <g transform="translate(128 108)">
        <circle r="26" fill="#26a17b" />
        <circle r="26" stroke="#1c7d5f" strokeWidth="2" />
        <text
          x="0"
          y="8"
          textAnchor="middle"
          fontSize="26"
          fontWeight="800"
          fill="#fff"
          fontFamily="Inter, sans-serif"
        >
          ₮
        </text>
      </g>
      {/* ice pedestal */}
      <path d="M52 150 h96 l-10 20 h-76 z" fill="#12a9f5" opacity="0.25" />
      <path d="M52 150 h96 l-10 20 h-76 z" stroke="#5fd6ff" strokeWidth="1.5" opacity="0.5" />
    </svg>
  );
}
