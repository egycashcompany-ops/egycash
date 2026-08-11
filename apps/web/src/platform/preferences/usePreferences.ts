// One way to change a preference, used by every control that changes one.
//
// The shape is the one `NavLayoutToggle` established: the account is asked first, and the response
// — the whole `me` — goes back into the store, so the shell never shows one thing while the record
// says another. What P9-B adds is that `locale` and `theme` also drive CLIENT state (the locale
// slice, the ui slice), and those are applied optimistically: waiting for a round trip before the
// language flips would make a toggle feel broken on a slow link. If the save fails the local value
// is put back, so the two never disagree for longer than the request takes.
//
// Before sign-in there is no account to ask. The toggles still work — they are on the login,
// activation and forced-change screens — so with `me === null` this writes the local state and
// stops there, exactly as those screens behaved before this phase.
import { useCallback, useState } from 'react';
import {
  type ThemeMode,
  type Locale,
  type NavLayout,
  type UpdateMyPreferences,
} from '@ecms/contracts';
import { useAppDispatch, useAppSelector } from '../../store';
import { signedIn } from '../../store/authSlice';
import { setLocale } from '../../store/localeSlice';
import { setTheme } from '../../store/uiSlice';
import { updateMyPreferencesRequest } from '../auth/api';

export interface Preferences {
  locale: Locale;
  theme: ThemeMode;
  navLayout: NavLayout;
}

export interface PreferencesApi extends Preferences {
  /** True while a save is in flight — controls disable themselves rather than queue. */
  saving: boolean;
  /** Whether the values are backed by an account, or are this browser's until someone signs in. */
  signedIn: boolean;
  save: (next: UpdateMyPreferences) => void;
}

export const usePreferences = (): PreferencesApi => {
  const dispatch = useAppDispatch();
  const me = useAppSelector((state) => state.auth.me);
  const locale = useAppSelector((state) => state.locale.locale);
  const theme = useAppSelector((state) => state.ui.theme);
  const [saving, setSaving] = useState(false);

  // The shell reads `navLayout` from the account and nowhere else, so unlike the other two it has
  // no local value to fall back on and simply defaults the way `buildMe` does.
  const navLayout: NavLayout = me?.navLayout ?? 'launchpad';

  const save = useCallback(
    (next: UpdateMyPreferences): void => {
      const previous = { locale, theme };
      // Local first: the language and the colour scheme change under the user's hand.
      if (next.locale !== undefined) dispatch(setLocale(next.locale));
      if (next.theme !== undefined) dispatch(setTheme(next.theme));

      if (me === null) return; // no account yet — the login screen's toggles end here
      setSaving(true);
      void updateMyPreferencesRequest(next)
        .then((updated) => dispatch(signedIn(updated)))
        .catch(() => {
          // The account refused or the network did. Put the local value back rather than leave
          // the screen claiming a preference that was never stored.
          if (next.locale !== undefined) dispatch(setLocale(previous.locale));
          if (next.theme !== undefined) dispatch(setTheme(previous.theme));
        })
        .finally(() => setSaving(false));
    },
    [dispatch, locale, me, theme],
  );

  return { locale, theme, navLayout, saving, signedIn: me !== null, save };
};
