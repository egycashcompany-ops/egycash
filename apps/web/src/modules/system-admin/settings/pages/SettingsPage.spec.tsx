// The settings screen, rendered for real.
//
// **Why this file renders instead of scanning the source.** P7-C shipped a Duplicate button that no
// administrator could reach: every assertion covering it was a source scan or a pure-function test,
// each one true, and the control was unreachable in the states the page is actually in. A regex
// proving a `<Can>` wrapper sits near a label cannot see that the wrapper is nested inside a branch
// that removes it. So the claims that matter here — *all twenty-nine appear*, *without the edit
// permission every control is disabled*, *each input is labelled* — are made against the markup the
// component actually produces.
//
// The web suite runs with `environment: 'node'` and carries no jsdom (`vitest.config.ts`), so
// nothing clicks. `renderToStaticMarkup` gives the DOM as it first paints, which is enough for
// every claim above: presence, disabled, ids, `for`, `aria-*`, direction, and the text of both
// locales. Behaviour that needs a click — a save round-trip — is proven where it lives, in
// `../lib/settings-view.spec.ts`.
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  FleetSettingKeys,
  HrContractSettingKeys,
  HrLeaveSettingKeys,
  ItSettingKeys,
  SettingKeys,
  type Locale,
  type MeDto,
  type ResolvedSettingDto,
  type SettingDefinitionDto,
} from '@ecms/contracts';
import { localeSlice } from '../../../../store/localeSlice';
import { authSlice } from '../../../../store/authSlice';
import { SettingsPage } from './SettingsPage';

/**
 * The twenty-nine, with the type and default each is declared with in the API.
 *
 * The KEYS are not written here — they come from the contracts objects the declarations themselves
 * use, so a setting added to the platform cannot quietly miss this screen. The type and default are
 * local because `SettingDefinitionDto` derives them at runtime from the Zod schema, and a fixture
 * that guessed them would prove nothing about rendering. The first test pins that this table covers
 * every declared key, which is what stops it drifting.
 */
const SHAPES: Record<string, { type: string; defaultValue: unknown }> = {
  [SettingKeys.PasswordMinLength]: { type: 'number', defaultValue: 10 },
  [SettingKeys.PasswordRequireComplexity]: { type: 'boolean', defaultValue: true },
  [SettingKeys.LockoutMaxAttempts]: { type: 'number', defaultValue: 5 },
  [SettingKeys.LockoutMinutes]: { type: 'number', defaultValue: 15 },
  [SettingKeys.TotpEnforcedForPrivileged]: { type: 'boolean', defaultValue: true },
  [SettingKeys.AuthLoginIdentifiers]: {
    type: 'array',
    defaultValue: ['username', 'email', 'employeeCode'],
  },
  [SettingKeys.ActivationLinkTtlHours]: { type: 'number', defaultValue: 48 },
  [SettingKeys.AuditRetentionActivityDays]: { type: 'number', defaultValue: 730 },
  [SettingKeys.AuditExportMaxRows]: { type: 'number', defaultValue: 50_000 },
  [SettingKeys.AuditSignalsDeniedThreshold]: { type: 'number', defaultValue: 10 },
  [SettingKeys.AuditSignalsExportSpikeThreshold]: { type: 'number', defaultValue: 20 },
  [SettingKeys.NotificationsEmailEnabled]: { type: 'boolean', defaultValue: true },
  [SettingKeys.NotificationsQuietHoursEnabledByDefault]: { type: 'boolean', defaultValue: false },
  [HrContractSettingKeys.NumberFormat]: { type: 'string', defaultValue: 'CT-{year}-{seq:5}' },
  [HrContractSettingKeys.RequireApproval]: { type: 'boolean', defaultValue: true },
  [HrContractSettingKeys.ExpiryNoticeDays]: { type: 'number', defaultValue: 30 },
  [HrLeaveSettingKeys.WeekendDays]: { type: 'array', defaultValue: [5, 6] },
  [HrLeaveSettingKeys.ApprovalReminderDays]: { type: 'number', defaultValue: 3 },
  [HrLeaveSettingKeys.ServiceAcrossPeriods]: { type: 'boolean', defaultValue: true },
  [ItSettingKeys.SlaAtRiskPercent]: { type: 'number', defaultValue: 80 },
  [ItSettingKeys.TicketAutoCloseDays]: { type: 'number', defaultValue: 7 },
  [ItSettingKeys.PreventiveHorizonDays]: { type: 'number', defaultValue: 7 },
  [ItSettingKeys.WarrantyWarnDays]: { type: 'number', defaultValue: 30 },
  [ItSettingKeys.LicenseWarnDays]: { type: 'number', defaultValue: 30 },
  [FleetSettingKeys.AlarmYellowKm]: { type: 'number', defaultValue: 1000 },
  [FleetSettingKeys.AlarmRedKm]: { type: 'number', defaultValue: 300 },
  [FleetSettingKeys.UseHrLeave]: { type: 'boolean', defaultValue: true },
  [FleetSettingKeys.VehicleLicenseWarnDays]: { type: 'number', defaultValue: 30 },
  [FleetSettingKeys.DriverLicenseWarnDays]: { type: 'number', defaultValue: 30 },
};

/** Every key the contracts declare, which is what the API registers at boot. */
const DECLARED_KEYS: string[] = [
  ...Object.values(SettingKeys),
  ...Object.values(HrContractSettingKeys),
  ...Object.values(HrLeaveSettingKeys),
  ...Object.values(ItSettingKeys),
  ...Object.values(FleetSettingKeys),
];

const definition = (key: string): SettingDefinitionDto => {
  const shape = SHAPES[key] ?? { type: 'number', defaultValue: 0 };
  return {
    key,
    description: `English description for ${key}`,
    type: shape.type,
    defaultValue: shape.defaultValue,
    // Only the email kill switch is settable below the organization; everything else is org-only.
    allowedScopes:
      key === SettingKeys.NotificationsEmailEnabled
        ? ['organization', 'branch', 'user']
        : ['organization'],
  };
};

const DEFINITIONS: SettingDefinitionDto[] = DECLARED_KEYS.map(definition);

const RESOLVED: ResolvedSettingDto[] = DEFINITIONS.map((def) => ({
  key: def.key,
  value: def.defaultValue,
  resolvedFrom: 'organization',
}));

const me = (permissions: string[]): MeDto => ({
  id: 'u1',
  email: 'admin@ecms.local',
  username: null,
  mustChangePassword: false,
  name: { firstName: { ar: 'أ', en: 'A' }, lastName: { ar: 'ب', en: 'B' } },
  locale: 'en',
  navLayout: 'rail',
  theme: 'system',
  branchId: null,
  employeeId: null,
  permissions: Object.fromEntries(permissions.map((key) => [key, 'organization' as const])),
  isPrivileged: false,
  flags: {},
  totpEnabled: false,
});

const render = ({
  locale = 'en',
  permissions = ['setting.view', 'setting.edit'],
  definitions = DEFINITIONS,
  resolved = RESOLVED,
  search = '',
}: {
  locale?: Locale;
  permissions?: string[];
  definitions?: SettingDefinitionDto[];
  resolved?: ResolvedSettingDto[];
  search?: string;
} = {}): string => {
  const store = configureStore({
    reducer: { locale: localeSlice.reducer, auth: authSlice.reducer },
    preloadedState: {
      locale: { locale, dir: locale === 'ar' ? ('rtl' as const) : ('ltr' as const) },
      auth: { me: me(permissions), status: 'signedIn' as const },
    },
  });
  // Seeded and never refetched: the screen under test is the one the server's data produces, and a
  // background fetch in a node environment would only add noise.
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity, refetchOnMount: false } },
  });
  qc.setQueryData(['platform', 'settings', 'definitions'], definitions);
  qc.setQueryData(['platform', 'settings', 'me'], resolved);

  return renderToStaticMarkup(
    <Provider store={store}>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[`/system/settings${search}`]}>
          <SettingsPage />
        </MemoryRouter>
      </QueryClientProvider>
    </Provider>,
  );
};

/** Every `<input …>` tag in the markup, so a claim about "the controls" can count them. */
const inputs = (markup: string): string[] => [...markup.matchAll(/<input\b[^>]*>/g)].map((m) => m[0]);

/**
 * The ATTRIBUTE, not the Tailwind class. Every control carries `disabled:bg-slate-50` in its
 * className whether or not it is disabled, so a substring test for "disabled" passes on every
 * input ever rendered — which is exactly the kind of assertion that is true and proves nothing.
 * React serialises the boolean attribute as `disabled=""`.
 */
const isDisabled = (tag: string): boolean => tag.includes('disabled=""');

/**
 * The markup below the filter bar.
 *
 * The owner filter renders every owner name as an `<option>`, so searching the whole page for a
 * card heading finds the dropdown entry instead — an off-by-one-region that would make the grouping
 * assertion pass no matter where the rows landed.
 */
const cardsOnly = (markup: string): string => markup.slice(markup.lastIndexOf('</select>'));

describe('the fixture tracks the real registry', () => {
  it('covers every declared setting key, and there are twenty-nine of them', () => {
    expect(DECLARED_KEYS).toHaveLength(29);
    expect(new Set(DECLARED_KEYS).size).toBe(29);
    const uncovered = DECLARED_KEYS.filter((key) => SHAPES[key] === undefined);
    expect(uncovered, 'a setting was declared without a shape in this fixture').toEqual([]);
  });
});

describe('every setting reaches the screen', () => {
  const markup = render();

  // The claim the whole slice exists for. Twenty-four of these could previously be changed only by
  // editing the database.
  it('renders all twenty-nine keys', () => {
    const missing = DECLARED_KEYS.filter((key) => !markup.includes(key));
    expect(missing, 'a setting is declared but not on screen').toEqual([]);
  });

  it('renders one editable control per setting', () => {
    // 29 settings + the search box = 30 inputs. The owner filter is a <select>, not an input.
    expect(inputs(markup)).toHaveLength(30);
  });

  it('groups them under their owners', () => {
    for (const owner of [
      'Sign-in &amp; passwords',
      'Audit &amp; activity',
      'Notifications',
      'Contracts',
      'HR',
      'Fleet',
      'IT',
    ]) {
      expect(markup, `${owner} has no card`).toContain(owner);
    }
  });

  // Grouping is only meaningful if a key lands under its own owner. Position in the markup is the
  // only ordering evidence a static render carries, and it is enough: the auth keys must all appear
  // after the auth heading and before the next one.
  it('puts each key inside its owner’s card', () => {
    const cards = cardsOnly(markup);
    const authHeading = cards.indexOf('Sign-in &amp; passwords');
    const auditHeading = cards.indexOf('Audit &amp; activity');
    expect(authHeading).toBeGreaterThan(-1);
    expect(auditHeading).toBeGreaterThan(authHeading);
    const authKeys = Object.values(SettingKeys).filter((key) => key.startsWith('auth.'));
    expect(authKeys, 'the auth scan matched nothing — it is stale').toHaveLength(7);
    for (const key of authKeys) {
      const at = cards.indexOf(key);
      expect(at, `${key} is outside the auth card`).toBeGreaterThan(authHeading);
      expect(at, `${key} is outside the auth card`).toBeLessThan(auditHeading);
    }
  });

  it('shows a count of what is displayed against the total', () => {
    expect(markup).toContain('Showing 29 of 29');
  });
});

describe('the four types each get the control they need', () => {
  const markup = render();

  const controlFor = (key: string): string => {
    // Each row prints its key, then its control. The next `<input` after the key is that row's.
    const at = markup.indexOf(key);
    const input = markup.indexOf('<input', at);
    return markup.slice(input, markup.indexOf('>', input) + 1);
  };

  it('renders a boolean as a checkbox', () => {
    expect(controlFor(SettingKeys.PasswordRequireComplexity)).toContain('type="checkbox"');
  });

  it('renders a number as a numeric text field carrying its resolved value', () => {
    const control = controlFor(SettingKeys.PasswordMinLength);
    expect(control).toContain('inputMode="numeric"');
    expect(control).toContain('value="10"');
  });

  it('renders a string as a plain field carrying its resolved value', () => {
    const control = controlFor(HrContractSettingKeys.NumberFormat);
    expect(control).not.toContain('type="checkbox"');
    expect(control).toContain('CT-{year}-{seq:5}');
  });

  it('renders an array as a comma-separated field', () => {
    expect(controlFor(SettingKeys.AuthLoginIdentifiers)).toContain(
      'value="username, email, employeeCode"',
    );
    expect(controlFor(HrLeaveSettingKeys.WeekendDays)).toContain('value="5, 6"');
  });

  // A type this screen has never seen keeps its place read-only rather than vanishing.
  it('shows a type it cannot edit as a read-only field rather than hiding the setting', () => {
    const odd: SettingDefinitionDto = {
      key: 'warehouse.layout',
      description: 'a shape this screen has never seen',
      type: 'object',
      defaultValue: { a: 1 },
      allowedScopes: ['organization'],
    };
    const markupWithOdd = render({
      definitions: [odd],
      resolved: [{ key: odd.key, value: { a: 1 }, resolvedFrom: 'organization' }],
    });
    expect(markupWithOdd).toContain('warehouse.layout');
    expect(markupWithOdd).toContain('readonly');
    expect(markupWithOdd).toContain('this screen cannot edit yet');
  });

  it('sends an unknown owner to Other instead of dropping it', () => {
    const markupWithOdd = render({
      definitions: [
        {
          key: 'warehouse.reorderPoint',
          description: 'an owner this screen does not know',
          type: 'number',
          defaultValue: 5,
          allowedScopes: ['organization'],
        },
      ],
      resolved: [],
    });
    expect(markupWithOdd).toContain('Other');
    expect(markupWithOdd).toContain('warehouse.reorderPoint');
  });
});

describe('editing is gated on setting.edit, in the markup and not only in the source', () => {
  it('disables every control for a reader who may view but not edit', () => {
    const markup = render({ permissions: ['setting.view'] });
    // The search box stays usable — reading is what this actor may do.
    const controls = inputs(markup).filter((tag) => !tag.includes('type="search"'));
    expect(controls).toHaveLength(29);
    const enabled = controls.filter((tag) => !isDisabled(tag));
    expect(enabled, 'a setting control is editable without setting.edit').toEqual([]);
  });

  it('says why, rather than showing a control that simply does not respond', () => {
    const markup = render({ permissions: ['setting.view'] });
    expect(markup).toContain('do not hold the edit-settings permission');
    expect(markup).toContain('may read these values but not change them');
  });

  it('leaves the controls enabled for an actor who holds setting.edit', () => {
    const markup = render();
    const controls = inputs(markup).filter((tag) => !tag.includes('type="search"'));
    expect(controls).toHaveLength(29);
    expect(controls.filter(isDisabled)).toEqual([]);
    expect(markup).not.toContain('do not hold the edit-settings permission');
  });
});

describe('where the value came from is on screen, because this screen writes only one layer', () => {
  it('labels a value resolved from the organization', () => {
    expect(render()).toContain('From the organization');
  });

  it('warns when the displayed value is the caller’s own and an org write will not change it', () => {
    const markup = render({
      resolved: RESOLVED.map((entry) =>
        entry.key === SettingKeys.NotificationsEmailEnabled
          ? { ...entry, resolvedFrom: 'user' as const }
          : entry,
      ),
    });
    expect(markup).toContain('From your own level');
    expect(markup).toContain('Saving here changes the organization value');
  });

  it('does not warn when nothing shadows the organization value', () => {
    expect(render()).not.toContain('Saving here changes the organization value');
  });

  it('shows which scopes a setting may be set at', () => {
    const markup = render();
    expect(markup).toContain('Settable: organization');
    // Only the email kill switch allows the lower two.
    expect(markup).toContain('Settable: branch');
    expect(markup).toContain('Settable: user');
  });
});

describe('accessibility', () => {
  const markup = render();

  it('gives every control a label bound by id', () => {
    const forIds = [...markup.matchAll(/<label[^>]*\bfor="([^"]+)"/g)]
      .map((match) => match[1])
      .filter((id): id is string => id !== undefined);
    const inputIds = inputs(markup)
      .map((tag) => /\bid="([^"]+)"/.exec(tag)?.[1])
      .filter((id): id is string => id !== undefined);
    // Every labelled id must belong to a real control (the search box labels itself).
    const dangling = forIds.filter((id) => !inputIds.includes(id));
    expect(dangling, 'a <label for> points at no control').toEqual([]);
    expect(forIds.length).toBeGreaterThanOrEqual(28);
  });

  it('describes every control with its registry description', () => {
    const described = inputs(markup).filter((tag) => tag.includes('aria-describedby'));
    expect(described.length).toBeGreaterThanOrEqual(29);
  });

  it('gives the owner filter an accessible name, since it has no visible label', () => {
    expect(markup).toContain('aria-label="Owner"');
  });

  // The key and the server's English description are identifiers and English prose; they stay LTR
  // inside an Arabic page rather than being mirrored into nonsense.
  it('keeps keys and English descriptions left-to-right', () => {
    const arabic = render({ locale: 'ar' });
    expect(arabic).toContain('dir="ltr"');
    expect(arabic).toContain(SettingKeys.PasswordMinLength);
  });
});

describe('both locales', () => {
  it.each(['en', 'ar'] as const)('resolves every label it asks for — %s', (locale) => {
    const markup = render({ locale });
    // `translate` falls back to the key, so a missing entry appears verbatim in the markup.
    expect(markup, 'an untranslated key reached the page').not.toContain('systemAdmin.settings.');
  });

  it('renders Arabic labels in Arabic', () => {
    const markup = render({ locale: 'ar' });
    expect(markup).toContain('إعدادات النظام');
    expect(markup).toContain('أقل طول لكلمة المرور');
    expect(markup).toContain('الدخول وكلمات المرور');
  });

  // A setting shipped before this screen learns its name keeps its place and shows its key.
  it('falls back to the key for a setting with no label yet', () => {
    const markup = render({
      definitions: [
        {
          key: 'auth.brandNew',
          description: 'no label yet',
          type: 'number',
          defaultValue: 1,
          allowedScopes: ['organization'],
        },
      ],
      resolved: [],
    });
    expect(markup).toContain('auth.brandNew');
    expect(markup).not.toContain('systemAdmin.settings.keys.auth.brandNew');
  });
});

describe('the filters are addressable', () => {
  it('reads the search term from the URL rather than component state', () => {
    const markup = render({ search: '?q=lockout' });
    expect(markup).toContain(SettingKeys.LockoutMaxAttempts);
    expect(markup).not.toContain(SettingKeys.PasswordMinLength);
    expect(markup).toContain('Showing 2 of 29');
  });

  it('reads the owner filter from the URL', () => {
    const markup = render({ search: '?owner=fleet' });
    expect(markup).toContain(FleetSettingKeys.AlarmRedKm);
    expect(markup).not.toContain(SettingKeys.PasswordMinLength);
    expect(markup).toContain('Showing 5 of 29');
  });

  it('says so plainly when the filters match nothing', () => {
    const markup = render({ search: '?q=nothingmatchesthis' });
    expect(markup).toContain('No setting matches this view.');
  });
});
