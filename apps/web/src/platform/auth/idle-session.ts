// When an unattended screen stops being a signed-in screen.
//
// THE RULE, in one line: a session that nobody has touched for `SESSION_IDLE_MINUTES` is closed,
// and a session somebody IS touching is never closed at all.
//
// The server owns the rule and enforces it from `sessions.lastUsedAt` (see `auth.service.ts`).
// This module is the browser's half: it watches for a human, renews the session while one is
// there, and counts down to the same number the server is counting to. Nothing here can keep a
// session alive that the server has decided to close — a client that lied about activity would
// still be refused at the next renewal, because the renewal IS the proof.
//
// EVERY DECISION IS A PURE FUNCTION. There is no jsdom in this suite, so a timer, a listener and
// a dialog cannot be tested by clicking them; what can be tested exhaustively is the arithmetic
// that drives them, and that is why the arithmetic lives here rather than inside the component.

/**
 * Where the last sign of life is written, so every tab of the same browser agrees.
 *
 * Two tabs are ONE person. Without a shared record the tab being read would sign the person out
 * while they typed in the other one, which is precisely the failure this whole feature must not
 * introduce. `localStorage` is per-origin and synchronous, which is what makes a shared answer
 * cheap enough to read on every tick.
 */
export const ACTIVITY_KEY = 'ecms.session.lastActivityAt';

/** How long before the deadline the screen says so. Never more than half the window. */
export const WARN_BEFORE_MS = 60_000;

/** However long the window is, an active browser proves it is active at least this often. */
export const RENEW_AT_MOST_EVERY_MS = 5 * 60_000;

export type IdlePhase = 'active' | 'warning' | 'expired';

export interface IdleState {
  phase: IdlePhase;
  /** Milliseconds until the session closes; `Infinity` when the window is switched off. */
  msLeft: number;
}

/**
 * How long the warning is actually shown, given the window.
 *
 * A minute of warning inside a two-minute window is half of it, which is fine. A minute inside a
 * one-minute window would mean the warning is on screen from the first second, which is not a
 * warning at all — so it is capped at half the window and the countdown stays meaningful at any
 * setting an operator picks.
 */
export const warningWindowMs = (idleMs: number, warnBeforeMs: number = WARN_BEFORE_MS): number =>
  Math.max(0, Math.min(warnBeforeMs, Math.floor(idleMs / 2)));

/**
 * Where this session stands, right now.
 *
 * `idleMs <= 0` is the switch-off: the deployment has no inactivity window and this answers
 * `active` forever, so nothing counts down and nothing signs anybody out.
 *
 * A `lastActivityAt` in the FUTURE is not trusted to extend the session beyond one whole window.
 * It happens for real — another tab writing while this machine's clock is being corrected, or a
 * laptop waking with a clock that jumped — and left unclamped it would read as "active for the
 * next three hours", which is the one answer that would quietly disable the control.
 */
export const idleStateAt = (args: {
  lastActivityAt: number;
  now: number;
  idleMs: number;
  warnBeforeMs?: number;
}): IdleState => {
  const { lastActivityAt, now, idleMs } = args;
  if (!Number.isFinite(idleMs) || idleMs <= 0) {
    return { phase: 'active', msLeft: Number.POSITIVE_INFINITY };
  }
  const deadline = Math.min(lastActivityAt, now) + idleMs;
  const msLeft = deadline - now;
  if (msLeft <= 0) return { phase: 'expired', msLeft: 0 };
  if (msLeft <= warningWindowMs(idleMs, args.warnBeforeMs)) return { phase: 'warning', msLeft };
  return { phase: 'active', msLeft };
};

/**
 * Should the browser renew the session now?
 *
 * TWO CONDITIONS, AND THE FIRST IS THE POINT. A renewal is the browser telling the server "there
 * is somebody here", so it may only happen when there HAS been somebody here since the last one.
 * A timer that renewed unconditionally would hold every abandoned screen open for ever and turn
 * the whole window into decoration.
 *
 * The second condition is just cadence: often enough that `lastUsedAt` never approaches the
 * window while a person is working, rarely enough not to be a request per keystroke.
 */
export const shouldRenew = (args: {
  lastActivityAt: number;
  lastRenewAt: number;
  now: number;
  idleMs: number;
}): boolean => {
  const { lastActivityAt, lastRenewAt, now, idleMs } = args;
  if (!Number.isFinite(idleMs) || idleMs <= 0) return false;
  if (lastActivityAt <= lastRenewAt) return false;
  return now - lastRenewAt >= renewEveryMs(idleMs);
};

/** Half the window, and never longer than `RENEW_AT_MOST_EVERY_MS`. At least one second. */
export const renewEveryMs = (idleMs: number): number =>
  Math.max(1_000, Math.min(Math.floor(idleMs / 2), RENEW_AT_MOST_EVERY_MS));

/** Whole seconds remaining, for a countdown that reads 60, 59, 58 rather than 59.8. */
export const secondsLeft = (msLeft: number): number =>
  Number.isFinite(msLeft) ? Math.max(0, Math.ceil(msLeft / 1_000)) : 0;

// ── The shared record of the last sign of life ─────────────────────────────
//
// Every read and write is wrapped: `localStorage` throws outright in a browser with site data
// blocked, and a session guard that crashes the application it guards would be worse than no
// guard. The in-memory value is the fallback, so a single tab still behaves correctly there.

let inMemoryActivityAt = Date.now();

export const markActivity = (at: number = Date.now()): void => {
  inMemoryActivityAt = at;
  try {
    window.localStorage.setItem(ACTIVITY_KEY, String(at));
  } catch {
    // Storage is unavailable; the in-memory value above still drives this tab.
  }
};

/**
 * The latest activity ANY tab has recorded.
 *
 * The maximum rather than the stored value: a tab that cannot write to storage must not be signed
 * out on the strength of another tab's older timestamp, and a tab that can must not ignore a
 * sibling that is newer.
 */
export const readActivityAt = (): number => {
  let stored = 0;
  try {
    stored = Number(window.localStorage.getItem(ACTIVITY_KEY) ?? 0);
  } catch {
    stored = 0;
  }
  return Math.max(inMemoryActivityAt, Number.isFinite(stored) ? stored : 0);
};

/** Forget the shared record. Called on sign-out so the next session starts its own count. */
export const clearActivity = (): void => {
  inMemoryActivityAt = Date.now();
  try {
    window.localStorage.removeItem(ACTIVITY_KEY);
  } catch {
    // Nothing to clear.
  }
};

/**
 * The events that count as a person.
 *
 * `mousemove` is in the list and `scroll` is not an accident: both fire in bursts, which is why
 * the component throttles. What is deliberately NOT here is anything the application itself can
 * cause — a background poll, a socket message, a re-render — because those continue on an
 * abandoned screen and would make it look occupied for ever.
 */
export const ACTIVITY_EVENTS = [
  'pointerdown',
  'pointermove',
  'keydown',
  'wheel',
  'scroll',
  'touchstart',
] as const;

/** How rarely a burst of those events is allowed to write. */
export const ACTIVITY_WRITE_THROTTLE_MS = 5_000;
