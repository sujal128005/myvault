import { CheckCircle2, AlertCircle, Info } from 'lucide-react';
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';

type ToastKind = 'success' | 'error' | 'info';
interface Toast {
  id: number;
  kind: ToastKind;
  text: string;
  sub?: string;
}
type ToastFn = (text: string, opts?: { kind?: ToastKind; sub?: string; ms?: number }) => void;

const Ctx = createContext<ToastFn>(() => undefined);
export const useToast = () => useContext(Ctx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(0);
  const toast = useCallback<ToastFn>((text, opts = {}) => {
    const id = ++seq.current;
    const t: Toast = { id, kind: opts.kind ?? 'success', text, sub: opts.sub };
    setToasts([t]);
    setTimeout(() => setToasts((prev) => prev.filter((x) => x.id !== id)), opts.ms ?? 2600);
  }, []);
  const value = useMemo(() => toast, [toast]);
  return (
    <Ctx.Provider value={value}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>
            {t.kind === 'success' ? <CheckCircle2 /> : t.kind === 'error' ? <AlertCircle /> : <Info />}
            <span>
              {t.text}
              {t.sub && <span className="sub"> · {t.sub}</span>}
            </span>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
