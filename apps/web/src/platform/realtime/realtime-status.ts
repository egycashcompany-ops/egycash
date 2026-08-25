// Tiny external store for "is the realtime socket up" — read by the bell to slow its poll from
// safety-net-only (5 min) to primary (60 s) and back, without a render dependency on the socket.
type Listener = () => void;

let connected = false;
const listeners = new Set<Listener>();

export const realtimeStatus = {
  subscribe: (listener: Listener): (() => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  getSnapshot: (): boolean => connected,
  /**
   * Required by `useSyncExternalStore` wherever the tree can render outside a live browser —
   * the web test harness renders to static markup, and a store without this throws there.
   * Always false: a render with no client has no socket, so the bell falls back to its faster
   * poll, which is the correct answer for a snapshot that will never receive a push.
   */
  getServerSnapshot: (): boolean => false,
};

export const setRealtimeConnected = (value: boolean): void => {
  if (connected === value) return;
  connected = value;
  for (const listener of listeners) listener();
};
