import { useEffect, useRef, useState } from 'react';
import type { Task } from '../types';
import { SendIcon, GlobeIcon, PlayIcon, CheckIcon, IceUsdCoin } from './icons';
import { openLink, haptic } from '../telegram';
import { useStore } from '../store';
import { useToast } from './Toast';
import { usdt } from '../lib/format';

const iconFor = { telegram: SendIcon, globe: GlobeIcon, play: PlayIcon } as const;
const iconTint = {
  telegram: 'text-ice-300 bg-ice-400/12',
  globe: 'text-violet-300 bg-violet-400/12',
  play: 'text-amber-300 bg-amber-400/12',
} as const;

type Phase = 'idle' | 'waiting' | 'claimable' | 'claiming';

export function TaskItem({ task }: { task: Task }) {
  const { claimTask } = useStore();
  const toast = useToast();
  const [phase, setPhase] = useState<Phase>('idle');
  const [remaining, setRemaining] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => { if (timerRef.current) clearInterval(timerRef.current); }, []);

  const Icon = iconFor[task.icon];
  const done = task.completed;

  function startVerification() {
    haptic('light');
    if (task.url) openLink(task.url);

    // Minimum gate: use the task's waitSeconds, or a small default for join/watch.
    const wait = Math.max(task.waitSeconds, task.actionType === 'join' ? 4 : 3);
    setRemaining(wait);
    setPhase('waiting');
    timerRef.current = setInterval(() => {
      setRemaining((r) => {
        if (r <= 1) {
          if (timerRef.current) clearInterval(timerRef.current);
          setPhase('claimable');
          return 0;
        }
        return r - 1;
      });
    }, 1000);
  }

  async function claim() {
    setPhase('claiming');
    const res = await claimTask(task.id);
    if (res) {
      haptic('success');
      toast.show(`+${usdt(res.reward)} USD earned!`, 'success');
      setPhase('idle');
    } else {
      haptic('error');
      toast.show('Could not verify. Try again.', 'error');
      setPhase('claimable');
    }
  }

  const remainingCount = task.maxCount - task.count;

  return (
    <div className={`card p-4 ${done ? 'opacity-70' : ''}`}>
      <div className="flex items-start gap-3">
        <span
          className={`relative grid h-11 w-11 shrink-0 place-items-center rounded-xl ${iconTint[task.icon]}`}
        >
          <Icon width={20} height={20} />
          {done && (
            <span className="absolute -right-1 -top-1 grid h-5 w-5 place-items-center rounded-full bg-usdt text-white">
              <CheckIcon width={12} height={12} />
            </span>
          )}
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-bold leading-tight">{task.title}</p>
          <p className="text-sm text-white/45">{task.subtitle}</p>
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between border-t border-white/5 pt-3">
        <div className="flex items-center gap-2">
          <IceUsdCoin size={20} />
          <span className="font-bold text-usdt">+{usdt(task.reward)} USD</span>
          {task.maxCount > 1 && (
            <span className="ml-1 text-xs text-white/40">
              {task.count}/{task.maxCount}
              {!done && ` · ${remainingCount} left`}
            </span>
          )}
        </div>

        {done ? (
          <span className="flex items-center gap-1 font-bold text-usdt">
            <CheckIcon width={16} height={16} /> Completed
          </span>
        ) : phase === 'idle' ? (
          <button onClick={startVerification} className="btn-primary px-6 py-2 text-sm">
            {task.actionLabel}
          </button>
        ) : phase === 'waiting' ? (
          <button disabled className="btn-ghost px-6 py-2 text-sm">
            {remaining}s…
          </button>
        ) : phase === 'claiming' ? (
          <button disabled className="btn-primary px-6 py-2 text-sm">
            …
          </button>
        ) : (
          <button onClick={claim} className="btn-primary px-6 py-2 text-sm">
            Claim
          </button>
        )}
      </div>
    </div>
  );
}
