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
