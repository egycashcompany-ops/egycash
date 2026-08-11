// The account's preferences become this browser's, once a session exists.
//
// `MeDto.locale` has been sent by the server since the first release and read by nothing: the
// language and the theme lived in `localStorage` and stayed there across sign-outs. That had three
// consequences, and this component is the whole fix for all three:
//
//   • a user's language did not follow them to another device;
//   • on a shared machine the next person inherited the last one's language and theme;
//   • the UI could be in English while the server still wrote their email in Arabic, because
//     `email.adapter` reads `user.locale` and nothing had ever written it from the UI.
//
// The rule itself — when to mirror, and when to leave the client alone — is `decidePreferenceSync`,
// which is where the reasoning and the tests are. This file is the wiring: hold the last mirrored
// session in a ref, ask, dispatch. Direction is one-way; a toggle writing the account is
// `usePreferences`, and keeping the two apart is what stops the pair from answering each other.
//
// `localStorage` keeps its job, demoted: it paints the first frame before `/auth/me` lands, and it
// is the only store the pre-sign-in screens have. It is no longer the source of truth.
import { useEffect, useRef, type ReactNode } from 'react';
import { useAppDispatch, useAppSelector } from '../../store';
import { setLocale } from '../../store/localeSlice';
import { setTheme } from '../../store/uiSlice';
import { decidePreferenceSync } from './preference-sync';

export const PreferenceSync = ({ children }: { children: ReactNode }): JSX.Element => {
  const dispatch = useAppDispatch();
  const me = useAppSelector((state) => state.auth.me);
  const synced = useRef<string | null>(null);

  useEffect(() => {
    const decision = decidePreferenceSync(me, synced.current);
    synced.current = decision.syncedId;
    if (decision.locale !== undefined) dispatch(setLocale(decision.locale));
    if (decision.theme !== undefined) dispatch(setTheme(decision.theme));
  }, [me, dispatch]);

  return <>{children}</>;
};
