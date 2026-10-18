// Leaving the zone editor with unsaved changes (docs/12-planning/atm-map-zones.md §8.7, DM-29).
//
// `useBlocker` does not work under the app's `<BrowserRouter>` (react-router 6 needs a data
// router), so the guard is built from three pieces, active only while the draft is dirty:
//   · a `beforeunload` prompt for closing or reloading the tab;
//   · `confirmLeave(go)` for the page's own links and buttons, which opens the leave dialog;
//   · a CAPTURE-phase `document` click listener for every other same-origin anchor — the sidebar
//     rows are `NavLink`s. It runs before React's root listener, so it can stop the click, ask,
//     and navigate on a yes.
// A module switch through `navigate()` and the idle logout pass no anchor; the stored draft
// (`zone-draft-storage.ts`) is what protects those.
//
// A CONFIRMED LEAVE DISCARDS THE DRAFT: the person chose to leave without saving, so `onLeave`
// (which clears the stored draft) runs before the navigation.
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { useNavigate } from 'react-router-dom';

/** The parts of a click this file reads. */
export interface GuardClickEvent {
  defaultPrevented: boolean;
  button: number;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  target: unknown;
}

interface AnchorLike {
  getAttribute: (name: string) => string | null;
  hasAttribute: (name: string) => boolean;
}

interface ElementLike {
  closest?: (selector: string) => unknown;
}

interface LocationLike {
  href: string;
  origin: string;
  pathname: string;
  search: string;
}

/** The router's basename, as `App.tsx` derives it. */
const appBasename = (): string => import.meta.env.BASE_URL.replace(/\/$/, '') || '/';

/**
 * The in-app path a click would navigate to, when the guard should stop it and ask — or null to
 * let it through: a modifier or a middle click (a new tab leaves this one alone), `target` other
 * than `_self`, a `download` link, another origin, an anchor inside the page's own root (the page
 * guards those itself), or a link to the very page already open.
 */
export const interceptableHref = (
  event: GuardClickEvent,
  location: LocationLike,
  options: { ownRoot?: { contains: (node: never) => boolean } | null; basename?: string } = {},
): string | null => {
  if (event.defaultPrevented || event.button !== 0) return null;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return null;
  const start = event.target as ElementLike | null;
  if (start === null || typeof start.closest !== 'function') return null;
  const anchor = start.closest('a[href]') as AnchorLike | null;
  if (anchor === null) return null;
  if (options.ownRoot?.contains(anchor as never) === true) return null;

  const target = anchor.getAttribute('target');
  if (target !== null && target !== '' && target !== '_self') return null;
  if (anchor.hasAttribute('download')) return null;

  let url: URL;
  try {
    url = new URL(anchor.getAttribute('href') ?? '', location.href);
  } catch {
    return null;
  }
  if (url.origin !== location.origin) return null;
  if (url.pathname === location.pathname && url.search === location.search) return null;

  const basename = options.basename ?? '/';
  const path =
    basename !== '/' && (url.pathname === basename || url.pathname.startsWith(`${basename}/`))
      ? url.pathname.slice(basename.length) || '/'
      : url.pathname;
  return `${path}${url.search}${url.hash}`;
};

export interface UnsavedGuard {
  /** Run `go` now when nothing is unsaved; otherwise open the leave dialog and run it on a yes. */
  confirmLeave: (go: () => void) => void;
  /** The leave dialog («لديك تغييرات غير محفوظة. هل تريد المغادرة دون حفظ؟») is open. */
  leaveOpen: boolean;
  confirm: () => void;
  cancel: () => void;
}

export const useUnsavedGuard = ({
  dirty,
  onLeave,
  rootRef,
}: {
  dirty: boolean;
  /** Runs on a confirmed leave, before navigating — the page clears the stored draft here. */
  onLeave?: () => void;
  /** The page's own root: its anchors go through `confirmLeave` and are not intercepted twice. */
  rootRef?: RefObject<HTMLElement>;
}): UnsavedGuard => {
  const navigate = useNavigate();
  const [pending, setPending] = useState<(() => void) | null>(null);
  const leave = useRef(onLeave);
  leave.current = onLeave;

  useEffect(() => {
    if (!dirty) return undefined;
    const onBeforeUnload = (event: BeforeUnloadEvent): void => {
      event.preventDefault();
      // Older browsers show the prompt only when `returnValue` is set.
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  useEffect(() => {
    if (!dirty) return undefined;
    const basename = appBasename();
    const onClick = (event: MouseEvent): void => {
      const href = interceptableHref(event, window.location, {
        ownRoot: rootRef?.current ?? null,
        basename,
      });
      if (href === null) return;
      event.preventDefault();
      event.stopPropagation();
      setPending(() => () => navigate(href));
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, [dirty, navigate, rootRef]);

  const confirmLeave = useCallback(
    (go: () => void) => {
      if (!dirty) {
        go();
        return;
      }
      setPending(() => go);
    },
    [dirty],
  );

  const confirm = useCallback(() => {
    const go = pending;
    setPending(null);
    leave.current?.();
    go?.();
  }, [pending]);

  const cancel = useCallback(() => setPending(null), []);

  return { confirmLeave, leaveOpen: pending !== null, confirm, cancel };
};
