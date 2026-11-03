// The heartbeat's wiring: one interval, one request, every decision in `heartbeat.ts`.
//
// Mounted inside the STAFF session gate only: a customer or a candidate in a portal is not a user
// of the system the active users page describes, and their sessions cannot reach this endpoint.
// A failed heartbeat is dropped, never retried or reported: the next minute's says the same thing.
import { useEffect, useRef } from 'react';
import { api } from '../../shared/lib/api-client';
import { readActivityAt } from '../auth/idle-session';
import { HEARTBEAT_CHECK_MS, shouldBeat } from './heartbeat';

export const PresenceHeartbeat = (): null => {
  const lastBeatAt = useRef(0);
  useEffect(() => {
    const check = (): void => {
      const now = Date.now();
      const visible = typeof document === 'undefined' || document.visibilityState === 'visible';
      if (
        !shouldBeat({
          lastActivityAt: readActivityAt(),
          lastBeatAt: lastBeatAt.current,
          now,
          visible,
        })
      ) {
        return;
      }
      lastBeatAt.current = now;
      void api<void>('/platform/presence/heartbeat', { method: 'POST' }).catch(() => undefined);
    };
    check();
    const id = window.setInterval(check, HEARTBEAT_CHECK_MS);
    return () => window.clearInterval(id);
  }, []);
  return null;
};
