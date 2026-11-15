// Navigation hubs: ONE sidebar row that opens a page of tabs, each tab an existing screen.
//
// «عايز الجزء اللى فالصورة دا يبقي جوا صفحة واحده أسمها إعدادات وتبقي فوق خالص». Six HR screens
// that configure the work rather than do it — the application form, the applicant sources, the
// interview and evaluation stages, announcements and the notification rules — left the sidebar and
// became the tabs of one «الإعدادات» page.
//
// WHY THIS LIVES IN THE CONTRACTS. Two sides read the same list and must never disagree:
//   • the API decides who sees the hub's sidebar row — anybody holding ANY tab's permission;
//   • the web draws one tab per permission the reader holds, and guards each tab's route by it.
// A tab added on one side only would be a row that opens onto nothing, or a tab nobody can reach.
//
// A HUB DOES NOT WIDEN ANYTHING. Each tab keeps the permission its screen always had, and the page
// shows a reader only the tabs he holds — so «any of the keys shows the row» advertises nothing
// beyond what the six separate rows used to.
//
// SHARED ROWS (Round 14) are the same "any of these keys" for ONE screen with no tabs: a page two
// kinds of reader open, each on his own grant. «تقرير البنوك» became the screen «تجميع الخزينة» was
// («خلي المحتوى بتاع تجميع خزينه ده يبقى اسمه تقرير بنوك»), and the two rows rode different grants —
// so the one row left must show to a holder of either, or the vault's readers lose a report they
// had. The route guard, the endpoint and the module home read the very same list.
//
// The keys are spelled here, as the HR hub's are, and not imported from the Operations contracts:
// the platform side must not depend on a module's (docs/01-business/module-hierarchy.md §1).

export interface NavigationHubTab {
  /** The tab's path under the hub (`/hr-settings/<key>`), and the end of its label's i18n key. */
  key: string;
  /** The permission its screen has always required — the route guard checks the same key. */
  permission: string;
  /** Tabs of one group sit together; the bar draws a divider between groups. */
  group: string;
}

export interface NavigationHub {
  /** The sidebar row's route. */
  route: string;
  tabs: readonly NavigationHubTab[];
}

/** HR «الإعدادات» — the two sidebar groups it replaced, in their order. */
export const HR_SETTINGS_HUB = {
  route: '/hr-settings',
  tabs: [
    // «إعدادات التوظيف»
    { key: 'recruitment-form', permission: 'recruitmentForm.manage', group: 'recruitment' },
    // «جمب نموزج التقديم … مسميات الوظائف لدى التامينات» — what «نموذج رقم (1)» prints for a job.
    { key: 'insurance-job-titles', permission: 'insuranceJobTitle.manage', group: 'recruitment' },
    { key: 'applicant-sources', permission: 'applicant.view', group: 'recruitment' },
    { key: 'interview-stages', permission: 'interviewStage.manage', group: 'recruitment' },
    { key: 'evaluation-phases', permission: 'evaluationPhase.manage', group: 'recruitment' },
    // «التواصل»
    { key: 'announcements', permission: 'announcement.send', group: 'communication' },
    { key: 'notification-rules', permission: 'notificationRule.view', group: 'communication' },
  ],
} as const satisfies NavigationHub;

export const NAVIGATION_HUBS: readonly NavigationHub[] = [HR_SETTINGS_HUB];

/** The keys that open a hub's row — any one of them. Empty for a route that is not a hub. */
export const hubPermissions = (route: string): readonly string[] =>
  NAVIGATION_HUBS.find((hub) => hub.route === route)?.tabs.map((tab) => tab.permission) ?? [];

/** One screen, one sidebar row, opened by any of several grants (see SHARED ROWS above). */
export interface SharedNavigationRow {
  route: string;
  /** Any one opens the row. The stored row's own key should be one of them. */
  permissions: readonly string[];
}

/**
 * Who may read «تقرير البنوك» (`/operations/reports/banks`): whoever could open either screen it
 * replaces — «تقرير البنوك» rode `operationsShipment.view`, «تجميع الخزينة» rode
 * `operationsVault.view` — so neither reader loses the report. ONE list for the four places that
 * check it: `authorizeAny` on the endpoint, the route guard's `anyOf`, the module home's card, and
 * the sidebar row (below). A tuple, so `authorizeAny(...keys)` sees at least one key.
 */
export const OPERATIONS_BANK_REPORT_KEYS = Object.freeze([
  'operationsShipment.view',
  'operationsVault.view',
] as const);

export const SHARED_NAVIGATION_ROWS: readonly SharedNavigationRow[] = [
  // «تقرير البنوك» — the shipments' readers and the vault's alike (`OPERATIONS_BANK_REPORT_KEYS`).
  { route: '/operations/reports/banks', permissions: OPERATIONS_BANK_REPORT_KEYS },
];

/**
 * Every key that opens a row BESIDES the one stored on it: a hub's tab keys, or a shared row's
 * keys. Empty for an ordinary row. This is what the sidebar's resolver consults.
 */
export const navigationRowKeys = (route: string): readonly string[] => [
  ...hubPermissions(route),
  ...(SHARED_NAVIGATION_ROWS.find((row) => row.route === route)?.permissions ?? []),
];
