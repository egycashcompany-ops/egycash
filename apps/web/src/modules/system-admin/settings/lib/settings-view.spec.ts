// The rules behind the settings screen, tested where they live.
//
// The invariant that matters most is the dull one: **nothing is ever dropped**. A settings screen
// that quietly omits a key is worse than no screen at all — the value is still in force, still
// unreachable, and now there is a page that implies otherwise. Every filter and grouping case below
// exists to pin that a definition survives the trip to the screen even when this file does not
// recognise its department, its type, or its name.
import { describe, expect, it } from 'vitest';
import {
  SETTING_SCOPES,
  type Locale,
  type ResolvedSettingDto,
  type SettingDefinitionDto,
} from '@ecms/contracts';
import { translate } from '../../../../platform/localization/i18n';
import {
  PARSE_FAILURES,
  ROW_EDITABILITIES,
  buildSettingGroups,
  countRows,
  editorFor,
  filterSettingGroups,
  listElementKind,
  parseValue,
  rowEditability,
  serializeValue,
  settingLabelKey,
  type SettingRowModel,
} from './settings-view';
import {
  MANAGED_ELSEWHERE,
  PLACEMENTS,
  RETIRED_SETTINGS,
  SETTING_DEPARTMENTS,
  SETTING_SECTIONS,
  placementOf,
} from './settings-catalog';

const define = (
  key: string,
  type: string,
  defaultValue: unknown,
  allowedScopes: SettingDefinitionDto['allowedScopes'] = ['organization'],
): SettingDefinitionDto => ({
  key,
  description: `description of ${key}`,
  type,
  defaultValue,
  allowedScopes,
});

const resolve = (
  key: string,
  value: unknown,
  resolvedFrom: ResolvedSettingDto['resolvedFrom'],
): ResolvedSettingDto => ({ key, value, resolvedFrom });

const row = (over: Partial<SettingRowModel> = {}): SettingRowModel => ({
  key: 'auth.password.minLength',
  placement: { department: 'general', section: 'signIn' },
  definition: define('auth.password.minLength', 'number', 10),
  resolved: resolve('auth.password.minLength', 12, 'organization'),
  editor: 'number',
  shadowed: false,
  managedAt: null,
  retired: false,
  ...over,
});

describe('placementOf — by department, then section, not by the code that declared it', () => {
  it.each([
    ['auth.password.minLength', 'general', 'signIn'],
    ['audit.export.maxRows', 'general', 'audit'],
    ['notifications.email.enabled', 'general', 'notifications'],
    ['hr.attendance.selfPunchEnabled', 'hr', 'attendance'],
    ['hr.workCalendar.weekendDays', 'hr', 'leave'],
    ['hr.leave.approvalReminderDays', 'hr', 'leave'],
    // The contracts module is HR's, though its keys never carried the `hr.` namespace.
    ['contracts.numberFormat', 'hr', 'contracts'],
    ['fleet.alarm.redKm', 'fleet', 'maintenance'],
    ['fleet.odometer.missingReadingDays', 'fleet', 'maintenance'],
    ['fleet.license.driverWarnDays', 'fleet', 'licences'],
    ['fleet.roster.refuseExpiredLicence', 'fleet', 'licences'],
    ['fleet.vehicle.defaultBranchName', 'fleet', 'vehicles'],
    ['fleet.fuel.price.diesel', 'fleet', 'fuelPrices'],
    ['fleet.fuelCard.balanceRed', 'fleet', 'fuelCards'],
    ['fleet.report.endorsedByName', 'fleet', 'reports'],
    ['operations.crewDepartmentIds', 'operations', 'crew'],
    ['atm.maintenanceLeaderDepartmentIds', 'atm', 'maintenance'],
    ['atm.mail.branchCategories', 'atm', 'mail'],
    ['atm.register.branchCodes', 'atm', 'register'],
    ['atm.settlements.banks', 'atm', 'register'],
    ['atm.branchLinks', 'atm', 'register'],
    ['it.sla.atRiskPercent', 'it', 'helpdesk'],
    ['it.technicianDepartmentIds', 'it', 'helpdesk'],
    ['it.warranty.warnDays', 'it', 'assets'],
  ])('%s → %s / %s', (key, department, section) => {
    expect(placementOf(key)).toEqual({ department, section });
  });

  // Feature flags declare as `flag.<key>` at boot. The catalog is empty today, which is exactly
  // why this is asserted now: the first flag would otherwise land under Other on the day it ships.
  it('knows the feature-flag namespace even though no flag exists yet', () => {
    expect(placementOf('flag.hr.ocrIntake')).toEqual({ department: 'general', section: 'featureFlags' });
  });

  it('puts a new key of a known department in that department’s «more» section, not in Other', () => {
    expect(placementOf('fleet.somethingNew')).toEqual({ department: 'fleet', section: 'more' });
    expect(placementOf('atm.branchLinksArchive')).toEqual({ department: 'atm', section: 'more' });
  });

  it('sends a department it does not know to Other rather than losing it', () => {
    expect(placementOf('warehouse.reorderPoint')).toEqual({ department: 'other', section: 'more' });
    expect(placementOf('noDotsAtAll')).toEqual({ department: 'other', section: 'more' });
  });

  it('gives every department a «more» section for what no rule places', () => {
    for (const department of SETTING_DEPARTMENTS) {
      expect(SETTING_SECTIONS[department], department).toContain('more');
    }
  });

  // A rule naming a section its department does not list would place rows nowhere on screen.
  it('names, in every rule, a section its department lists', () => {
    const unlisted = PLACEMENTS.filter(
      ([, department, section]) => !SETTING_SECTIONS[department].includes(section),
    ).map(([prefix, department, section]) => `${prefix} → ${department}/${section}`);
    expect(unlisted).toEqual([]);
  });

  it('places every rule’s own keys where the rule says', () => {
    for (const [prefix, department, section] of PLACEMENTS) {
      const key = prefix.endsWith('.') ? `${prefix}example` : prefix;
      expect(placementOf(key), prefix).toEqual({ department, section });
    }
  });
});

describe('editorFor — only the four types the DTO can actually report', () => {
  it.each([
    ['boolean', 'boolean'],
    ['number', 'number'],
    ['string', 'text'],
    ['array', 'list'],
  ])('%s → %s', (type, editor) => {
    expect(editorFor(type)).toBe(editor);
  });

  // `listDefinitions` reads the Zod type NAME, so a setting declared as `z.enum(...)` or an object
  // reports something this screen has never seen. Read-only is the honest rendering: the value
  // stays visible and nobody is offered an editor that would submit the wrong shape.
  it.each(['enum', 'object', 'union', 'unknown'])('renders %s read-only rather than hiding it', (type) => {
    expect(editorFor(type)).toBe('readonly');
  });
});

describe('buildSettingGroups', () => {
  const definitions = [
    define('it.sla.atRiskPercent', 'number', 80),
    define('auth.password.minLength', 'number', 10),
    define('auth.lockout.minutes', 'number', 15),
    define('audit.export.maxRows', 'number', 50_000),
    define('contracts.numberFormat', 'string', 'CT-{year}-{seq:5}'),
    define('warehouse.reorderPoint', 'number', 5),
  ];
  const rowsOf = (groups: ReturnType<typeof buildSettingGroups>): SettingRowModel[] =>
    groups.flatMap((g) => g.sections).flatMap((s) => s.rows);

  it('groups by department and orders departments the way the screen shows them', () => {
    const groups = buildSettingGroups(definitions, []);
    expect(groups.map((g) => g.department)).toEqual(['general', 'hr', 'it', 'other']);
  });

  it('orders the sections inside a department as the catalog declares them', () => {
    const general = buildSettingGroups(definitions, [])[0];
    expect(general?.sections.map((s) => s.id)).toEqual(['signIn', 'audit']);
  });

  it('keeps the declaration order inside a section — the order the module wrote them in', () => {
    const general = buildSettingGroups(definitions, [])[0];
    expect(general?.sections[0]?.rows.map((r) => r.key)).toEqual([
      'auth.password.minLength',
      'auth.lockout.minutes',
    ]);
    // It is the order the definitions ARRIVE in (one section's keys are one file's declarations),
    // not an alphabetical one: reversed input, reversed rows.
    const shuffled = buildSettingGroups([...definitions].reverse(), [])[0];
    expect(shuffled?.sections[0]?.rows.map((r) => r.key)).toEqual([
      'auth.lockout.minutes',
      'auth.password.minLength',
    ]);
  });

  // The invariant. Definitions in, the same number of rows out — whatever this file made of them.
  it('never drops a definition', () => {
    const groups = buildSettingGroups(definitions, []);
    const rows = rowsOf(groups);
    expect(rows).toHaveLength(definitions.length);
    expect(countRows(groups)).toBe(definitions.length);
    expect(rows.map((r) => r.key).sort()).toEqual(definitions.map((d) => d.key).sort());
  });

  it('attaches the resolved value, and leaves it null while the values are in flight', () => {
    const groups = buildSettingGroups(definitions, [
      resolve('auth.password.minLength', 14, 'organization'),
    ]);
    const rows = Object.fromEntries(rowsOf(groups).map((r) => [r.key, r]));
    expect(rows['auth.password.minLength']?.resolved?.value).toBe(14);
    expect(rows['auth.lockout.minutes']?.resolved).toBeNull();
  });

  // The whole reason `resolvedFrom` is surfaced: this screen writes the organization value, and
  // these two layers win over it. Saying so is the only thing that stops a save looking broken.
  it.each([
    ['user', true],
    ['branch', true],
    ['organization', false],
    ['default', false],
  ] as const)('marks a value resolved from %s as shadowed=%s', (resolvedFrom, shadowed) => {
    const groups = buildSettingGroups(
      [define('notifications.email.enabled', 'boolean', true, ['organization', 'branch', 'user'])],
      [resolve('notifications.email.enabled', false, resolvedFrom)],
    );
    expect(rowsOf(groups)[0]?.shadowed).toBe(shadowed);
  });

  it('lists every department it is given, in the declared order', () => {
    const all = [
      define('auth.x', 'boolean', true),
      define('hr.x', 'boolean', true),
      define('fleet.x', 'boolean', true),
      define('operations.x', 'boolean', true),
      define('atm.x', 'boolean', true),
      define('it.x', 'boolean', true),
      define('warehouse.x', 'boolean', true),
    ];
    expect(buildSettingGroups(all, []).map((g) => g.department)).toEqual([...SETTING_DEPARTMENTS]);
  });

  it('marks a structure edited on its own screen, and a retired setting', () => {
    const [managedKey] = Object.keys(MANAGED_ELSEWHERE);
    const [retiredKey] = [...RETIRED_SETTINGS];
    const rows = rowsOf(
      buildSettingGroups(
        [define(managedKey ?? '', 'array', []), define(retiredKey ?? '', 'array', [])],
        [],
      ),
    );
    const byKey = Object.fromEntries(rows.map((r) => [r.key, r]));
    expect(byKey[managedKey ?? '']?.managedAt).toEqual(MANAGED_ELSEWHERE[managedKey ?? '']);
    expect(byKey[managedKey ?? '']?.retired).toBe(false);
    expect(byKey[retiredKey ?? '']?.retired).toBe(true);
    expect(byKey[retiredKey ?? '']?.managedAt).toBeNull();
  });
});

describe('filterSettingGroups', () => {
  const groups = buildSettingGroups(
    [
      define('auth.password.minLength', 'number', 10),
      define('auth.lockout.minutes', 'number', 15),
      define('it.sla.atRiskPercent', 'number', 80),
    ],
    [],
  );
  const labels: Record<string, string> = {
    'auth.password.minLength': 'أقل طول لكلمة المرور',
    'auth.lockout.minutes': 'مدة القفل',
    'it.sla.atRiskPercent': 'عتبة الخطر',
  };
  const textOf = (r: SettingRowModel): string => labels[r.key] ?? r.key;
  const keysOf = (found: ReturnType<typeof filterSettingGroups>): string[] =>
    found.flatMap((g) => g.sections).flatMap((s) => s.rows).map((r) => r.key);

  it('returns everything when nothing is filtered', () => {
    expect(keysOf(filterSettingGroups(groups, '', '', textOf))).toHaveLength(3);
  });

  it('matches the key', () => {
    expect(keysOf(filterSettingGroups(groups, 'lockout', '', textOf))).toEqual([
      'auth.lockout.minutes',
    ]);
  });

  // The search box is the only way through the rows, and half the users type Arabic.
  it('matches the text a row reads as (label and description), not only the key', () => {
    expect(keysOf(filterSettingGroups(groups, 'كلمة المرور', '', textOf))).toEqual([
      'auth.password.minLength',
    ]);
  });

  it('matches the English description the server sends', () => {
    expect(keysOf(filterSettingGroups(groups, 'description of it.sla', '', textOf))).toEqual([
      'it.sla.atRiskPercent',
    ]);
  });

  it('is case-insensitive and ignores surrounding space', () => {
    expect(keysOf(filterSettingGroups(groups, '  LOCKOUT  ', '', textOf))).toHaveLength(1);
  });

  // The app's one folding: hamza forms, ta marbuta and Arabic-Indic digits match as typed.
  it('folds Arabic as every search box in the app does', () => {
    const arabic = buildSettingGroups(
      [define('hr.leave.annualDays', 'number', 21), define('auth.lockout.minutes', 'number', 15)],
      [],
    );
    const said: Record<string, string> = {
      'hr.leave.annualDays': 'رصيد الإجازة السنوية ٢١ يومًا',
      'auth.lockout.minutes': 'مدة القفل',
    };
    const readAs = (r: SettingRowModel): string => said[r.key] ?? r.key;
    expect(keysOf(filterSettingGroups(arabic, 'الاجازه', '', readAs))).toEqual([
      'hr.leave.annualDays',
    ]);
    expect(keysOf(filterSettingGroups(arabic, '21', '', readAs))).toEqual(['hr.leave.annualDays']);
  });

  it('filters by department', () => {
    const found = filterSettingGroups(groups, '', 'it', textOf);
    expect(found.map((g) => g.department)).toEqual(['it']);
  });

  it('drops a section and a department that lose every row, and keeps ones that do not', () => {
    const found = filterSettingGroups(groups, 'password', '', textOf);
    expect(found.map((g) => g.department)).toEqual(['general']);
    expect(found[0]?.sections.map((s) => s.id)).toEqual(['signIn']);
    expect(found[0]?.sections[0]?.rows).toHaveLength(1);
  });

  it('returns nothing when the search and the department disagree', () => {
    expect(filterSettingGroups(groups, 'password', 'it', textOf)).toEqual([]);
  });
});

describe('rowEditability — different answers, never one silent disabled control', () => {
  it('is editable for a normal row held by an actor who may edit', () => {
    expect(rowEditability(row(), true)).toBe('editable');
  });

  it('offers no field for a retired setting, nor for one edited on its own screen', () => {
    expect(rowEditability(row({ retired: true }), true)).toBe('retired');
    expect(
      rowEditability(row({ managedAt: { route: '/atm/settings', screen: 'atm.settings.title' } }), true),
    ).toBe('managed-elsewhere');
    // The missing permission still comes first: it explains every row on the screen.
    expect(rowEditability(row({ retired: true }), false)).toBe('no-permission');
  });

  it('reports the missing permission first, because it explains every other control too', () => {
    expect(rowEditability(row(), false)).toBe('no-permission');
    expect(rowEditability(row({ editor: 'readonly' }), false)).toBe('no-permission');
  });

  it('refuses a type it cannot edit rather than submitting the wrong shape', () => {
    expect(rowEditability(row({ editor: 'readonly' }), true)).toBe('unsupported-type');
  });

  // This screen writes organization values only. A key that does not allow that scope would be
  // refused by `set()` with 422; refusing locally says why instead of showing the server's error.
  it('refuses a key that cannot be set at the organization level', () => {
    const notOrg = row({
      definition: define('some.userOnly', 'number', 1, ['user']),
    });
    expect(rowEditability(notOrg, true)).toBe('not-organization-scoped');
  });
});

describe('listElementKind — read from the default, because nothing else says', () => {
  it('reads numbers from a numeric default', () => {
    expect(listElementKind([5, 6])).toBe('number');
  });

  it('reads strings from a string default', () => {
    expect(listElementKind(['username', 'email'])).toBe('string');
  });

  // No evidence either way. Strings round-trip anything, and the server refuses what it must.
  it('falls back to strings when the default is empty or not a list', () => {
    expect(listElementKind([])).toBe('string');
    expect(listElementKind(null)).toBe('string');
    expect(listElementKind(7)).toBe('string');
  });

  it('does not call a mixed list numeric', () => {
    expect(listElementKind([1, 'two'])).toBe('string');
  });
});

describe('serializeValue / parseValue', () => {
  it.each([
    [true, 'boolean', 'true'],
    [false, 'boolean', 'false'],
    [10, 'number', '10'],
    ['CT-{year}-{seq:5}', 'text', 'CT-{year}-{seq:5}'],
    [[5, 6], 'list', '5, 6'],
    [['username', 'email'], 'list', 'username, email'],
  ] as const)('serializes %s as %s → %s', (value, editor, expected) => {
    expect(serializeValue(value, editor)).toBe(expected);
  });

  it('serializes a value of the wrong shape as empty rather than printing undefined', () => {
    expect(serializeValue(null, 'number')).toBe('');
    expect(serializeValue(undefined, 'text')).toBe('');
    expect(serializeValue('not a list', 'list')).toBe('');
  });

  it('shows an uneditable value as its stored JSON', () => {
    expect(serializeValue({ a: 1 }, 'readonly')).toBe('{"a":1}');
  });

  it.each([
    ['12', 'number', 10, 12],
    ['  12  ', 'number', 10, 12],
    ['-3', 'number', 10, -3],
    ['1.5', 'number', 10, 1.5],
  ] as const)('parses %s as a number', (raw, editor, fallback, expected) => {
    expect(parseValue(raw, editor, fallback)).toEqual({ ok: true, value: expected });
  });

  it.each(['', '   ', 'abc', '1,2'])('refuses %o as a number', (raw) => {
    expect(parseValue(raw, 'number', 10)).toEqual({ ok: false, reason: 'not-a-number' });
  });

  // `Number('Infinity')` is a finite-looking parse that JSON cannot carry — it serialises to null.
  it('refuses Infinity, which would reach the server as null', () => {
    expect(parseValue('Infinity', 'number', 10)).toEqual({ ok: false, reason: 'not-a-number' });
  });

  it('parses a string list, trimming and dropping empty entries', () => {
    expect(parseValue(' username , email , ', 'list', ['username'])).toEqual({
      ok: true,
      value: ['username', 'email'],
    });
  });

  it('parses a numeric list when the default says the elements are numbers', () => {
    expect(parseValue('5, 6', 'list', [5, 6])).toEqual({ ok: true, value: [5, 6] });
  });

  it('refuses a numeric list containing something that is not a number', () => {
    expect(parseValue('5, six', 'list', [5, 6])).toEqual({
      ok: false,
      reason: 'not-a-number-list',
    });
  });

  // `hr.workCalendar.weekendDays` declares `.min(0)`, so "no weekend days" is a real value.
  it('reads an empty list field as an empty list, not as an error', () => {
    expect(parseValue('', 'list', [5, 6])).toEqual({ ok: true, value: [] });
    expect(parseValue('  ,  ', 'list', ['username'])).toEqual({ ok: true, value: [] });
  });

  it('accepts any text for a string setting — the regex lives on the server', () => {
    expect(parseValue('no-seq-token', 'text', '')).toEqual({ ok: true, value: 'no-seq-token' });
  });

  it('refuses to parse a value it declined to render an editor for', () => {
    expect(parseValue('{}', 'readonly', null)).toEqual({ ok: false, reason: 'not-editable' });
  });

  it.each([
    [true, 'boolean', false],
    [10, 'number', 0],
    ['CT-{seq}', 'text', ''],
    [[5, 6], 'list', [5, 6]],
    [['username'], 'list', ['username']],
    [[], 'list', [5, 6]],
  ] as const)('round-trips %o through the input and back', (value, editor, fallback) => {
    const parsed = parseValue(serializeValue(value, editor), editor, fallback);
    expect(parsed).toEqual({ ok: true, value });
  });
});

describe('settingLabelKey', () => {
  it('namespaces the key so a catalog entry can be found for it', () => {
    expect(settingLabelKey('auth.password.minLength')).toBe(
      'systemAdmin.settings.keys.auth.password.minLength',
    );
  });
});

// The messages a first render never produces — a refusal reason and a parse failure both need a
// state the page only reaches after an interaction, and this suite has no DOM to interact with.
// Driving them from the unions means adding a reason without translating it fails here, in both
// locales, which is the same guard `status-labels.spec.ts` puts on every contracts enum.
describe('every reason this screen can give has a label in both locales', () => {
  const LOCALES: Locale[] = ['en', 'ar'];

  for (const locale of LOCALES) {
    it(`refusals — ${locale}`, () => {
      for (const reason of ROW_EDITABILITIES) {
        if (reason === 'editable') continue; // not a refusal; nothing is shown for it
        const key = `systemAdmin.settings.locked.${reason}`;
        expect(translate(locale, key), `${key} has no ${locale} label`).not.toBe(key);
      }
    });

    it(`parse failures — ${locale}`, () => {
      for (const reason of PARSE_FAILURES) {
        const key = `systemAdmin.settings.parse.${reason}`;
        expect(translate(locale, key), `${key} has no ${locale} label`).not.toBe(key);
      }
    });

    it(`value origins and scopes — ${locale}`, () => {
      for (const origin of ['user', 'branch', 'organization', 'default']) {
        const key = `systemAdmin.settings.resolvedFrom.${origin}`;
        expect(translate(locale, key), `${key} has no ${locale} label`).not.toBe(key);
      }
      for (const scope of SETTING_SCOPES) {
        const key = `systemAdmin.settings.scope.${scope}`;
        expect(translate(locale, key), `${key} has no ${locale} label`).not.toBe(key);
      }
    });

    it(`department and section names, including Other and «more» — ${locale}`, () => {
      for (const department of ['all', ...SETTING_DEPARTMENTS]) {
        const key = `systemAdmin.settings.departments.${department}`;
        expect(translate(locale, key), `${key} has no ${locale} label`).not.toBe(key);
      }
      for (const department of SETTING_DEPARTMENTS) {
        for (const section of SETTING_SECTIONS[department]) {
          const key = `systemAdmin.settings.sections.${department}.${section}`;
          expect(translate(locale, key), `${key} has no ${locale} label`).not.toBe(key);
        }
      }
    });

    it(`the screens a managed setting links to, by their own titles — ${locale}`, () => {
      for (const { screen } of Object.values(MANAGED_ELSEWHERE)) {
        expect(translate(locale, screen), `${screen} has no ${locale} label`).not.toBe(screen);
      }
    });

    it(`a managed row's own words, and the clearing of a fallback — ${locale}`, () => {
      for (const word of ['count', 'empty', 'open', 'goTo', 'clear', 'clearTitle', 'clearBody']) {
        const key = `systemAdmin.settings.managed.${word}`;
        expect(translate(locale, key), `${key} has no ${locale} label`).not.toBe(key);
      }
      const key = 'systemAdmin.settings.emptyDefault';
      expect(translate(locale, key), `${key} has no ${locale} label`).not.toBe(key);
    });
  }
});
