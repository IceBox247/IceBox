import { useState } from 'react';
import { Sheet } from '../components/Sheet';
import { useStore } from '../store';
import { useToast } from '../components/Toast';
import { ApiError } from '../api';
import { haptic } from '../telegram';
import { usdt } from '../lib/format';
import { CheckIcon } from '../components/icons';

export function CheckinSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { checkin, claimCheckin } = useStore();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  if (!checkin) return null;
  const len = checkin.rewards.length || 1;
  // Which day chip is "current" in the cycle.
  const dayShown = Math.min(checkin.claimedToday ? checkin.streak : checkin.nextStreak, len);

  async function claim() {
    setBusy(true);
    try {
      const { reward, streak } = await claimCheckin();
      haptic('success');
      toast.show(`Day ${streak} — claimed ${usdt(reward)} ICE 🔥`, 'success');
    } catch (e) {
      haptic('error');
      toast.show(e instanceof ApiError ? e.message : 'Check-in failed', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title="Daily Check-in">
      <div className="space-y-4">
        <div className="rounded-2xl bg-ice-400/10 p-4 text-center">
          <div className="text-4xl">🔥</div>
          <div className="mt-1 text-2xl font-extrabold">Day {checkin.streak} streak</div>
          <p className="mt-1 text-sm text-white/55">
            Check in every day — miss a day and the streak resets.
          </p>
        </div>

        {/* Reward schedule grid */}
        <div className="grid grid-cols-4 gap-2">
          {checkin.rewards.map((r, i) => {
            const day = i + 1;
            const collected = day < dayShown || (checkin.claimedToday && day === dayShown);
            const active = day === dayShown && checkin.canClaim;
            return (
              <div
                key={day}
                className={`rounded-2xl border p-2 text-center ${
                  active
                    ? 'border-ice-400 bg-ice-400/15'
                    : collected
                      ? 'border-usdt/40 bg-usdt/10'
                      : 'border-white/10 bg-white/5'
                }`}
              >
                <div className="text-[10px] uppercase tracking-wide text-white/40">Day {day}</div>
                <div className={`mt-0.5 text-sm font-extrabold ${active ? 'text-ice-200' : ''}`}>
                  {usdt(r)}
                </div>
                {collected ? (
                  <div className="mt-0.5 grid place-items-center text-usdt">
                    <CheckIcon width={14} height={14} />
                  </div>
                ) : (
                  <div className="mt-0.5 text-[10px] text-white/30">ICE</div>
                )}
              </div>
            );
          })}
        </div>

        {checkin.canClaim ? (
          <button onClick={claim} disabled={busy} className="btn-primary w-full py-4 text-lg">
            {busy ? 'Claiming…' : `Claim ${usdt(checkin.reward)} ICE`}
          </button>
        ) : (
          <div className="rounded-2xl bg-white/5 py-4 text-center font-semibold text-white/60">
            ✓ Claimed today — come back tomorrow
          </div>
        )}
        <button onClick={onClose} className="btn-ghost w-full py-3">
          Close
        </button>
        <p className="text-center text-[11px] text-white/40">
          {checkin.asUsdt
            ? 'You have staked funds — your daily bonus is paid as real USDT (withdrawable).'
            : 'Paid as ICE. Stake any funds to earn your daily bonus as real USDT instead.'}
        </p>
      </div>
    </Sheet>
  );
}
