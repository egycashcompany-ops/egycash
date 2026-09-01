// The persistence census: every screen in the application, classified exactly once.
//
// The guard this replaces proved that the screens on a list were correct. It could not prove the
// list was the application — a page in neither the covered nor the excluded list was not a failure,
// it was invisible. So a developer could add `useSearchParams` and a `<SearchInput>` to a new list
// page and ship it with no persistence and a green suite.
//
// This one is a PARTITION. Every `*Page.tsx` in the app belongs to exactly one of four lists, and
// the union must equal what is on disk. A new page file is in none of them, so the suite fails
// until somebody decides which it is. That guarantee needs no heuristic and has no blind spot for
// new screens; the detector below is only a second opinion about the ones already classified.
//
// The four states, and what each means:
//
//   COVERED             calls `useRememberedFilters`, and every param it reads is either
//                       remembered or named here as deliberately excluded.
//   EXCLUDED            has query state a reader can change, which must NOT survive a visit.
//                       Every entry carries the reason, and every reason is a fact about the code.
//   MIGRATION_PENDING   filters a list but keeps them in local state, so there is nothing to
//                       remember yet. Empty — the twelve that were here have been migrated.
//   NOT_FILTER_CAPABLE  everything else: forms, detail pages, dashboards, wizards.
//
// `page` is excluded everywhere and needs no per-screen entry: it is derived, not chosen, and every
// screen's own `patch()` already drops it whenever a filter changes.
import { readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '../../');
const text = (rel: string): string => readFileSync(join(SRC, rel), 'utf8');

/** Every page file on disk — the census this partition must exactly cover. */
const pageFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return pageFiles(full);
    return entry.name.endsWith('Page.tsx') && !entry.name.endsWith('.spec.tsx')
      ? [relative(SRC, full)]
      : [];
  });

/** Screens that remember their filters, with the params each deliberately does NOT remember. */
const COVERED: readonly (readonly [string, readonly string[]])[] = [
  ['modules/atm/pages/DataEditPage.tsx', ['tab']],
  ['modules/atm/pages/MachinesPage.tsx', []],
  ['modules/atm/pages/MaintenancePage.tsx', []],
  ['modules/atm/pages/ReplenishmentsPage.tsx', []],
  ['modules/fleet/pages/AccidentsPage.tsx', []],
  ['modules/fleet/pages/AttendancePage.tsx', ['date']],
  ['modules/fleet/pages/CatalogsPage.tsx', ['kind']],
  ['modules/fleet/pages/DriversListPage.tsx', []],
  ['modules/fleet/pages/FixedRosterPage.tsx', []],
  ['modules/fleet/pages/MaintenanceAlarmsPage.tsx', []],
  ['modules/fleet/pages/MaintenancePage.tsx', []],
  ['modules/fleet/pages/OdometerPage.tsx', []],
  ['modules/fleet/pages/RosterPage.tsx', ['date']],
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
  ['modules/gold/portal/pages/PortalBarsPage.tsx', []],
  ['modules/gold/portal/pages/PortalReportsPage.tsx', ['tab']],
  ['modules/hr/attendance/pages/DailySheetPage.tsx', []],
  ['modules/hr/attendance/pages/RegularizationQueuePage.tsx', []],
  ['modules/hr/contracts/pages/ContractsListPage.tsx', []],
  ['modules/hr/employee-loans/pages/EmployeeLoansAdminPage.tsx', []],
  ['modules/hr/employee-management/employee-files/pages/EmployeeFilesListPage.tsx', []],
  ['modules/hr/employee-management/employees/pages/EmployeesListPage.tsx', []],
  ['modules/hr/employee-management/employees/pages/EmployeesReadyPage.tsx', []],
  ['modules/hr/leave-management/pages/AllRequestsPage.tsx', []],
  ['modules/hr/medical/pages/InsuranceCardsPage.tsx', []],
  ['modules/hr/medical/pages/MedicalProfilesPage.tsx', []],
  ['modules/hr/payroll/pages/PayItemsPage.tsx', []],
  ['modules/hr/payroll/pages/PayrollAdjustmentsPage.tsx', ['tab']],
  ['modules/hr/performance/pages/PerformanceCyclesPage.tsx', []],
  ['modules/hr/performance/pages/PerformanceReviewsPage.tsx', []],
  ['modules/hr/recruitment/applicant-documents/pages/ApplicantDocumentsQueuePage.tsx', ['tab']],
  ['modules/hr/recruitment/applicant-sources/pages/ApplicantSourcesPage.tsx', []],
  ['modules/hr/recruitment/applicants/pages/ApplicantsListPage.tsx', []],
  ['modules/hr/recruitment/evaluation-batches/pages/EvaluationBatchesPage.tsx', []],
  ['modules/hr/recruitment/evaluations/pages/EvaluationPhaseQueuePage.tsx', []],
  ['modules/hr/recruitment/evaluations/pages/EvaluationQueuePage.tsx', []],
  ['modules/hr/recruitment/hiring-documents/pages/HiringDocsListPage.tsx', []],
  ['modules/hr/recruitment/interviews/pages/InterviewQueuePage.tsx', []],
  ['modules/hr/recruitment/interviews/pages/InterviewStageQueuePage.tsx', []],
  ['modules/hr/recruitment/job-offers/pages/JobOffersListPage.tsx', []],
  ['modules/hr/recruitment/screening/pages/ScreeningQueuePage.tsx', []],
  ['modules/hr/training/pages/TrainingCoursesPage.tsx', []],
  ['modules/hr/training/pages/TrainingNominationsPage.tsx', []],
  ['modules/hr/training/pages/TrainingRecordsPage.tsx', []],
  ['modules/hr/training/pages/TrainingSessionsPage.tsx', []],
  ['modules/it/pages/AssetsListPage.tsx', []],
  ['modules/it/pages/CustodyPage.tsx', []],
  ['modules/it/pages/HelpDeskSettingsPage.tsx', []],
  ['modules/it/pages/ItCatalogsPage.tsx', ['kind']],
  ['modules/it/pages/LicensesPage.tsx', []],
  ['modules/it/pages/MaintenanceOrdersPage.tsx', []],
  ['modules/it/pages/MaintenancePlansPage.tsx', []],
  ['modules/it/pages/SoftwarePage.tsx', ['tab']],
  ['modules/it/pages/SparePartsPage.tsx', []],
  ['modules/it/pages/TicketsListPage.tsx', []],
  ['modules/it/pages/VendorsPage.tsx', []],
  ['modules/operations/pages/DailyOperationsPage.tsx', ['date']],
  ['modules/operations/pages/StandingCrewPage.tsx', []],
  ['modules/organization/application-categories/pages/ApplicationCategoriesListPage.tsx', []],
  ['modules/organization/applications/pages/ApplicationsListPage.tsx', []],
  ['modules/organization/branches/pages/BranchesListPage.tsx', []],
  ['modules/organization/cost-centers/pages/CostCentersListPage.tsx', []],
  ['modules/organization/departments/pages/DepartmentsListPage.tsx', []],
  ['modules/organization/job-titles/pages/JobTitlesListPage.tsx', []],
  ['modules/organization/sections/pages/SectionsListPage.tsx', []],
  ['modules/system-admin/audit/pages/ActivityLogPage.tsx', []],
  ['modules/system-admin/audit/pages/AuditLogPage.tsx', ['actorUserId', 'moduleId']],
  ['modules/system-admin/notification-templates/pages/TemplatesListPage.tsx', []],
  ['modules/system-admin/roles/pages/PermissionCatalogPage.tsx', []],
  ['modules/system-admin/roles/pages/RolesListPage.tsx', []],
  ['modules/system-admin/settings/pages/SettingsPage.tsx', []],
  ['modules/system-admin/users/pages/UsersListPage.tsx', []],
];

/** Screens whose query state must not survive a visit. Every reason is a fact about the code. */
const EXCLUDED: readonly (readonly [string, string])[] = [
  ['modules/atm/pages/DailyReportPage.tsx', '`date` opens on cairoToday() \u2014 the day the report IS'],
  ['modules/atm/pages/MailLogPage.tsx', '`from` opens on cairoToday() \u2014 a day of finished work, not a chosen range'],
  ['modules/atm/pages/MaintenanceDonePage.tsx', '`from` opens on cairoToday() \u2014 a day of finished work, not a chosen range'],
  ['modules/atm/pages/ReplenishmentsDonePage.tsx', '`from` opens on cairoToday() \u2014 a day of finished work, not a chosen range'],
  ['modules/operations/mobile/CaptainDayPage.tsx', '`date` is the day being driven'],
  ['modules/operations/pages/CatalogsPage.tsx', '`kind` selects which catalogue renders \u2014 navigation, not a filter'],
  ['modules/operations/pages/CrewAttendancePage.tsx', '`date` is the day being recorded'],
  ['modules/operations/pages/CrewBoardPage.tsx', '`date` resolves server-side to tomorrow \u2014 the day the board IS'],
  ['modules/operations/pages/RequirementsPage.tsx', '`date` is the day being planned'],
  ['modules/operations/pages/SecuredDispatchPage.tsx', '`date` resolves to the due day being dispatched'],
];

/**
 * Screens that filter a list from local state, so there is nothing to remember yet.
 *
 * Empty, and that is the point: it is where a screen waits when it has been found but not yet
 * migrated, so "we know about it" and "it works" stay different claims.
 */
const MIGRATION_PENDING: readonly string[] = [];

/**
 * Everything else — forms, detail pages, dashboards, wizards.
 *
 * A second element is the note left by whoever looked: it is REQUIRED for any page the detector
 * below finds filter-shaped, so "the heuristic is wrong here" has to be written down by a person
 * rather than assumed. The twelve that carry one are selects that edit a record, report windows
 * with no control on the page, and `page`-only lists.
 */
const NOT_FILTER_CAPABLE: readonly (readonly [string, string?])[] = [
  ['modules/atm/pages/AtmOverviewPage.tsx'],
  ['modules/atm/pages/MailTicketsPage.tsx'],
  ['modules/fleet/pages/DriverProfilePage.tsx'],
  ['modules/fleet/pages/FleetDashboardPage.tsx'],
  ['modules/fleet/pages/FleetSettingsPage.tsx'],
  ['modules/fleet/pages/VehicleDetailPage.tsx'],
  ['modules/gold/pages/GoldDashboardPage.tsx'],
  ['modules/gold/pages/GoldReportsPage.tsx'],
  ['modules/gold/pages/GoldVaultSettingsPage.tsx'],
  ['modules/gold/pages/GoldVaultsBoardPage.tsx'],
  ['modules/gold/portal/PortalLoginPage.tsx'],
  ['modules/gold/portal/pages/PortalDrawersPage.tsx'],
  ['modules/gold/portal/pages/PortalKeysPage.tsx'],
  ['modules/gold/portal/pages/PortalOverviewPage.tsx'],
  ['modules/gold/portal/pages/PortalReceiptsPage.tsx'],
  ['modules/gold/portal/pages/PortalRepresentativesPage.tsx'],
  ['modules/gold/portal/pages/PortalTransfersPage.tsx'],
  ['modules/hr/announcements/pages/ComposeAnnouncementPage.tsx'],
  ['modules/hr/attendance/pages/AssignmentsPage.tsx', 'its search and selects are fields of the "add assignment" dialog, reset on success'],
  ['modules/hr/attendance/pages/EmployeeMonthPage.tsx', '`month` is the month being read on one employee, on a :id route'],
  ['modules/hr/attendance/pages/MyAttendancePage.tsx'],
  ['modules/hr/attendance/pages/ShiftsPage.tsx'],
  ['modules/hr/contracts/pages/ContractCreatePage.tsx'],
  ['modules/hr/contracts/pages/ContractDetailPage.tsx', 'the select assigns a category to this contract'],
  ['modules/hr/contracts/pages/TemplateEditorPage.tsx'],
  ['modules/hr/contracts/pages/TemplatesListPage.tsx', 'the select edits one template\u2019s language'],
  ['modules/hr/contracts/pages/VerifyContractPage.tsx'],
  ['modules/hr/employee-loans/pages/MyLoansPage.tsx'],
  ['modules/hr/employee-management/employee-files/pages/EmployeeFileDetailPage.tsx'],
  ['modules/hr/employee-management/employees/pages/DirectRegisterPage.tsx'],
  ['modules/hr/employee-management/employees/pages/EmployeeCreatePage.tsx'],
  ['modules/hr/employee-management/employees/pages/EmployeeProfilePage.tsx'],
  ['modules/hr/leave-management/pages/ApprovalsInboxPage.tsx'],
  ['modules/hr/leave-management/pages/HolidaysPage.tsx'],
  ['modules/hr/leave-management/pages/LeaveRequestDetailPage.tsx'],
  ['modules/hr/leave-management/pages/LeaveTypesPage.tsx', 'the selects are fields of the leave-type form'],
  ['modules/hr/leave-management/pages/MyLeavePage.tsx'],
  ['modules/hr/leave-management/pages/TeamCalendarPage.tsx'],
  ['modules/hr/medical/pages/MyMedicalPage.tsx'],
  ['modules/hr/notification-rules/pages/NotificationRulesPage.tsx'],
  ['modules/hr/payroll/pages/MyAdjustmentsPage.tsx'],
  ['modules/hr/payroll/pages/MyPayslipsPage.tsx'],
  ['modules/hr/payroll/pages/PayrollReportsPage.tsx'],
  ['modules/hr/payroll/pages/PayrollRunsPage.tsx'],
  ['modules/hr/performance/pages/MyPerformancePage.tsx'],
  ['modules/hr/recruitment/applicant-portal/ApplicantPortalLoginPage.tsx'],
  ['modules/hr/recruitment/applicant-portal/pages/ApplicantPortalPage.tsx'],
  ['modules/hr/recruitment/applicants/pages/ApplicantDetailPage.tsx'],
  ['modules/hr/recruitment/applicants/pages/ApplicantFormPage.tsx'],
  ['modules/hr/recruitment/evaluation-batches/pages/EvaluationBatchDetailPage.tsx', 'the select records a grade'],
  ['modules/hr/recruitment/evaluations/pages/EvaluationDetailPage.tsx', 'the select records a decision'],
  ['modules/hr/recruitment/evaluations/pages/EvaluationPhasesPage.tsx'],
  ['modules/hr/recruitment/hiring-documents/pages/HiringDocsDetailPage.tsx'],
  ['modules/hr/recruitment/interviews/pages/InterviewDetailPage.tsx'],
  ['modules/hr/recruitment/interviews/pages/InterviewStagesPage.tsx'],
  ['modules/hr/recruitment/job-offers/pages/JobOfferDetailPage.tsx'],
  ['modules/hr/recruitment/job-offers/pages/JobOfferFormPage.tsx'],
  ['modules/hr/recruitment/job-requisitions/pages/JobRequisitionDetailPage.tsx'],
  ['modules/hr/recruitment/job-requisitions/pages/JobRequisitionsListPage.tsx'],
  ['modules/hr/recruitment/recruitment-form/pages/PublicApplyPage.tsx'],
  ['modules/hr/recruitment/recruitment-form/pages/RecruitmentFormPage.tsx'],
  ['modules/hr/recruitment/screening/pages/ScreeningDetailPage.tsx'],
  ['modules/it/pages/AssetDetailPage.tsx'],
  ['modules/it/pages/AssetScanPage.tsx'],
  ['modules/it/pages/ItHomePage.tsx'],
  ['modules/it/pages/LicenseDetailPage.tsx'],
  ['modules/it/pages/MaintenanceOrderDetailPage.tsx'],
  ['modules/it/pages/TicketDetailPage.tsx'],
  ['modules/operations/mobile/StopDetailPage.tsx'],
  ['modules/operations/pages/BankReportPage.tsx', '`from`/`to` arrive from the link; the page renders no control for them'],
  ['modules/operations/pages/CaptainReportPage.tsx', '`from`/`to` arrive from the link; the page renders no control for them'],
  ['modules/operations/pages/OperationsOverviewPage.tsx'],
  ['modules/operations/pages/SecuredBacklogPage.tsx', 'reads only `page`'],
  ['modules/operations/pages/VaultInventoryPage.tsx', 'reads only `page`'],
  ['modules/operations/pages/VaultReceivePage.tsx'],
  ['modules/operations/pages/VaultReportPage.tsx'],
  ['modules/organization/application-categories/pages/ApplicationCategoryDetailPage.tsx'],
  ['modules/organization/application-categories/pages/ApplicationCategoryFormPage.tsx'],
  ['modules/organization/application-sections/pages/OrganizeApplicationsPage.tsx'],
  ['modules/organization/applications/pages/ApplicationDetailPage.tsx'],
  ['modules/organization/applications/pages/ApplicationFormPage.tsx'],
  ['modules/organization/branches/pages/BranchDetailPage.tsx'],
  ['modules/organization/company/CompanyPage.tsx'],
  ['modules/organization/cost-centers/pages/CostCenterDetailPage.tsx'],
  ['modules/organization/cost-centers/pages/CostCenterFormPage.tsx'],
  ['modules/organization/departments/pages/DepartmentDetailPage.tsx'],
  ['modules/organization/job-titles/pages/JobTitleDetailPage.tsx'],
  ['modules/organization/job-titles/pages/JobTitleFormPage.tsx'],
  ['modules/organization/sections/pages/SectionDetailPage.tsx'],
  ['modules/organization/shared/UnitFormPage.tsx'],
  ['modules/system-admin/notification-templates/pages/TemplateDetailPage.tsx'],
  ['modules/system-admin/roles/pages/RoleDetailPage.tsx', '`tab` and `page` on one role, on a :id route'],
  ['modules/system-admin/users/pages/UserDetailPage.tsx'],
  ['platform/account/PreferencesPage.tsx'],
  ['platform/account/SecurityPage.tsx'],
  ['platform/app/pages/ForbiddenPage.tsx'],
  ['platform/app/pages/NotFoundPage.tsx'],
  ['platform/auth/ActivationPage.tsx'],
  ['platform/auth/ForcePasswordChangePage.tsx'],
  ['platform/auth/LoginPage.tsx'],
  ['platform/notifications/pages/NotificationsInboxPage.tsx'],
];

/**
 * A second opinion, never the source of truth: does this page look like it filters a list?
 *
 * It renders rows AND offers something to narrow them with. Over-flagging is harmless — it only
 * forces a decision. Under-flagging is the residual risk, and it is why the partition above, not
 * this function, is what actually holds the guarantee.
 */
const looksFilterCapable = (src: string): boolean =>
  /<DataTable\b|<Table\b|\.items\.map\(|rows=\{/.test(src) &&
  /<SearchInput\b|<FilterBar\b|<MultiSelect\b|<Select\b|sp\.get\('|readList\(/.test(src);

/** Params a screen reads, however it reads them — inline, through `readList`, or via a helper. */
const viaHelper = (src: string): string => {
  const call = /read(\w*)Filters\(/.exec(src);
  if (call === null || !/read\w*Filters[^}]*\} from '/.test(src)) return '';
  const helper = text('modules/system-admin/audit/lib/audit-filters.ts');
  const body = new RegExp(`export const read${call[1] as string}Filters =[\\s\\S]*?\\n};`).exec(
    helper,
  );
  return body === null ? '' : body[0];
};

const paramsRead = (pageSrc: string): Set<string> => {
  const src = `${pageSrc}\n${viaHelper(pageSrc)}`;
  const found = new Set<string>();
  const add = (re: RegExp): void => {
    for (const m of src.matchAll(re)) if (m[1] !== undefined) found.add(m[1]);
  };
  add(/(?:sp|params|searchParams)\.get\('([^']+)'\)/g);
  add(/readList\(\s*\w+\s*,\s*'([^']+)'\)/g);
  add(/(?:trimmed|dateFrom)\(params, '([^']+)'\)/g);
  add(/(?:next|sp|params|nextParams)\.(?:set|delete)\('([^']+)'/g);
  for (const block of src.matchAll(/patch\(\{([^}]*)\}/gs)) {
    for (const m of (block[1] ?? '').matchAll(/(\w+):/g)) found.add(m[1] as string);
  }
  return found;
};

/** What a screen declared, read out of its own `REMEMBERED_FILTERS`. */
const declared = (src: string): string[] => {
  const block = /const REMEMBERED_FILTERS = \[([^\]]*)\] as const;/.exec(src);
  return block === null
    ? []
    : [...(block[1] ?? '').matchAll(/'([^']+)'/g)].map((m) => m[1] as string);
};

describe('the persistence census covers the whole application', () => {
  const onDisk = pageFiles(SRC).sort();
  const classified = [
    ...COVERED.map(([path]) => path),
    ...EXCLUDED.map(([path]) => path),
    ...MIGRATION_PENDING,
    ...NOT_FILTER_CAPABLE.map(([path]) => path),
  ].sort();

  it('classifies every page file, and classifies nothing that is not one', () => {
    // A new filtered screen fails HERE, before any heuristic gets a say.
    expect(classified.filter((p) => !onDisk.includes(p))).toEqual([]);
    expect(onDisk.filter((p) => !classified.includes(p))).toEqual([]);
  });

  it('puts every page in exactly one state', () => {
    const seen = new Set<string>();
    const twice = classified.filter((p) => (seen.has(p) ? true : (seen.add(p), false)));
    expect(twice).toEqual([]);
  });

  it('has nothing left waiting to be migrated', () => {
    expect(MIGRATION_PENDING).toEqual([]);
  });
});

describe('every covered screen declares what it remembers', () => {
  it.each(COVERED.map(([path, excluded]) => ({ path, excluded })))(
    'leaves no param undecided in $path',
    ({ path, excluded }) => {
      const src = text(path);
      const kept = declared(src);
      expect(kept.length, `${path} declares no REMEMBERED_FILTERS`).toBeGreaterThan(0);
      // TOTALITY: read ⊆ remembered ∪ excluded ∪ {page}.
      const decided = new Set([...kept, ...excluded, 'page']);
      expect([...paramsRead(src)].filter((p) => !decided.has(p)).sort()).toEqual([]);
    },
  );

  it('never remembers `page`, which the app treats as derived everywhere', () => {
    expect(COVERED.filter(([p]) => declared(text(p)).includes('page')).map(([p]) => p)).toEqual([]);
  });

  it('excludes only params the screen actually reads — a stale exclusion is a stale decision', () => {
    const stale = COVERED.flatMap(([path, excluded]) => {
      const read = paramsRead(text(path));
      return excluded.filter((p) => !read.has(p)).map((p) => `${path}: ${p}`);
    });
    expect(stale).toEqual([]);
  });
});

describe('the excluded screens stay excluded', () => {
  it('none of them quietly adopted the hook', () => {
    const adopted = EXCLUDED.filter(([path]) => text(path).includes('useRememberedFilters('));
    expect(adopted.map(([path, why]) => `${path} — ${why}`)).toEqual([]);
  });

  it('each names a reason', () => {
    expect(EXCLUDED.filter(([, why]) => why.trim() === '').map(([p]) => p)).toEqual([]);
  });
});

describe('the detector agrees with the partition', () => {
  it('leaves no filter-shaped page unexplained', () => {
    // A second opinion on the classifications already made. It cannot see everything — some real
    // filter screens render rows without a table — which is why the partition, not this, is the
    // guarantee. What it CAN do is refuse to let a filter-shaped page sit in this list unexamined:
    // flagged and unexplained fails, and the note has to be written by whoever looked.
    const unexplained = NOT_FILTER_CAPABLE.filter(
      ([path, why]) => why === undefined && looksFilterCapable(text(path)),
    ).map(([path]) => path);
    expect(unexplained).toEqual([]);
  });

  it('keeps no note on a page it would not flag — a stale note is a stale look', () => {
    const stale = NOT_FILTER_CAPABLE.filter(
      ([path, why]) => why !== undefined && !looksFilterCapable(text(path)),
    ).map(([path]) => path);
    expect(stale).toEqual([]);
  });
});
