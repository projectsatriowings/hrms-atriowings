"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";
import { cn } from "@/lib/cn";

type ToastType = "success" | "error" | "info";

interface ToastItem {
  id: number;
  message: string;
  type: ToastType;
}

const ToastContext = createContext<{ toast: (message: string, type?: ToastType) => void }>({
  toast: () => {},
});

const ICONS: Record<ToastType, typeof CheckCircle2> = {
  success: CheckCircle2,
  error: AlertCircle,
  info: Info,
};

const COLORS: Record<ToastType, string> = {
  success: "text-success",
  error: "text-danger",
  info: "text-muted",
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const idRef = useRef(1);

  const toast = useCallback((message: string, type: ToastType = "info") => {
    const id = idRef.current++;
    setItems((prev) => [...prev, { id, message, type }]);
    setTimeout(() => setItems((prev) => prev.filter((t) => t.id !== id)), 4500);
  }, []);

  const dismiss = useCallback((id: number) => {
    setItems((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const value = useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-[min(92vw,380px)] flex-col gap-2">
        {items.map((t) => {
          const Icon = ICONS[t.type];
          return (
            <div
              key={t.id}
              className="animate-rise-fast pointer-events-auto flex items-start gap-3 rounded-xl border border-line bg-surface/90 p-3 shadow-xl backdrop-blur-xl"
            >
              <Icon className={cn("mt-0.5 h-5 w-5 shrink-0", COLORS[t.type])} />
              <p className="flex-1 text-sm text-inksoft">{t.message}</p>
              <button
                onClick={() => dismiss(t.id)}
                className="rounded p-0.5 text-faint transition-colors duration-150 hover:bg-soft hover:text-muted"
                aria-label="Dismiss"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
