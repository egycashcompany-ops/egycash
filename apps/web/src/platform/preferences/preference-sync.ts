// The decision `PreferenceSync` makes, separated from the effect that runs it.
//
// It lives apart from the component for one reason: this suite has no DOM, so a `useEffect` never
// fires in it. A test that rendered the component and read the store back would pass whether the
// logic were right, wrong, or absent — which is the one outcome worse than no test. Pulled out, the
// rule is a pure function of (session, what was already synced) and can be checked directly, and
// the component keeps nothing but the wiring.
import { type Locale, type MeDto, type ThemeMode } from '@ecms/contracts';

export interface PreferenceSyncDecision {
  /** Dispatch when present. Absent means "leave the client's value alone". */
  locale?: Locale;
  theme?: ThemeMode;
  /** The session now considered mirrored — `null` once signed out, so signing in mirrors again. */
  syncedId: string | null;
}

/**
 * Mirror the account onto the client when a SESSION APPEARS — and only then.
 *
 * Keying on the session's identity rather than on whether the values differ is what makes an
 * optimistic save possible. `signedIn` is dispatched after every preference write, and between the
 * user pressing a toggle and the server confirming, the client is deliberately AHEAD of the
 * account. A rule that compared values would drag it back in that window and the toggle would look
 * like it did nothing.
 */
export const decidePreferenceSync = (
  me: MeDto | null,
  syncedId: string | null,
): PreferenceSyncDecision => {
  // Signed out: the local values stay as they are — the login screen is rendered in them — but the
  // mark is cleared, so whoever signs in next gets to overwrite them.
  if (me === null) return { syncedId: null };
  if (me.id === syncedId) return { syncedId };
  return { locale: me.locale, theme: me.theme, syncedId: me.id };
};
