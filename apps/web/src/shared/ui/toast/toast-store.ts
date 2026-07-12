// Lightweight toast store — a framework-free external store consumed via useSyncExternalStore.
// Kept outside React so non-component code (the global Query/Mutation error handler) can raise
// toasts. This is the client-side "notification" sink; server notifications (the inbox/bell) are
// a separate feature.
import { useSyncExternalStore } from 'react';

export type ToastVariant = 'info' | 'success' | 'warning' | 'error';

export interface Toast {
  id: string;
  variant: ToastVariant;
  title: string;
  description?: string;
}

type Listener = () => void;

let toasts: Toast[] = [];
const listeners = new Set<Listener>();
const emit = (): void => listeners.forEach((l) => l());

const subscribe = (listener: Listener): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const getSnapshot = (): Toast[] => toasts;

let counter = 0;

export const dismissToast = (id: string): void => {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
};

const pushToast = (toast: Omit<Toast, 'id'>, ttlMs: number): string => {
  const id = `toast-${(counter += 1)}`;
  toasts = [...toasts, { ...toast, id }];
  emit();
  if (ttlMs > 0) window.setTimeout(() => dismissToast(id), ttlMs);
  return id;
};

const make = (variant: ToastVariant, title: string, description?: string): Omit<Toast, 'id'> =>
  description === undefined ? { variant, title } : { variant, title, description };

/** Fire-and-forget toasts. Errors linger longer so they are not missed. */
export const toast = {
  info: (title: string, description?: string): string => pushToast(make('info', title, description), 5000),
  success: (title: string, description?: string): string => pushToast(make('success', title, description), 5000),
  warning: (title: string, description?: string): string => pushToast(make('warning', title, description), 7000),
  error: (title: string, description?: string): string => pushToast(make('error', title, description), 8000),
};

export const useToasts = (): Toast[] => useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
