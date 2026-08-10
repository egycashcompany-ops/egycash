// Renders the REAL badges against the REAL locale catalogs, for every value of both vocabularies
// and both locales — the LicenseStateBadge precedent, for the same reason: the i18n spec proves the
// catalogs hold the keys, and this proves the components ask for the keys they hold.
//
// The tone assertions are the part that matters operationally. An administrator scans this column
// to find the account that needs attention, so `locked` must not look like `activated`, and a
// disabled account must not look like an archived one — those are different decisions.
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import {
  ACCOUNT_STATUSES,
  USER_STATUSES,
  type AccountStatus,
  type Locale,
  type UserStatus,
} from '@ecms/contracts';
import { localeSlice } from '../../../../store/localeSlice';
import { translate } from '../../../../platform/localization/i18n';
import { AccountStatusBadge, UserStatusBadge } from './UserStatusBadges';

const render = (node: JSX.Element, locale: Locale): string => {
  const store = configureStore({
    reducer: { locale: localeSlice.reducer },
    preloadedState: {
      locale: { locale, dir: locale === 'ar' ? ('rtl' as const) : ('ltr' as const) },
    },
  });
  return renderToStaticMarkup(<Provider store={store}>{node}</Provider>);
};

/** The badge's own class list — the tone lives there, so two identical lists are one tone. */
const classesOf = (markup: string): string => /class="([^"]*)"/.exec(markup)?.[1] ?? '';

describe('UserStatusBadge', () => {
  for (const locale of ['en', 'ar'] as Locale[]) {
    for (const status of USER_STATUSES) {
      it(`shows the ${locale} label for ${status}`, () => {
        const key = `systemAdmin.users.status.${status}`;
        const label = translate(locale, key);
        expect(label).not.toBe(key);
        expect(render(<UserStatusBadge status={status} />, locale)).toContain(label);
      });
    }
  }

  it('gives every lifecycle state its own tone', () => {
    const tones = USER_STATUSES.map((s: UserStatus) =>
      classesOf(render(<UserStatusBadge status={s} />, 'en')),
    );
    expect(new Set(tones).size).toBe(USER_STATUSES.length);
  });
});

describe('AccountStatusBadge', () => {
  for (const locale of ['en', 'ar'] as Locale[]) {
    for (const status of ACCOUNT_STATUSES) {
      it(`shows the ${locale} label for ${status}`, () => {
        const key = `systemAdmin.users.accountStatus.${status}`;
        const label = translate(locale, key);
        expect(label).not.toBe(key);
        expect(render(<AccountStatusBadge status={status} />, locale)).toContain(label);
      });
    }
  }

  it('gives every derived account state its own tone', () => {
    const tones = ACCOUNT_STATUSES.map((s: AccountStatus) =>
      classesOf(render(<AccountStatusBadge status={s} />, 'en')),
    );
    expect(new Set(tones).size).toBe(ACCOUNT_STATUSES.length);
  });

  // The two vocabularies answer different questions and are shown side by side, so the pair a
  // reader sees most often — a live account — must not render as two identical chips.
  it('does not render the same tone as the lifecycle badge for the healthy case', () => {
    expect(classesOf(render(<AccountStatusBadge status="locked" />, 'en'))).not.toBe(
      classesOf(render(<UserStatusBadge status="active" />, 'en')),
    );
  });
});
