// The persistence contract, checked against the source.
//
// `useRememberedFilters` only remembers what a screen DECLARES, which is the property that makes it
// safe — and the same property that lets it rot silently. Add a filter to a screen and forget its
// name here and nothing breaks: the filter works, the screen works, and it is the one filter that
// quietly stops being remembered. No runtime test can see that, because both versions run.
//
// So the invariant is structural, and it is TOTALITY: every query param a screen reads is either
// remembered or named as deliberately excluded. There is no third state, and a param that appears
// without a decision fails this test.
//
// The three named exclusions each have a reason that is not "it looked unimportant":
//
//   • `code` on the vehicle registry — the legacy param the URL migration consumes and deletes.
//     Remembering it would resurrect a parameter the app has already moved off.
//   • `date` on fleet attendance — the day being viewed, not a filter of it. Restoring it shows a
//     stale day, which is worse than showing today.
//   • `actorUserId` and `moduleId` on the audit log — read by `readAuditFilters` but rendered by no
//     control on the page. A remembered filter nobody can see or clear is a trap, and the absence
//     of a control is the evidence. THE GENERAL RULE: a param a screen cannot clear is never kept.
//
// `page` is excluded everywhere and needs no per-screen entry: it is derived, not chosen, and every
// screen's own `patch()` already drops it whenever a filter changes.
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '../../');
const text = (rel: string): string => readFileSync(join(SRC, rel), 'utf8');

/** Every screen that remembers its filters, with the params it deliberately does NOT remember. */
const OPTED_IN: readonly (readonly [string, readonly string[]])[] = [
  ['modules/fleet/pages/AccidentsPage.tsx', []],
  ['modules/fleet/pages/AttendancePage.tsx', ['date']],
  ['modules/fleet/pages/DriversListPage.tsx', []],
  ['modules/fleet/pages/FixedRosterPage.tsx', []],
  ['modules/fleet/pages/MaintenanceAlarmsPage.tsx', []],
  ['modules/fleet/pages/MaintenancePage.tsx', []],
  ['modules/fleet/pages/OdometerPage.tsx', []],
  ['modules/fleet/pages/VehiclesListPage.tsx', ['code']],
  ['modules/fleet/pages/ViolationsPage.tsx', []],
  ['modules/gold/pages/GoldBarsPage.tsx', []],
  ['modules/gold/pages/GoldCompaniesPage.tsx', []],
  ['modules/gold/pages/GoldDeliveryPage.tsx', []],
  ['modules/gold/pages/GoldKeysPage.tsx', []],
  ['modules/gold/pages/GoldPortalAccountsPage.tsx', []],
  ['modules/gold/pages/GoldReceivingPage.tsx', []],
  ['modules/gold/pages/GoldRepresentativesPage.tsx', []],
  ['modules/gold/pages/GoldTransfersPage.tsx', []],
  ['modules/hr/contracts/pages/ContractsListPage.tsx', []],
  ['modules/hr/employee-management/employee-files/pages/EmployeeFilesListPage.tsx', []],
  ['modules/hr/employee-management/employees/pages/EmployeesListPage.tsx', []],
  ['modules/hr/employee-management/employees/pages/EmployeesReadyPage.tsx', []],
  ['modules/hr/leave-management/pages/AllRequestsPage.tsx', []],
  ['modules/hr/recruitment/applicants/pages/ApplicantsListPage.tsx', []],
  ['modules/hr/recruitment/evaluations/pages/EvaluationPhaseQueuePage.tsx', []],
  ['modules/hr/recruitment/evaluations/pages/EvaluationQueuePage.tsx', []],
  ['modules/hr/recruitment/hiring-documents/pages/HiringDocsListPage.tsx', []],
  ['modules/hr/recruitment/interviews/pages/InterviewQueuePage.tsx', []],
  ['modules/hr/recruitment/interviews/pages/InterviewStageQueuePage.tsx', []],
  ['modules/hr/recruitment/job-offers/pages/JobOffersListPage.tsx', []],
  ['modules/hr/recruitment/screening/pages/ScreeningQueuePage.tsx', []],
  ['modules/it/pages/AssetsListPage.tsx', []],
  ['modules/it/pages/CustodyPage.tsx', []],
  ['modules/it/pages/HelpDeskSettingsPage.tsx', []],
  ['modules/it/pages/MaintenanceOrdersPage.tsx', []],
  ['modules/it/pages/TicketsListPage.tsx', []],
  ['modules/it/pages/VendorsPage.tsx', []],
  ['modules/system-admin/audit/pages/ActivityLogPage.tsx', []],
  ['modules/system-admin/audit/pages/AuditLogPage.tsx', ['actorUserId', 'moduleId']],
  ['modules/system-admin/notification-templates/pages/TemplatesListPage.tsx', []],
  ['modules/system-admin/roles/pages/PermissionCatalogPage.tsx', []],
  ['modules/system-admin/roles/pages/RolesListPage.tsx', []],
  ['modules/system-admin/settings/pages/SettingsPage.tsx', []],
  ['modules/system-admin/users/pages/UsersListPage.tsx', []],
];

/**
 * Screens that own URL state and a filter bar and STILL must not remember, each for a reason the
 * mechanism cannot infer. Listed so that adding the hook to one of them fails rather than passes.
 */
const OPTED_OUT: readonly (readonly [string, string])[] = [
  ['modules/atm/pages/DataEditPage.tsx', '`tab` is a role="tab" strip, not a filter'],
  ['modules/fleet/pages/CatalogsPage.tsx', '`kind` is a role="tab" strip, not a filter'],
  ['modules/it/pages/ItCatalogsPage.tsx', '`kind` is a role="tab" strip, not a filter'],
  ['modules/operations/pages/DailyOperationsPage.tsx', 'its filters are local state; `date` is what the board IS'],
  ['modules/system-admin/roles/components/UserEffectivePermissionsTab.tsx', 'a tab inside a :id detail route'],
];

/**
 * The audit screens read their filters through a shared helper rather than inline, and the two
 * readers live in ONE file — so following the import wholesale would credit the activity log with
 * the audit log's params. Only the body of the function a screen actually calls is scanned.
 */
const viaHelper = (src: string): string => {
  const call = /read(\w*)Filters\(/.exec(src);
  const from = /import \{[^}]*read\w*Filters[^}]*\} from '([^']+)'/.exec(src);
  if (call === null || from === null) return '';
  const helper = readFileSync(join(SRC, `${(from[1] as string).replace(/^\.\.\//, 'modules/system-admin/audit/')}.ts`), 'utf8');
  const body = new RegExp(`export const read${call[1] as string}Filters =[\\s\\S]*?\\n};`).exec(helper);
  return body === null ? '' : body[0];
};

/** Params a screen reads, however it reads them — directly, through `readList`, or by writing one. */
const paramsRead = (pageSrc: string): Set<string> => {
  const src = `${pageSrc}\n${viaHelper(pageSrc)}`;
  const found = new Set<string>();
  const add = (re: RegExp): void => {
    for (const m of src.matchAll(re)) if (m[1] !== undefined) found.add(m[1]);
  };
  add(/(?:sp|params|searchParams)\.get\('([^']+)'\)/g);
  add(/readList\(\s*\w+\s*,\s*'([^']+)'\)/g);
  add(/(?:trimmed|dateFrom)\(params, '([^']+)'\)/g);
  add(/(?:next|sp)\.(?:set|delete)\('([^']+)'/g);
  for (const block of src.matchAll(/patch\(\{([^}]*)\}/gs)) {
    for (const m of (block[1] ?? '').matchAll(/(\w+):/g)) found.add(m[1] as string);
  }
  return found;
};

/** What a screen declared, read out of its own `REMEMBERED_FILTERS`. */
const declared = (src: string): string[] => {
  const block = /const REMEMBERED_FILTERS = \[([^\]]*)\] as const;/.exec(src);
  return block === null ? [] : [...(block[1] ?? '').matchAll(/'([^']+)'/g)].map((m) => m[1] as string);
};

describe('every screen that remembers its filters declares what it remembers', () => {
  it('covers all 43 opted-in screens', () => {
    expect(OPTED_IN).toHaveLength(43);
    const missing = OPTED_IN.filter(([path]) => !text(path).includes('useRememberedFilters('));
    expect(missing.map(([path]) => path)).toEqual([]);
  });

  it.each(OPTED_IN.map(([path, excluded]) => ({ path, excluded })))(
    'leaves no param undecided in $path',
    ({ path, excluded }) => {
      const src = text(path);
      const kept = declared(src);
      expect(kept.length, `${path} declares no REMEMBERED_FILTERS`).toBeGreaterThan(0);
      // TOTALITY: read ⊆ remembered ∪ excluded ∪ {page}.
      const decided = new Set([...kept, ...excluded, 'page']);
      const undecided = [...paramsRead(src)].filter((p) => !decided.has(p)).sort();
      expect(undecided).toEqual([]);
    },
  );

  it('never remembers `page`, which the app treats as derived everywhere', () => {
    const offenders = OPTED_IN.filter(([path]) => declared(text(path)).includes('page'));
    expect(offenders.map(([path]) => path)).toEqual([]);
  });

  it('excludes only params the screen actually reads — a stale exclusion is a stale decision', () => {
    const stale = OPTED_IN.flatMap(([path, excluded]) => {
      const read = paramsRead(text(path));
      return excluded.filter((p) => !read.has(p)).map((p) => `${path}: ${p}`);
    });
    expect(stale).toEqual([]);
  });

  it('keeps the deliberately excluded screens out', () => {
    const adopted = OPTED_OUT.filter(([path]) => text(path).includes('useRememberedFilters('));
    expect(adopted.map(([path, why]) => `${path} — ${why}`)).toEqual([]);
  });
});
