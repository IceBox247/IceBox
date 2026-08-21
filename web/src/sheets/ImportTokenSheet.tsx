import { useState } from 'react';
import { Sheet } from '../components/Sheet';
import { useStore } from '../store';
import { useToast } from '../components/Toast';
import { haptic } from '../telegram';

export function ImportTokenSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { me } = useStore();
  const toast = useToast();
  const [copied, setCopied] = useState(false);
  const token = me?.config.token;
  if (!token) return null;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(token.address);
    } catch {
      /* clipboard may be blocked in-app; user can long-press to copy */
    }
    haptic('success');
    setCopied(true);
    toast.show('Contract copied', 'success');
    setTimeout(() => setCopied(false), 1500);
  };

  const steps = [
    `Open MetaMask and switch the network to ${token.chainName}.`,
    'On the Tokens tab, scroll down and tap “Import tokens”.',
    `Paste the ${token.name} contract address below into “Token contract address”.`,
    `The symbol (${token.symbol}) and decimals (${token.decimals}) fill in automatically.`,
    `Tap “Import” — ${token.name} now appears in your MetaMask wallet.`,
  ];

  return (
    <Sheet open={open} onClose={onClose} title={`Import ${token.name} to MetaMask`}>
      <div className="space-y-4">
        <p className="text-sm text-white/60">
          Add the {token.name} token to MetaMask so you can see and manage it in your own wallet
          after withdrawing.
        </p>

        {/* Contract address + copy — first, so it's always visible */}
        <div className="rounded-2xl border border-ice-400/25 bg-ice-400/5 p-4">
          <div className="text-[11px] uppercase tracking-wide text-white/45">
            {token.name} token contract
          </div>
          <div className="mt-2 select-all break-all rounded-xl bg-black/30 p-3 font-mono text-[13px] leading-relaxed text-ice-100">
            {token.address}
          </div>
          <button onClick={copy} className="btn-primary mt-3 w-full py-3">
            {copied ? '✓ Copied' : 'Copy contract address'}
          </button>
        </div>

        {/* Token facts */}
        <div className="card space-y-2 p-4 text-sm">
          <Row label="Token name" value={token.name} />
          <Row label="Network" value={token.chainName} />
          <Row label="Symbol" value={token.symbol} />
          <Row label="Decimals" value={String(token.decimals)} />
        </div>

        {/* Steps */}
        <div className="space-y-2">
          <p className="text-xs font-bold uppercase tracking-wide text-white/40">
            Step by step
          </p>
          {steps.map((s, i) => (
            <div key={i} className="flex gap-3 rounded-2xl bg-white/5 px-4 py-3">
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-ice-400/20 text-xs font-bold text-ice-200">
                {i + 1}
              </span>
              <span className="text-sm text-white/70">{s}</span>
            </div>
          ))}
        </div>

        <a
          href={`${token.explorerBase}/token/${token.address}`}
          target="_blank"
          rel="noreferrer"
          className="btn-ghost block w-full py-3 text-center"
        >
          View ICE on the explorer
        </a>
        <p className="text-center text-[11px] text-amber-200/70">
          ⚠️ Only trust this contract address from inside IceBox. Never add a token someone DMs you.
        </p>
        <button onClick={onClose} className="btn-ghost w-full py-3">
          Close
        </button>
      </div>
    </Sheet>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-white/50">{label}</span>
      <span className="font-bold">{value}</span>
    </div>
  );
}
