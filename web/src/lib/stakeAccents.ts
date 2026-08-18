/**
 * Static accent-class map for the staking sections. Tailwind only keeps classes
 * that appear literally in source, so we can't build `bg-${accent}-400/15` on
 * the fly — every variant is spelled out here and looked up by the tier's
 * `accent` token (falls back to ice).
 */
export interface Accent {
  chip: string; // small pill background + text
  text: string; // accent text color
  ring: string; // card border
  bar: string; // progress-bar fill
  glow: string; // soft radial background tint
}

const ACCENTS: Record<string, Accent> = {
  sky: {
    chip: 'bg-sky-400/15 text-sky-300',
    text: 'text-sky-300',
    ring: 'border-sky-400/30',
    bar: 'bg-sky-400',
    glow: 'from-sky-500/15',
  },
  ice: {
    chip: 'bg-ice-400/15 text-ice-300',
    text: 'text-ice-300',
    ring: 'border-ice-400/30',
    bar: 'bg-ice-400',
    glow: 'from-ice-500/15',
  },
  amber: {
    chip: 'bg-amber-400/15 text-amber-300',
    text: 'text-amber-300',
    ring: 'border-amber-400/30',
    bar: 'bg-amber-400',
    glow: 'from-amber-500/15',
  },
  violet: {
    chip: 'bg-violet-400/15 text-violet-300',
    text: 'text-violet-300',
    ring: 'border-violet-400/30',
    bar: 'bg-violet-400',
    glow: 'from-violet-500/15',
  },
};

export function accent(token: string): Accent {
  return ACCENTS[token] ?? ACCENTS.ice;
}
