// Where each setting lives on the screen: its department, the section inside it, and — for the few
// whose value is a structure this screen cannot edit well — the screen that does edit it.
//
// «عايز أخليهم بالعربي وأظبطهم بالإنجليزي بردو … وتقسم الحاجات طبقاً للإدارات أو General». The
// registry groups nothing: a key is a string, and the first segment of `contracts.numberFormat` or
// `operations.crewDepartmentIds` says which code declared it, not which department an administrator
// looks under. So the placement is written down here, by key prefix, and the page groups by it.
//
// A key no rule matches is never dropped: under a department this file knows it goes to that
// department's «more» section, and under one it does not, to Other.

export const SETTING_DEPARTMENTS = [
  'general',
  'hr',
  'fleet',
  'operations',
  'atm',
  'it',
  'other',
] as const;
export type SettingDepartment = (typeof SETTING_DEPARTMENTS)[number];

/** Each department's sections, in the order the screen shows them. `more` catches the unplaced. */
export const SETTING_SECTIONS: Record<SettingDepartment, readonly string[]> = {
  general: ['signIn', 'audit', 'notifications', 'featureFlags', 'more'],
  hr: ['attendance', 'leave', 'contracts', 'more'],
  fleet: ['maintenance', 'licences', 'vehicles', 'fuelPrices', 'fuelCards', 'reports', 'more'],
  operations: ['crew', 'more'],
  atm: ['maintenance', 'mail', 'register', 'more'],
  it: ['helpdesk', 'assets', 'more'],
  other: ['more'],
};

export interface SettingPlacement {
  department: SettingDepartment;
  section: string;
}

/**
 * Key prefix → placement. The longest matching prefix wins, so a rule for one key can sit beside a
 * rule for its whole namespace. A prefix ending in '.' is a namespace; one without is an exact key.
 */
export const PLACEMENTS: ReadonlyArray<readonly [string, SettingDepartment, string]> = [
  ['auth.', 'general', 'signIn'],
  ['audit.', 'general', 'audit'],
  ['notifications.', 'general', 'notifications'],
  ['flag.', 'general', 'featureFlags'],

  ['hr.attendance.', 'hr', 'attendance'],
  ['hr.workCalendar.', 'hr', 'leave'],
  ['hr.leave.', 'hr', 'leave'],
  // The contracts module is HR's, though its keys predate the `hr.` namespace.
  ['contracts.', 'hr', 'contracts'],

  ['fleet.alarm.', 'fleet', 'maintenance'],
  ['fleet.odometer.', 'fleet', 'maintenance'],
  ['fleet.license.', 'fleet', 'licences'],
  ['fleet.roster.', 'fleet', 'licences'],
  ['fleet.vehicle.', 'fleet', 'vehicles'],
  ['fleet.availability.', 'fleet', 'vehicles'],
  ['fleet.fuel.price.', 'fleet', 'fuelPrices'],
  ['fleet.fuelCard.', 'fleet', 'fuelCards'],
  ['fleet.report.', 'fleet', 'reports'],

  ['operations.', 'operations', 'crew'],

  ['atm.maintenanceLeaderDepartmentIds', 'atm', 'maintenance'],
  ['atm.mail.', 'atm', 'mail'],
  ['atm.register.', 'atm', 'register'],
  ['atm.settlements.', 'atm', 'register'],
  ['atm.branchLinks', 'atm', 'register'],

  ['it.sla.', 'it', 'helpdesk'],
  ['it.ticket.', 'it', 'helpdesk'],
  ['it.technicianDepartmentIds', 'it', 'helpdesk'],
  ['it.maintenance.', 'it', 'assets'],
  ['it.warranty.', 'it', 'assets'],
  ['it.license.', 'it', 'assets'],
];

const matches = (key: string, prefix: string): boolean =>
  prefix.endsWith('.') ? key.startsWith(prefix) : key === prefix;

/** The department a key's first segment names, when no finer rule placed it. */
const DEPARTMENT_OF_SEGMENT: Record<string, SettingDepartment> = {
  auth: 'general',
  audit: 'general',
  notifications: 'general',
  flag: 'general',
  hr: 'hr',
  contracts: 'hr',
  fleet: 'fleet',
  operations: 'operations',
  atm: 'atm',
  it: 'it',
};

export const placementOf = (key: string): SettingPlacement => {
  let best: (typeof PLACEMENTS)[number] | null = null;
  for (const rule of PLACEMENTS) {
    if (matches(key, rule[0]) && (best === null || rule[0].length > best[0].length)) best = rule;
  }
  if (best !== null) {
    // A rule naming a section its department does not list would hide its rows: «more» takes them.
    const listed = SETTING_SECTIONS[best[1]].includes(best[2]);
    return { department: best[1], section: listed ? best[2] : 'more' };
  }
  const segment = key.split('.')[0] ?? '';
  return { department: DEPARTMENT_OF_SEGMENT[segment] ?? 'other', section: 'more' };
};

/** Where a structured setting is edited, by the i18n key of that screen's own title. */
export interface ManagedElsewhere {
  route: string;
  screen: string;
  /**
   * The screen edits what this value stands BEHIND, not the value itself. The row then lists what
   * the value holds and can clear it — otherwise nothing anywhere could — instead of promising an
   * edit on a screen that never writes it.
   */
  fallback?: true;
}

/**
 * Settings whose value is a structure — a list of record ids, or rows pairing a branch with a
 * category — that has its own screen, where it is edited with names and pickers instead of raw ids.
 * Here such a row says how many entries are set and links there, rather than printing ids.
 *
 * `screen` is the i18n key of that screen's own title, so the link always reads as the screen does.
 */
export const MANAGED_ELSEWHERE: Readonly<Record<string, ManagedElsewhere>> = {
  'atm.maintenanceLeaderDepartmentIds': { route: '/atm/settings', screen: 'atm.settings.title' },
  // A fallback, and ATM Settings never writes it: each branch's category is set there, on its
  // mailbox row, and this list answers only for a branch with none.
  'atm.mail.branchCategories': {
    route: '/atm/settings',
    screen: 'atm.settings.title',
    fallback: true,
  },
  'atm.branchLinks': { route: '/atm/settings', screen: 'atm.settings.title' },
  'atm.display': { route: '/atm/settings', screen: 'atm.settings.title' },
  'atm.register.branchCodes': { route: '/atm/register/import', screen: 'atm.registerImport.title' },
  'it.technicianDepartmentIds': {
    route: '/it/helpdesk-settings',
    screen: 'it.nav.helpDeskSettings',
  },
  // Round 14 — «إدارات العمليات» left «كشف الأطقم» for a screen of its own («شاشة لوحدها في
  // القائمة»), so the row links there; the roster no longer carries the picker.
  'operations.crewDepartmentIds': {
    route: '/operations/crew-departments',
    screen: 'operations.crew.departments.title',
  },
};

/**
 * Still declared so a stored value keeps validating, but read by nothing: changing it changes
 * nothing. Shown — never hidden — and marked, so nobody spends an afternoon tuning it.
 */
export const RETIRED_SETTINGS: ReadonlySet<string> = new Set(['atm.register.bankLabels']);

/** The i18n key of a setting's user-facing description (both locales). */
export const settingDescriptionKey = (key: string): string =>
  `systemAdmin.settings.descriptions.${key}`;

/**
 * Pattern tokens a description quotes as the administrator must type them. The dictionary cannot
 * hold `{year}` itself — `translate()` fills only `{{name}}`, and a single-brace word there is
 * refused as a broken placeholder — so a description names the token and it is filled in here.
 */
export const DESCRIPTION_TOKENS: Readonly<Record<string, string>> = {
  yearToken: '{year}',
  seqToken: '{seq}',
  seqPaddedToken: '{seq:6}',
};
