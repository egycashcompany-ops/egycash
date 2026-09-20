// The browser's half of the inactivity rule (`SESSION_IDLE_MINUTES`).
//
// Two jobs, and they are opposites:
//
//   • while somebody is there — renew the session, so working for an hour never signs anybody
//     out and the token behind a long form is never the stale one;
//   • while nobody is there — stop renewing, warn on the last minute, and then close the
//     session and go to the sign-in screen.
//
// THE SERVER DECIDES; THIS ONLY KEEPS UP. `auth.service.refresh()` revokes a session whose
// `lastUsedAt` is older than the window, so a tab that failed to sign itself out is refused at
// its next request anyway. What this buys is that the person SEES it happen, on time, with a
// minute's notice, instead of discovering it when a save fails.
//
// Every decision is `idle-session.ts`, which is tested on its own; this file is the wiring —
// listeners, one interval, a dialog.
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../../shared/ui/Button';
import { Dialog } from '../../shared/ui/Dialog';
import { getIdleMinutes, renewSession } from '../../shared/lib/api-client';
import { queryClient } from '../../shared/lib/query-client';
import { useAppDispatch } from '../../store';
import { signedOut } from '../../store/authSlice';
import { useT } from '../localization/useT';
import { logoutRequest } from './api';
import {
  ACTIVITY_EVENTS,
  ACTIVITY_WRITE_THROTTLE_MS,
  clearActivity,
  idleStateAt,
  markActivity,
  readActivityAt,
  secondsLeft,
  shouldRenew,
} from './idle-session';

/** How often the countdown is recomputed. One second, because it is shown as seconds. */
const TICK_MS = 1_000;

export const IdleSessionGuard = ({ children }: { children: ReactNode }): JSX.Element => {
  const t = useT();
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const [warningSeconds, setWarningSeconds] = useState<number | null>(null);

  // Refs, not state: the tick reads these every second and must never be the reason the tree
  // re-renders. Only the countdown itself is state, because only it is on screen.
  const lastRenewAt = useRef<number>(Date.now());
  const signingOut = useRef(false);
  const lastWrite = useRef(0);

  /**
   * Sign out because the window ran out.
   *
   * The server call is best-effort and its failure changes nothing: the session is already
   * unusable by the rule above, and a network error must not leave the person staring at a
   * screen that is no longer signed in. Local state is cleared either way.
   */
  const endSession = useCallback((): void => {
    if (signingOut.current) return;
    signingOut.current = true;
    setWarningSeconds(null);
    clearActivity();
    void logoutRequest()
      .catch(() => {
        // Already closed server-side, or unreachable. Nothing here depends on the answer.
      })
      .finally(() => {
        dispatch(signedOut());
        queryClient.clear();
        // `reason` is what lets the sign-in screen say WHY, instead of the bare form that reads
        // as "you were thrown out" to somebody who only stepped away for coffee.
        navigate('/login?reason=idle', { replace: true });
      });
  }, [dispatch, navigate]);

  /** Somebody is here: reset the count, and take the warning down if it was up. */
  const noteActivity = useCallback((): void => {
    const now = Date.now();
    markActivity(now);
    // React bails out when the next value is the one already held, so setting `null` on a tick
    // where no warning is up costs nothing and there is no need to read the current value.
    setWarningSeconds(null);
    lastWrite.current = now;
  }, []);

  // ── The listeners ────────────────────────────────────────────────────────
  useEffect(() => {
    markActivity();
    const onActivity = (): void => {
      const now = Date.now();
      // Throttled: `pointermove` and `scroll` arrive in bursts and each one would otherwise be a
      // write to storage. The deadline is a minute away at worst, so five seconds of resolution
      // costs nothing and keeps a drag from writing a hundred times.
      if (now - lastWrite.current < ACTIVITY_WRITE_THROTTLE_MS) return;
      lastWrite.current = now;
      markActivity(now);
    };
    for (const name of ACTIVITY_EVENTS) {
      window.addEventListener(name, onActivity, { passive: true });
    }
    return () => {
      for (const name of ACTIVITY_EVENTS) window.removeEventListener(name, onActivity);
    };
  }, []);

  // ── The tick ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const tick = (): void => {
      const idleMs = getIdleMinutes() * 60_000;
      if (idleMs <= 0) {
        // No window on this deployment, or the server has not said yet. Nothing counts down.
        setWarningSeconds(null);
        return;
      }
      const now = Date.now();
      const lastActivityAt = readActivityAt();
      const state = idleStateAt({ lastActivityAt, now, idleMs });

      if (state.phase === 'expired') {
        endSession();
        return;
      }

      setWarningSeconds(state.phase === 'warning' ? secondsLeft(state.msLeft) : null);

      // The renewal is what tells the server somebody is here, so it happens only when somebody
      // has been — see `shouldRenew`.
      if (shouldRenew({ lastActivityAt, lastRenewAt: lastRenewAt.current, now, idleMs })) {
        lastRenewAt.current = now;
        void renewSession().then((ok) => {
          // A refused renewal is a session that is already gone; the api client has signed the
          // app out through its own auth-loss handler, so there is nothing to do but stop.
          if (!ok) signingOut.current = true;
        });
      }
    };
    const id = window.setInterval(tick, TICK_MS);
    return () => {
      window.clearInterval(id);
    };
  }, [endSession]);

  return (
    <>
      {children}
      <Dialog
        open={warningSeconds !== null}
        // Not dismissible by a stray click: the one way to answer this is to say you are here,
        // and a backdrop click that silently cancelled the warning while the countdown carried
        // on would be the worst of both.
        dismissOnOutsideClick={false}
        onClose={noteActivity}
        size="sm"
        title={t('auth.idle.warningTitle')}
        description={t('auth.idle.warningBody', { seconds: String(warningSeconds ?? 0) })}
        footer={
          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              onClick={() => {
                endSession();
              }}
            >
              {t('auth.idle.signOutNow')}
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                noteActivity();
                lastRenewAt.current = Date.now();
                void renewSession();
              }}
            >
              {t('auth.idle.staySignedIn')}
            </Button>
          </div>
        }
      >
        <p className="text-sm text-[var(--color-text-muted)]">{t('auth.idle.warningHint')}</p>
      </Dialog>
    </>
  );
};
