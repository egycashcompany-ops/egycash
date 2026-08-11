// The rules behind the settings screen, tested where they live.
//
// The invariant that matters most is the dull one: **nothing is ever dropped**. A settings screen
// that quietly omits a key is worse than no screen at all — the value is still in force, still
// unreachable, and now there is a page that implies otherwise. Every filter and grouping case below
// exists to pin that a definition survives the trip to the screen even when this file does not
// recognise its owner, its type, or its name.
import { describe, expect, it } from 'vitest';
import {
  SETTING_SCOPES,
  type Locale,
  type ResolvedSettingDto,
  type SettingDefinitionDto,
} from '@ecms/contracts';
import { translate } from '../../../../platform/localization/i18n';
import {
  KNOWN_OWNERS,
  OTHER_OWNER,
  PARSE_FAILURES,
  ROW_EDITABILITIES,
  buildSettingGroups,
  editorFor,
  filterSettingGroups,
  listElementKind,
  ownerOf,
  parseValue,
  rowEditability,
  serializeValue,
  settingLabelKey,
  type SettingRowModel,
} from './settings-view';

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
  owner: 'auth',
  definition: define('auth.password.minLength', 'number', 10),
  resolved: resolve('auth.password.minLength', 12, 'organization'),
  editor: 'number',
  shadowed: false,
  ...over,
});

describe('ownerOf — the first segment IS the owner', () => {
  it.each([
    ['auth.password.minLength', 'auth'],
    ['audit.export.maxRows', 'audit'],
    ['notifications.email.enabled', 'notifications'],
    ['contracts.numberFormat', 'contracts'],
    ['hr.leave.approvalReminderDays', 'hr'],
    ['fleet.alarm.redKm', 'fleet'],
    ['it.sla.atRiskPercent', 'it'],
  ])('%s → %s', (key, owner) => {
    expect(ownerOf(key)).toBe(owner);
  });

  // Feature flags declare as `flag.<key>` at boot. The catalog is empty today, which is exactly
  // why this is asserted now: the first flag would otherwise land under Other on the day it ships.
  it('knows the feature-flag namespace even though no flag exists yet', () => {
    expect(ownerOf('flag.hr.ocrIntake')).toBe('flag');
  });

  it('sends an owner it does not know to Other rather than losing it', () => {
    expect(ownerOf('warehouse.reorderPoint')).toBe(OTHER_OWNER);
    expect(ownerOf('noDotsAtAll')).toBe(OTHER_OWNER);
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
    define('warehouse.reorderPoint', 'number', 5),
  ];

  it('groups by owner and orders owners the way the screen shows them', () => {
    const groups = buildSettingGroups(definitions, []);
    expect(groups.map((g) => g.owner)).toEqual(['auth', 'it', OTHER_OWNER]);
  });

  it('sorts rows inside a group by key, so two loads render identically', () => {
    const groups = buildSettingGroups(definitions, []);
    expect(groups[0]?.rows.map((r) => r.key)).toEqual([
      'auth.lockout.minutes',
      'auth.password.minLength',
    ]);
  });

  // The invariant. Definitions in, the same number of rows out — whatever this file made of them.
  it('never drops a definition', () => {
    const groups = buildSettingGroups(definitions, []);
    const rows = groups.flatMap((g) => g.rows);
    expect(rows).toHaveLength(definitions.length);
    expect(rows.map((r) => r.key).sort()).toEqual(definitions.map((d) => d.key).sort());
  });

  it('attaches the resolved value, and leaves it null while the values are in flight', () => {
    const groups = buildSettingGroups(definitions, [
      resolve('auth.password.minLength', 14, 'organization'),
    ]);
    const rows = Object.fromEntries(groups.flatMap((g) => g.rows).map((r) => [r.key, r]));
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
    expect(groups[0]?.rows[0]?.shadowed).toBe(shadowed);
  });

  it('lists every known owner it is given, in the declared order', () => {
    const all = KNOWN_OWNERS.map((owner) => define(`${owner}.something`, 'boolean', true));
    expect(buildSettingGroups(all, []).map((g) => g.owner)).toEqual([...KNOWN_OWNERS]);
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
  const labelOf = (key: string): string => labels[key] ?? key;

  it('returns everything when nothing is filtered', () => {
    expect(filterSettingGroups(groups, '', '', labelOf).flatMap((g) => g.rows)).toHaveLength(3);
  });

  it('matches the key', () => {
    const found = filterSettingGroups(groups, 'lockout', '', labelOf).flatMap((g) => g.rows);
    expect(found.map((r) => r.key)).toEqual(['auth.lockout.minutes']);
  });

  // The search box is the only way through twenty-nine rows, and half the users type Arabic.
  it('matches the translated label, not only the key', () => {
    const found = filterSettingGroups(groups, 'كلمة المرور', '', labelOf).flatMap((g) => g.rows);
    expect(found.map((r) => r.key)).toEqual(['auth.password.minLength']);
  });

  it('matches the English description the server sends', () => {
    const found = filterSettingGroups(groups, 'description of it.sla', '', labelOf);
    expect(found.flatMap((g) => g.rows).map((r) => r.key)).toEqual(['it.sla.atRiskPercent']);
  });

  it('is case-insensitive and ignores surrounding space', () => {
    expect(filterSettingGroups(groups, '  LOCKOUT  ', '', labelOf).flatMap((g) => g.rows))
      .toHaveLength(1);
  });

  it('filters by owner', () => {
    const found = filterSettingGroups(groups, '', 'it', labelOf);
    expect(found).toHaveLength(1);
    expect(found[0]?.owner).toBe('it');
  });

  it('drops a group that loses every row, and keeps one that does not', () => {
    const found = filterSettingGroups(groups, 'password', '', labelOf);
    expect(found.map((g) => g.owner)).toEqual(['auth']);
    expect(found[0]?.rows).toHaveLength(1);
  });

  it('returns nothing when the two filters disagree', () => {
    expect(filterSettingGroups(groups, 'password', 'it', labelOf)).toEqual([]);
  });
});

describe('rowEditability — four different answers, never one silent disabled control', () => {
  it('is editable for a normal row held by an actor who may edit', () => {
    expect(rowEditability(row(), true)).toBe('editable');
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

    it(`owner names, including Other — ${locale}`, () => {
      for (const owner of [...KNOWN_OWNERS, OTHER_OWNER]) {
        const key = `systemAdmin.settings.owners.${owner}`;
        expect(translate(locale, key), `${key} has no ${locale} label`).not.toBe(key);
      }
    });
  }
});
