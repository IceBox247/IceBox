import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { CheckIcon } from './icons';

interface ToastItem {
  id: number;
  message: string;
  tone: 'success' | 'error' | 'info';
}

interface ToastCtx {
  show: (message: string, tone?: ToastItem['tone']) => void;
}

const Ctx = createContext<ToastCtx | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const show = useCallback((message: string, tone: ToastItem['tone'] = 'info') => {
    const id = Date.now() + Math.random();
    setItems((prev) => [...prev, { id, message, tone }]);
    setTimeout(() => setItems((prev) => prev.filter((t) => t.id !== id)), 2600);
  }, []);

  return (
    <Ctx.Provider value={{ show }}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 top-4 z-[60] flex flex-col items-center gap-2 px-4">
        {items.map((t) => (
          <div
            key={t.id}
            className={`animate-fade-in flex items-center gap-2 rounded-2xl px-4 py-3 text-sm font-semibold shadow-card backdrop-blur ${
              t.tone === 'success'
                ? 'bg-usdt/90 text-white'
                : t.tone === 'error'
                  ? 'bg-red-500/90 text-white'
                  : 'bg-night-600/95 text-white border border-white/10'
            }`}
          >
            {t.tone === 'success' && <CheckIcon width={16} height={16} />}
            {t.message}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export function useToast(): ToastCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}
