// The settings screen, rendered for real.
//
// **Why this file renders instead of scanning the source.** P7-C shipped a Duplicate button that no
// administrator could reach: every assertion covering it was a source scan or a pure-function test,
// each one true, and the control was unreachable in the states the page is actually in. A regex
// proving a `<Can>` wrapper sits near a label cannot see that the wrapper is nested inside a branch
// that removes it. So the claims that matter here — *all forty-five appear*, *without the edit
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
  AtmSettingKeys,
  FleetSettingKeys,
  HrAttendanceSettingKeys,
  HrContractSettingKeys,
  HrLeaveSettingKeys,
  ItSettingKeys,
  OperationsSettingKeys,
  SettingKeys,
  type Locale,
  type MeDto,
  type ResolvedSettingDto,
  type SettingDefinitionDto,
} from '@ecms/contracts';
import { translate } from '../../../../platform/localization/i18n';
import { localeSlice } from '../../../../store/localeSlice';
import { authSlice } from '../../../../store/authSlice';
import { SettingsPage } from './SettingsPage';
import {
  DESCRIPTION_TOKENS,
  MANAGED_ELSEWHERE,
  RETIRED_SETTINGS,
  placementOf,
  settingDescriptionKey,
} from '../lib/settings-catalog';
import { settingLabelKey } from '../lib/settings-view';

/**
 * The forty-five, with the type and default each is declared with in the API.
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
  [SettingKeys.PasskeysEnabled]: { type: 'boolean', defaultValue: true },
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
  [ItSettingKeys.TechnicianDepartmentIds]: { type: 'array', defaultValue: [] },
  [FleetSettingKeys.AlarmYellowKm]: { type: 'number', defaultValue: 1000 },
  [FleetSettingKeys.AlarmRedKm]: { type: 'number', defaultValue: 300 },
  [FleetSettingKeys.UseHrLeave]: { type: 'boolean', defaultValue: true },
  [FleetSettingKeys.VehicleLicenseWarnDays]: { type: 'number', defaultValue: 30 },
  [FleetSettingKeys.DriverLicenseWarnDays]: { type: 'number', defaultValue: 30 },
  [FleetSettingKeys.DefaultBranchName]: { type: 'string', defaultValue: 'المهندسين' },
  // The signature block on a printed Fleet report — six lines, editable because they are people.
  [FleetSettingKeys.ReportPreparedByTitle]: { type: 'string', defaultValue: 'القائم بالأعمال' },
  [FleetSettingKeys.ReportPreparedByName]: { type: 'string', defaultValue: 'م / محمد حسين محمد' },
  [FleetSettingKeys.ReportApprovedByTitle]: { type: 'string', defaultValue: 'مدير إدارة الحركة' },
  [FleetSettingKeys.ReportApprovedByName]: {
    type: 'string',
    defaultValue: 'عميد / إيهاب عبد السلام سليمان',
  },
  [FleetSettingKeys.ReportEndorsementNote]: {
    type: 'string',
    defaultValue: 'يُرجى المراجعة والتصديق على إجمالي المصروفات',
  },
  [FleetSettingKeys.ReportEndorsedByName]: {
    type: 'string',
    defaultValue: 'لواء أ ح / جمال أحمد أبواسماعيل - المدير العام التنفيذى - شركة ايجى كاش للحلول النقدية',
  },
  [FleetSettingKeys.FuelPricePetrol80]: { type: 'number', defaultValue: 15.75 },
  [FleetSettingKeys.FuelPricePetrol92]: { type: 'number', defaultValue: 17.25 },
  [FleetSettingKeys.FuelPricePetrol95]: { type: 'number', defaultValue: 19 },
  [FleetSettingKeys.FuelPriceDiesel]: { type: 'number', defaultValue: 15.5 },
  [FleetSettingKeys.FuelCardExpiryWarnDays]: { type: 'number', defaultValue: 30 },
  [FleetSettingKeys.FuelCardBalanceYellow]: { type: 'number', defaultValue: 300 },
  [FleetSettingKeys.FuelCardBalanceRed]: { type: 'number', defaultValue: 100 },
  [FleetSettingKeys.RosterRefuseExpiredLicence]: { type: 'boolean', defaultValue: false },
  [FleetSettingKeys.OdometerMissingReadingDays]: { type: 'number', defaultValue: 3 },
  [HrAttendanceSettingKeys.SelfPunchEnabled]: { type: 'boolean', defaultValue: false },
  [HrAttendanceSettingKeys.AutoComputeHour]: { type: 'number', defaultValue: 2 },
  [HrAttendanceSettingKeys.OvertimeRequiresApproval]: { type: 'boolean', defaultValue: true },
  [HrAttendanceSettingKeys.AbsenceNotify]: { type: 'boolean', defaultValue: true },
  [OperationsSettingKeys.CashTransferOperationIds]: { type: 'array', defaultValue: [] },
  [OperationsSettingKeys.CrewDepartmentIds]: { type: 'array', defaultValue: [] },
  // Structures of ids and rows: each has its own screen, and this one links there.
  [AtmSettingKeys.MaintenanceLeaderDepartmentIds]: { type: 'array', defaultValue: [] },
  [AtmSettingKeys.MailBranchCategories]: { type: 'array', defaultValue: [] },
  [AtmSettingKeys.RegisterBranchCodes]: { type: 'array', defaultValue: [] },
  [AtmSettingKeys.RegisterBankLabels]: { type: 'array', defaultValue: [] },
  [AtmSettingKeys.SettlementBanks]: { type: 'array', defaultValue: ['BRK'] },
  [AtmSettingKeys.BranchLinks]: { type: 'array', defaultValue: [] },
};

/** Every key the contracts declare, which is what the API registers at boot. */
const DECLARED_KEYS: string[] = [
  ...Object.values(SettingKeys),
  ...Object.values(HrAttendanceSettingKeys),
  ...Object.values(HrContractSettingKeys),
  ...Object.values(HrLeaveSettingKeys),
  ...Object.values(ItSettingKeys),
  ...Object.values(FleetSettingKeys),
  ...Object.values(OperationsSettingKeys),
  ...Object.values(AtmSettingKeys),
];

/** The settings that get a field here: every one but the retired and those edited elsewhere. */
const FIELD_KEYS = DECLARED_KEYS.filter(
  (key) => MANAGED_ELSEWHERE[key] === undefined && !RETIRED_SETTINGS.has(key),
);

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
  branchIds: [],
  employeeId: null,
  permissions: Object.fromEntries(permissions.map((key) => [key, 'organization' as const])),
  isPrivileged: false,
  flags: {},
  totpEnabled: false,
  external: null,
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
 * The department and section a key is rendered in: the last section marker before it. Position in
 * the markup is the only ordering evidence a static render carries, and it is enough.
 */
const sectionAround = (markup: string, key: string): string | null => {
  const at = markup.indexOf(`>${key}<`);
  if (at === -1) return null;
  const marker = 'data-settings-section="';
  const start = markup.lastIndexOf(marker, at);
  if (start === -1) return null;
  return markup.slice(start + marker.length, markup.indexOf('"', start + marker.length));
};

describe('the fixture tracks the real registry', () => {
  it('covers every declared setting key, and there are fifty-nine of them', () => {
    expect(DECLARED_KEYS).toHaveLength(59);
    expect(new Set(DECLARED_KEYS).size).toBe(59);
    const uncovered = DECLARED_KEYS.filter((key) => SHAPES[key] === undefined);
    expect(uncovered, 'a setting was declared without a shape in this fixture').toEqual([]);
  });
});

// The owner's complaint, pinned: «فى الـ /system/settings في عناوين كتير بالشكل دا
// atm.mail.branchCategories !! عايز أخليهم بالعربي وأظبطهم بالإنجليزي بردو». Every declared setting
// has its own title AND its own description, in both languages — a new setting without them fails
// here, not on the owner's screen.
describe('every setting is titled and described in both languages', () => {
  for (const locale of ['ar', 'en'] as const) {
    it(`titles — ${locale}`, () => {
      const untitled = DECLARED_KEYS.filter(
        (key) => translate(locale, settingLabelKey(key)) === settingLabelKey(key),
      );
      expect(untitled, `settings with no ${locale} title`).toEqual([]);
    });

    it(`descriptions — ${locale}`, () => {
      const undescribed = DECLARED_KEYS.filter(
        (key) => translate(locale, settingDescriptionKey(key)) === settingDescriptionKey(key),
      );
      expect(undescribed, `settings with no ${locale} description`).toEqual([]);
    });
  }

  it('shows no raw key as a title, in either language', () => {
    for (const locale of ['ar', 'en'] as const) {
      const markup = render({ locale });
      for (const key of DECLARED_KEYS) {
        // The key itself is printed once, small, in its own LTR span; a title made of it would be a
        // second occurrence inside the label.
        expect(markup, `${key} is titled by its key (${locale})`).not.toMatch(
          new RegExp(`font-semibold[^>]*>${key.replace(/\./g, '\\.')}<`),
        );
      }
    }
  });

  // The contract-number description quotes `{year}` and `{seq}` as they are typed. The dictionary
  // names them (a single brace there is a broken placeholder), and the row fills them in.
  it('quotes pattern tokens as they are typed, and leaves no placeholder unfilled', () => {
    for (const locale of ['ar', 'en'] as const) {
      const markup = render({ locale });
      // The description alone: the field beside it holds a pattern with the same tokens.
      const description = translate(
        locale,
        settingDescriptionKey(HrContractSettingKeys.NumberFormat),
        DESCRIPTION_TOKENS,
      );
      for (const token of ['{year}', '{seq}', '{seq:6}']) {
        expect(description, `${token} (${locale})`).toContain(token);
      }
      expect(markup, locale).toContain(`>${description}</p>`);
      expect(markup, `an unfilled placeholder (${locale})`).not.toMatch(/\{\{\w+\}?\}/);
    }
  });
});

describe('every setting reaches the screen', () => {
  const markup = render();

  // The claim the whole slice exists for. Twenty-four of these could previously be changed only by
  // editing the database.
  it('renders all fifty-nine keys', () => {
    const missing = DECLARED_KEYS.filter((key) => !markup.includes(key));
    expect(missing, 'a setting is declared but not on screen').toEqual([]);
  });

  it('renders one editable control per setting that is edited here', () => {
    // Every field + the search box. Retired settings and those edited on their own screen get no
    // field — they say why instead.
    expect(inputs(markup)).toHaveLength(FIELD_KEYS.length + 1);
  });

  it('introduces every department under «all», by its name', () => {
    for (const department of ['general', 'hr', 'fleet', 'operations', 'atm', 'it']) {
      const name = translate('en', `systemAdmin.settings.departments.${department}`).replace(
        /&/g,
        '&amp;',
      );
      // The heading opens the department's own section — the tab carries the name as well, so a
      // match anywhere on the page would prove nothing.
      expect(markup, `${department} has no heading`).toMatch(
        new RegExp(`data-settings-department="${department}"[^>]*><h2[^>]*>${name}<`),
      );
    }
  });

  // Grouping is only meaningful if a key lands under its own department and section.
  it('puts each key inside its own department and section', () => {
    for (const key of DECLARED_KEYS) {
      const { department, section } = placementOf(key);
      expect(sectionAround(markup, key), `${key} is outside its section`).toBe(`${department}.${section}`);
    }
  });

  it('links a structure edited on its own screen there, and says how much is set', () => {
    for (const [key, { route }] of Object.entries(MANAGED_ELSEWHERE)) {
      const at = markup.indexOf(`>${key}<`);
      const next = markup.indexOf('data-settings-section', at + 1);
      const row = markup.slice(at, next === -1 ? undefined : next);
      expect(row, `${key} does not link to ${route}`).toContain(`href="${route}"`);
    }
  });

  it('says how much a managed structure holds, and when it holds nothing', () => {
    const seeded = render({
      resolved: RESOLVED.map((entry) =>
        entry.key === ItSettingKeys.TechnicianDepartmentIds
          ? { ...entry, value: ['64b000000000000000000001', '64b000000000000000000002'] }
          : entry,
      ),
    });
    const rowOf = (html: string, key: string): string => {
      const at = html.indexOf(`>${key}<`);
      const next = html.indexOf('data-settings-section', at + 1);
      return html.slice(at, next === -1 ? undefined : next);
    };
    expect(rowOf(seeded, ItSettingKeys.TechnicianDepartmentIds)).toContain(
      translate('en', 'systemAdmin.settings.managed.count', { count: 2 }),
    );
    expect(rowOf(seeded, OperationsSettingKeys.CrewDepartmentIds)).toContain(
      translate('en', 'systemAdmin.settings.managed.empty'),
    );
  });

  // ATM Settings sets each branch's own category and never writes this fallback list, so the row
  // must not promise an edit there — and must keep the one way to empty it.
  describe('a fallback the linked screen never writes', () => {
    const key = AtmSettingKeys.MailBranchCategories;
    const screen = translate('en', 'atm.settings.title');
    const withEntry = RESOLVED.map((entry) =>
      entry.key === key
        ? { ...entry, value: [{ branchId: '64b000000000000000000001', category: 'Green Category' }] }
        : entry,
    );
    const rowOf = (html: string): string => {
      const at = html.indexOf(`>${key}<`);
      const next = html.indexOf('data-settings-section', at + 1);
      return html.slice(at, next === -1 ? undefined : next);
    };

    it('links on without promising an edit, and offers to clear what it holds', () => {
      const row = rowOf(render({ resolved: withEntry }));
      expect(row).toContain(translate('en', 'systemAdmin.settings.managed.goTo', { screen }));
      expect(row).not.toContain(translate('en', 'systemAdmin.settings.managed.open', { screen }));
      expect(row).toContain(translate('en', 'systemAdmin.settings.managed.clear'));
    });

    it('offers no clearing when the list is already empty, or to a reader who may not edit', () => {
      const clear = translate('en', 'systemAdmin.settings.managed.clear');
      expect(rowOf(render())).not.toContain(clear);
      expect(rowOf(render({ resolved: withEntry, permissions: ['setting.view'] }))).not.toContain(
        clear,
      );
    });
  });

  it('marks a retired setting instead of offering a field for it', () => {
    for (const key of RETIRED_SETTINGS) {
      expect(markup).toContain(key);
    }
    expect(markup).toContain(translate('en', 'systemAdmin.settings.retiredNote'));
  });

  it('shows a count of what is displayed against the total', () => {
    expect(markup).toContain('Showing 59 of 59');
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

  it('sends an unknown department to Other instead of dropping it', () => {
    const markupWithOdd = render({
      definitions: [
        {
          key: 'warehouse.reorderPoint',
          description: 'a department this screen does not know',
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
    expect(controls).toHaveLength(FIELD_KEYS.length);
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
    expect(controls).toHaveLength(FIELD_KEYS.length);
    expect(controls.filter(isDisabled)).toEqual([]);
    expect(markup).not.toContain('do not hold the edit-settings permission');
  });
});

describe('where the value came from is on screen, because this screen writes only one layer', () => {
  it('labels a value resolved from the organization', () => {
    expect(render()).toContain(translate('en', 'systemAdmin.settings.resolvedFrom.organization'));
  });

  it('warns when the displayed value is the caller’s own and an org write will not change it', () => {
    const markup = render({
      resolved: RESOLVED.map((entry) =>
        entry.key === SettingKeys.NotificationsEmailEnabled
          ? { ...entry, resolvedFrom: 'user' as const }
          : entry,
      ),
    });
    expect(markup).toContain(translate('en', 'systemAdmin.settings.resolvedFrom.user'));
    expect(markup).toContain('Saving here changes the organization value');
  });

  it('does not warn when nothing shadows the organization value', () => {
    expect(render()).not.toContain('Saving here changes the organization value');
  });

  it('shows which scopes a setting may be set at', () => {
    const markup = render();
    expect(markup).toContain('Can be set for: Organization<');
    // Only the email kill switch allows the lower two.
    expect(markup).toContain('Can be set for: Organization, Branch, User');
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

  it('describes every control with its description', () => {
    const fields = inputs(markup).filter((tag) => !tag.includes('type="search"'));
    const described = fields.filter((tag) => tag.includes('aria-describedby'));
    expect(described).toHaveLength(fields.length);
  });

  it('presents the departments as labelled tabs that say which is selected', () => {
    expect(markup).toContain('role="tablist"');
    expect(markup).toContain(`aria-label="${translate('en', 'systemAdmin.settings.departmentsLabel')}"`);
    // «All» is selected when the URL names no department.
    expect(markup).toMatch(/role="tab" aria-selected="true"[^>]*>All/);
  });

  // The key is an identifier; it stays LTR inside an Arabic page rather than being mirrored.
  it('keeps keys left-to-right, and describes in Arabic on an Arabic page', () => {
    const arabic = render({ locale: 'ar' });
    expect(arabic).toMatch(new RegExp(`dir="ltr">${SettingKeys.PasswordMinLength.replace(/\./g, '\\.')}<`));
    expect(arabic).toContain(translate('ar', settingDescriptionKey(SettingKeys.PasswordMinLength)));
    expect(arabic).not.toContain(`English description for ${SettingKeys.PasswordMinLength}`);
  });

  // A setting the catalog has not caught up with shows the registry's English description — LTR.
  it('falls back to the registry description, left-to-right, for a setting not yet described', () => {
    const arabic = render({
      locale: 'ar',
      definitions: [
        {
          key: 'auth.brandNew',
          description: 'not described yet',
          type: 'number',
          defaultValue: 1,
          allowedScopes: ['organization'],
        },
      ],
      resolved: [],
    });
    expect(arabic).toMatch(/dir="ltr">not described yet</);
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
    expect(markup).toContain(translate('ar', settingLabelKey(AtmSettingKeys.MailBranchCategories)));
    expect(markup).toContain(translate('ar', 'systemAdmin.settings.sections.general.signIn'));
    expect(markup).toContain(translate('ar', 'systemAdmin.settings.departments.general'));
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
    const markup = render({ search: '?q=auth.lockout' });
    expect(markup).toContain(SettingKeys.LockoutMaxAttempts);
    expect(markup).not.toContain(SettingKeys.PasswordMinLength);
    expect(markup).toContain('Showing 2 of 59');
  });

  it('reads the department from the URL, and selects its tab', () => {
    const markup = render({ search: '?dept=fleet' });
    expect(markup).toContain(FleetSettingKeys.AlarmRedKm);
    expect(markup).not.toContain(SettingKeys.PasswordMinLength);
    expect(markup).toContain('Showing 21 of 59');
    expect(markup).toMatch(new RegExp(`role="tab" aria-selected="true"[^>]*>${translate('en', 'systemAdmin.settings.departments.fleet')}`));
  });

  it('falls back to all for a department the screen has nothing for', () => {
    expect(render({ search: '?dept=warehouse' })).toContain('Showing 59 of 59');
    // A real department with no setting today (or a stale remembered one) is not a dead end.
    const other = render({ search: '?dept=other' });
    expect(other).toContain('Showing 59 of 59');
    expect(other).toMatch(/role="tab" aria-selected="true"[^>]*>All/);
  });

  it('says so plainly when the filters match nothing', () => {
    const markup = render({ search: '?q=nothingmatchesthis' });
    expect(markup).toContain('No setting matches this view.');
  });
});
