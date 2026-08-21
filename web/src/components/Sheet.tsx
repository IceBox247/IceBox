import { useEffect, type ReactNode } from 'react';
import { CloseIcon } from './icons';

interface SheetProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
}

/** A bottom sheet with a scrim, matching the reference app's modals. */
export function Sheet({ open, onClose, title, children }: SheetProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm animate-fade-in"
        onClick={onClose}
      />
      <div className="relative flex max-h-[90vh] w-full max-w-md flex-col rounded-t-[28px] border-t border-white/10 bg-night-800 shadow-2xl animate-sheet-up">
        {/* Fixed header (drag handle + title) stays put while the body scrolls. */}
        <div className="shrink-0 px-5 pt-5">
          <div className="mx-auto mb-4 h-1.5 w-12 rounded-full bg-white/15" />
          {title && (
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-center text-2xl font-extrabold flex-1">{title}</h2>
              <button
                onClick={onClose}
                className="grid h-9 w-9 place-items-center rounded-full bg-white/5 text-white/70"
                aria-label="Close"
              >
                <CloseIcon width={18} height={18} />
              </button>
            </div>
          )}
        </div>
        {/* Scrollable body — overflows internally instead of pushing the top off-screen. */}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-8">
          {children}
        </div>
      </div>
    </div>
  );
}
