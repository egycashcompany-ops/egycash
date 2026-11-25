// Which query keys go stale when a topic fires (ADR-029). One registry for the whole app, so
// realtime behaviour is a platform property, not a per-screen habit — and its rows deliberately
// SAY THE SAME THING the module's own mutation `onSuccess` handlers already say: when a gold
// receiving confirm invalidates bars + drawers + vaults + dashboard + reports locally, a signal
// that someone ELSE confirmed one must reach exactly the same keys.
//
// A topic key is the api's audit vocabulary verbatim: `<moduleId>.<entityType>`. A signal whose
// topic is not listed here is simply ignored — the server publishes nothing unclassified anyway
// (its registry spec guarantees that), so an unknown topic at runtime means an older client
// against a newer api, and ignoring it degrades to today's behaviour instead of breaking.

type KeyPrefix = readonly unknown[];

/** The notification bell + inbox tree — also fed by `notification:new` pushes. */
export const NOTIFICATION_KEYS: readonly KeyPrefix[] = [['notifications']];

const goldStockSweep: readonly KeyPrefix[] = [
  ['gold', 'bars'],
  ['gold', 'drawers'],
  ['gold', 'vaults'],
  ['gold', 'dashboard'],
  ['gold', 'reports'],
];

const shipmentSweep: readonly KeyPrefix[] = [
  ['operations', 'shipments'],
  ['operations', 'dayBoard'],
  ['operations', 'myDay'],
  ['operations', 'securedBacklog'],
  ['operations', 'securedDue'],
  ['operations', 'vault'],
  ['operations', 'vaultReport'],
];

const attendanceDaySweep: readonly KeyPrefix[] = [
  ['hr', 'attendanceDays'],
  ['hr', 'attendanceMyDays'],
  // The daily sheet is a view of the same days (stage 2) — it just starts from the employees — so
  // anything that rewrites a day has to refresh it too. It was missed when the sheet arrived:
  // this registry guards that every TOPIC is mapped, not that every cache of a topic is swept.
  ['hr', 'attendanceSheet'],
  // And the decisions themselves (stage 3): approving or revoking one changes both the day and
  // the queue it was sitting in.
  ['hr', 'attendanceDecisions'],
];

/**
 * «لوحة تحكم الحركة» (D13): R1, the «الآن» tabs, and R2 while its period is still LIVE. A period
 * that ended — `past` — counts rows whose days are behind it, so only the signals of figures read AS
 * OF NOW name it: a fine's (the period's drivers' fines carry their state as of now — a tick turns
 * «قائمة» into «محصَّلة» even in «الشهر الماضي»), an accident's (the period's files carry their
 * status and money as of now — «منها N مفتوحة حتى الآن», the four money totals and each row's
 * «المتبقي (حتى الآن)» — so closing a file, a money edit or a transfer moves a past month too) and
 * a custody memo's or operation's (the period's custody spend says where it stands now — «تمت
 * الاستعاضة» / «في مذكرات لم تُستعَض» / «خارج المذكرات» — so a replenishment moves a past month
 * too). A dashboard counts over every fleet screen at once, so a busy morning would re-read it on
 * every save: these prefixes are NOT swept like the rest — the provider hands them to the platform
 * throttle (`throttle.ts`), which marks them stale at once and refetches what is on screen at most
 * once per window.
 */
const FLEET_DASHBOARD_NOW: KeyPrefix = ['fleet', 'dashboard', 'now'];
const FLEET_DASHBOARD_LIVE: KeyPrefix = ['fleet', 'dashboard', 'period', 'live'];
const FLEET_DASHBOARD_PAST: KeyPrefix = ['fleet', 'dashboard', 'period', 'past'];
/** The rows whose writes move a figure of both reads (a «الآن» count and a period total). */
const fleetDashboardBoth: readonly KeyPrefix[] = [FLEET_DASHBOARD_NOW, FLEET_DASHBOARD_LIVE];
/** The rows whose writes move only a «الآن» figure (roster, licences, notices, fuel cards). */
const fleetDashboardNow: readonly KeyPrefix[] = [FLEET_DASHBOARD_NOW];

/** Every prefix realtime refreshes through the throttle rather than the plain sweep. */
export const THROTTLED_KEY_PREFIXES: readonly KeyPrefix[] = [
  FLEET_DASHBOARD_NOW,
  FLEET_DASHBOARD_LIVE,
  FLEET_DASHBOARD_PAST,
];

/**
 * The ATM boards' topics — HEAVY reads: the whole open board, the mail pages read whole. A bulk
 * close or a long paste is a stream of these, heard by every viewer at once, so the realtime client
 * batches them in their own debounced lane (`createDebouncedCoalescer`: one refetch per burst, each
 * client at its own offset) instead of the 300 ms window. Exact topic names — the api's vocabulary.
 */
export const HEAVY_REALTIME_TOPICS: ReadonlySet<string> = new Set([
  'atm.replenishment',
  'atm.maintenance',
  'atm.mailTicket',
]);

/**
 * List kinds under a prefix that a realtime signal only MARKS STALE (`refetchType: 'none'`), never
 * refetches: the boards' filter dropdowns (`facets` — distinct names, which another desk's single
 * write almost never changes) and the done pages' ranges (`done` — whole walks of a day range). A
 * mounted one keeps what it shows until it is next read — opened again, or its range or banks
 * changed — and is read fresh then, being stale. The reader's OWN write still refreshes them at
 * once: the mutation hooks invalidate with a refetch, outside realtime.
 */
const STALE_ONLY_LISTS: readonly { prefix: KeyPrefix; kinds: readonly string[] }[] = [
  { prefix: ['atm', 'replenishments'], kinds: ['facets', 'done'] },
  { prefix: ['atm', 'maintenances'], kinds: ['facets', 'done'] },
];

/**
 * Is this query key one realtime only marks stale? Keys follow the factory's list shape —
 * `[module, feature, 'list', { kind, … }]` (`shared/lib/query-keys.ts`).
 */
export const isStaleOnlyKey = (queryKey: readonly unknown[]): boolean => {
  // The Operations shipments history (`['operations', 'dayBoard', 'history', { from, to }]`) — a
  // whole range of day boards, up to a year and five thousand shipments. It sits under the day
  // board's key so the reader's own saves refresh it at once; another desk's single write only marks
  // it stale, rather than re-reading the whole range for every viewer on every signal. Its deleted
  // shipments (`[…, 'deleted', { from, to }]`, the «المحذوفة» icon's count) are the same range read
  // over deleted rows, and follow the same rule; their dialog reads them afresh when it opens.
  if (
    queryKey[0] === 'operations' &&
    queryKey[1] === 'dayBoard' &&
    (queryKey[2] === 'history' || queryKey[2] === 'deleted')
  ) {
    return true;
  }
  const params = queryKey[3];
  if (queryKey[2] !== 'list' || typeof params !== 'object' || params === null) return false;
  const kind = (params as { kind?: unknown }).kind;
  return STALE_ONLY_LISTS.some(
    (entry) =>
      entry.prefix.every((part, index) => queryKey[index] === part) &&
      typeof kind === 'string' &&
      entry.kinds.includes(kind),
  );
};

const recruitmentPipeline: readonly KeyPrefix[] = [
  ['hr', 'applicants'],
  ['hr', 'recruitmentStageCounts'],
  ['hr', 'recruitmentTimeline'],
];

export const INVALIDATION_REGISTRY: Readonly<Record<string, readonly KeyPrefix[]>> = {
  // ── ATM ────────────────────────────────────────────────────────────────────
  // A master change moves a register row's drift badge (`masterState`), so the register listens too,
  // and an archived or renamed machine changes the map and the unlocated screen's counts.
  'atm.machine': [
    ['atm', 'machines'],
    ['atm', 'registerEntries'],
    ['atm', 'mapPoints'],
    ['atm', 'mapLocationSummary'],
    ['atm', 'cassetteLayouts'],
  ],
  // A label also feeds the data-edit dialogs' options and the register form's branch options
  // (DEC-38: register and machine saves file area labels, so another screen's save adds one).
  'atm.refLabel': [
    ['atm', 'refLabels'],
    ['atm', 'machines'],
    ['atm', 'refLabelOptions'],
    ['atm', 'registerBranchOptions'],
  ],
  // The bank catalog (DEC-35): every screen that names, orders or colours a bank — the same
  // families the catalog's own write hooks invalidate (`atm-queries.ts`).
  'atm.bank': [
    ['atm', 'banks'],
    ['atm', 'registerMeta'],
    ['atm', 'registerReport'],
    ['atm', 'refLabelOptions'],
    ['atm', 'mapPoints'],
  ],
  'atm.replenishment': [['atm', 'replenishments']],
  'atm.maintenance': [['atm', 'maintenances']],
  'atm.mailTicket': [
    ['atm', 'mailTickets'],
    ['atm', 'maintenances'],
  ],
  // The efficiency register — the same three families its own write hooks invalidate. The import
  // (`atm.registerImport`) is server-excluded: the importing screen refetches itself.
  // The summary listens too: its «بانتظار المزامنة» count compares the open entries' AP/AV text.
  'atm.registerEntry': [
    ['atm', 'registerEntries'],
    ['atm', 'registerReport'],
    ['atm', 'registerBranchOptions'],
    ['atm', 'mapLocationSummary'],
  ],
  // The machine map — the same families its own write hooks invalidate (`map-queries.ts`). The two
  // batch runs (`atm.mapLocationSync`, `atm.mapLinkResolution`) are server-excluded: the calling
  // screen refetches itself.
  'atm.mapZone': [['atm', 'mapZones']],
  'atm.machineLocation': [
    ['atm', 'mapPoints'],
    ['atm', 'mapLocationSummary'],
    ['atm', 'mapLocation'],
  ],
  // Settlements & Review → Preparation → Control & Supplies (docs/12-planning/atm-settlements-
  // phase1.md §6.11) — the families their own write hooks invalidate (`settlements-queries.ts`). A
  // layout change raises `LAYOUT_CHANGED` on plan lines, so the plan listens to it; a capture moves
  // a line's `preparationStatus`, so the plan listens to that too. The two day signals carry the
  // plan's branch, so branch-scoped Preparation and Control users hear them (DS-26). The Full list
  // import (`atm.layoutImport`) is server-excluded: the importing screen refetches itself.
  'atm.cassetteLayout': [
    ['atm', 'cassetteLayouts'],
    ['atm', 'cassetteLayout'],
    ['atm', 'settlementPlan'],
  ],
  'atm.standardLoad': [['atm', 'standardLoads']],
  'atm.settlementPlan': [['atm', 'settlementPlan']],
  'atm.planLine': [
    ['atm', 'settlementPlan'],
    ['atm', 'preparationLines'],
    ['atm', 'preparationContext'],
    ['atm', 'controlDay'],
  ],
  'atm.linePreparation': [
    ['atm', 'preparationLines'],
    ['atm', 'preparationContext'],
    ['atm', 'controlDay'],
    ['atm', 'settlementPlan'],
  ],
  'atm.preparationDay': [
    ['atm', 'preparationLines'],
    ['atm', 'preparationContext'],
  ],
  'atm.controlDay': [['atm', 'controlDay']],
  'atm.dispatchRoute': [['atm', 'controlDay']],
  'atm.routeAssignment': [['atm', 'controlDay']],
  // /atm/settings' mailbox card (`settings-queries.ts`): another administrator's save refreshes it.
  'atm.mailboxConfig': [['atm', 'mailbox']],

  // ── Gold ───────────────────────────────────────────────────────────────────
  'gold.bar': goldStockSweep,
  'gold.transfer': goldStockSweep,
  'gold.receivingReceipt': goldStockSweep,
  'gold.deliveryReceipt': goldStockSweep,
  'gold.vault': [
    ['gold', 'vaults'],
    ['gold', 'drawers'],
    ['gold', 'floors'],
    ['gold', 'keysOverview'],
    ['gold', 'dashboard'],
  ],
  'gold.floor': [
    ['gold', 'floors'],
    ['gold', 'vaults'],
    ['gold', 'drawers'],
    ['gold', 'dashboard'],
  ],
  'gold.keyHandover': [
    ['gold', 'keys'],
    ['gold', 'keysOverview'],
  ],
  'gold.company': [['gold', 'companies']],
  'gold.representative': [['gold', 'representatives']],
  'gold.portalAccount': [['gold', 'portal-accounts']],

  // ── Operations ─────────────────────────────────────────────────────────────
  'operations.shipment': shipmentSweep,
  'operations.shipmentAssignment': shipmentSweep,
  'operations.day': [
    ['operations', 'dayBoard'],
    ['operations', 'myDay'],
    ['operations', 'crewBoard'],
  ],
  'operations.crewAssignment': [
    ['operations', 'crewBoard'],
    ['operations', 'crewAttendance'],
    ['operations', 'crewDirectory'],
    ['operations', 'dayBoard'],
    ['operations', 'myDay'],
  ],
  'operations.crewRequirements': [
    ['operations', 'crewRequirements'],
    ['operations', 'crewBoard'],
  ],
  'operations.standingCrew': [
    ['operations', 'standingCrew'],
    ['operations', 'crewBoard'],
  ],
  'operations.vaultCustody': [
    ['operations', 'vault'],
    ['operations', 'vaultReport'],
    ['operations', 'securedDue'],
    ['operations', 'securedBacklog'],
    // «شاشة استلام الخزينه» (Round 8) lives under the day board's key, which only the shipment
    // topics sweep — and those need `operationsShipment.view`. A treasurer with the vault grant
    // alone hears THIS topic (`operationsVault.view`), so a colleague's receive must turn the row
    // green here too, as it emptied the old draft queue (`securedBacklog`) before.
    ['operations', 'dayBoard', 'vaultQueue'],
    // «صرف الخزينة» (Round 10) — every محصنة in the vault, under the day board's key too. A receipt
    // puts a row on it, a cancelled receipt (`operations.custody.receiptCancelled`) or a release takes
    // one off: all the vault's own topic, which is all a vault-only treasurer hears.
    ['operations', 'dayBoard', 'securedDispatch'],
    // «تسليم المحصنات» (Round 12) reads the distribution, under the day board's key: a receipt makes
    // a shipment on a van one the vault can hand over, a hand-over takes it off. A vault-only
    // treasurer hears only this topic (a placement Operations saves reaches them by the screen's
    // own once-a-minute re-read).
    ['operations', 'dayBoard', 'securedDistribution'],
  ],
  'operations.area': [['operations', 'areas']],
  'operations.bank': [
    ['operations', 'banks'],
    ['operations', 'bankBranches'],
    // «تقرير البنوك» (the vault roll-up, Round 14) prints each row's bank name as the server sent it —
    // a bank renamed on another desk would keep its old name on the report until the next receipt.
    ['operations', 'vaultReport'],
  ],
  'operations.bankBranch': [
    ['operations', 'bankBranches'],
    ['operations', 'banks'],
  ],
  'operations.currency': [['operations', 'currencies']],
  // Round 20 — «أنواع التشغيل»: a type renamed, recoloured, archived or dragged on another desk. The
  // crew board names a row's type from this list (the row holds only the id), so this one key is all
  // a change of the catalog moves.
  'operations.shiftType': [['operations', 'shiftTypes']],

  // ── HR ─────────────────────────────────────────────────────────────────────
  // The company ID card's keys ride here rather than on a topic of their own: a print, a receipt
  // or a handover changes the employee (`idCard` sits on the document the list reads), and the
  // card's own mutations invalidate all four of these locally — so a signal that ANOTHER HR user
  // printed or handed over a card has to reach the same four.
  'hr.employee': [['hr', 'employees'], ['employees'], ['hr', 'employeeIdCard']],
  'hr.employeeFile': [['hr', 'employeeFiles']],
  'hr.employeeLoan': [['hr', 'employeeLoans']],
  'hr.employeeLoanAttachment': [['hr', 'employeeLoans']],
  'hr.employeeActionAttachment': [['hr', 'employees']],
  // Narrower than the employee itself on purpose: copying the card over at hire, or back-filling
  // it for someone hired earlier, changes the Personal tab's card panel and nothing else. The
  // registry list would be refetched for no reason.
  'hr.employeeNationalIdCard': [['hr', 'employees', 'national-id-card']],
  // A photo set or removed: the profile (its photoFileId) and every face drawn from it, which all
  // sit under the employees keys — the person's own summary and photo included.
  'hr.employeePhoto': [['hr', 'employees']],
  'hr.employeePayItem': [['hr', 'compensation']],
  // P-HR-TRN. Two topics, and the catalogue reaches BOTH key families: retiring a course changes
  // what the session form may offer, so a screen holding the picker open must not go on offering
  // a course nobody may schedule any more. A session change touches only sessions — the catalogue
  // did not move.
  'hr.trainingCourse': [
    ['hr', 'trainingCourses'],
    ['hr', 'trainingSessions'],
  ],
  'hr.trainingSession': [['hr', 'trainingSessions']],
  // A decision moves three things: the request, the seat it creates, and the session's remaining
  // capacity — which is the number somebody reads before deciding the next one.
  'hr.trainingNomination': [
    ['hr', 'trainingNominations'],
    ['hr', 'trainingEnrollments'],
    ['hr', 'trainingSessions'],
  ],
  // Completing a session writes records, so a record's arrival refreshes the four screens that
  // could be showing the state before it.
  'hr.trainingRecord': [
    ['hr', 'trainingRecords'],
    ['hr', 'trainingEnrollments'],
    ['hr', 'trainingSessions'],
  ],
  'hr.trainingEnrollment': [
    ['hr', 'trainingEnrollments'],
    ['hr', 'trainingNominations'],
    ['hr', 'trainingSessions'],
    ['hr', 'trainingRecords'],
  ],
  // P-HR-PRF §6. The cycle reaches BOTH families and the review only its own, which is the shape
  // opening makes necessary: opening a round writes several hundred reviews, so a screen watching
  // the round has to refresh the queue too. Assigning an evaluator moves one row and nothing else.
  'hr.performanceCycle': [
    ['hr', 'performanceCycles'],
    ['hr', 'performanceReviews'],
  ],
  'hr.performanceReview': [['hr', 'performanceReviews']],
  // A goal renders inside the review row that owns it, so its movement refreshes both families.
  'hr.performanceGoal': [
    ['hr', 'performanceGoals'],
    ['hr', 'performanceReviews'],
  ],
  'hr.medicalProfile': [['hr', 'medicalProfiles']],
  'hr.medicalEvent': [['hr', 'medicalEvents']],
  'hr.medicalInsurance': [['hr', 'insuranceCards']],
  'hr.contract': [
    ['hr', 'contracts'],
    ['hr', 'settlement'],
  ],
  'hr.contractBranding': [['hr', 'contracts']],
  'hr.contractTemplate': [['hr', 'contracts']],
  'hr.insuranceJobTitle': [['hr', 'contracts', 'insuranceJobTitles']],
  'hr.contractType': [['hr', 'contracts']],
  'hr.costCenterAssignment': [
    ['hr', 'employeeCostCenters'],
    ['hr', 'assignableCostCenters'],
  ],
  'hr.attendanceDay': attendanceDaySweep,
  'hr.attendanceDays': attendanceDaySweep,
  'hr.attendancePeriod': attendanceDaySweep,
  'hr.attendancePunch': attendanceDaySweep,
  'hr.attendancePunchBatch': attendanceDaySweep,
  'hr.attendanceRegularization': attendanceDaySweep,
  'hr.attendanceDayDecision': attendanceDaySweep,
  'hr.attendanceShift': [
    ['hr', 'attendanceShifts'],
    ['hr', 'attendanceAssignments'],
  ],
  'hr.attendanceShiftAssignment': [['hr', 'attendanceAssignments'], ...attendanceDaySweep],
  'hr.holiday': [['hr', 'leave'], ...attendanceDaySweep],
  'hr.leaveRequest': [['hr', 'leave']],
  'hr.leaveType': [['hr', 'leave']],
  'hr.payItem': [
    ['hr', 'payItems'],
    ['hr', 'compensation'],
  ],
  'hr.payrollRun': [['hr', 'payrollRuns']],
  'hr.payslip': [
    ['hr', 'payrollRuns'],
    ['hr', 'compensation'],
  ],
  'hr.payrollAdjustment': [
    ['hr', 'payrollAdjustments'],
    ['hr', 'payrollAdjustmentsAll'],
    ['hr', 'payrollRuns'],
  ],
  'hr.payrollAdjustmentAttachment': [
    ['hr', 'payrollAdjustments'],
    ['hr', 'payrollAdjustmentsAll'],
  ],
  'hr.payrollReportDefinition': [['hr', 'payrollReportDefinitions']],
  // An announcement's visible life IS the recipients' inboxes.
  'hr.announcement': NOTIFICATION_KEYS,
  'hr.notificationRule': [['notification-rules']],
  'hr.applicant': recruitmentPipeline,
  'hr.applicantSource': [
    ['hr', 'applicant-sources'],
    ['hr', 'applicants'],
  ],
  'hr.recruitmentForm': [['hr', 'recruitment-form']],
  'hr.screening': [['hr', 'screenings'], ...recruitmentPipeline],
  'hr.interview': [['hr', 'interviews'], ...recruitmentPipeline],
  'hr.interviewStage': [
    ['hr', 'interviewStages'],
    ['hr', 'interviews'],
  ],
  'hr.evaluation': [['hr', 'evaluations'], ...recruitmentPipeline],
  'hr.evaluationBatch': [
    ['hr', 'evaluationBatches'],
    ['hr', 'evaluations'],
  ],
  'hr.evaluationPhase': [
    ['hr', 'evaluations'],
    ['hr', 'evaluationBatches'],
  ],
  'hr.jobOffer': [['hr', 'jobOffers'], ...recruitmentPipeline],
  // P-HR-REQ — the whole feature subtree: the list, one requisition, and its hires all read the
  // same status, and a decision somebody else took moves all three at once.
  'hr.jobRequisition': [['hr', 'jobRequisitions']],
  // P-HR-APP — a portal account opening changes what the applicant screens show about that
  // candidate (whether they have a portal, and when their link last went out), so those are the
  // lists that go stale. The portal's own screens are the candidate's, on a different origin.
  'hr.applicantPortalAccount': [['hr', 'applicants']],
  // P-HR-APP §5 — an upload or a review lands on the reviewer's queue, and on the applicant's own
  // page because «what has this candidate handed in» is part of reading them. The catalogue
  // refreshes its own list and nothing else: changing what is asked for does not change what
  // anybody has already handed in.
  'hr.applicantDocuments': [
    ['hr', 'applicantDocuments'],
    ['hr', 'applicants'],
  ],
  'hr.applicantDocumentType': [['hr', 'applicantDocumentTypes']],
  'hr.hiringDocuments': [['hr', 'hiringDocuments'], ...recruitmentPipeline],
  'hr.hiringDocumentType': [['hr', 'hiringDocumentTypes']],

  // ── Fleet ──────────────────────────────────────────────────────────────────
  // The alarms board (`['fleet', 'alarms']`) has a key of its own, outside the odometer and
  // maintenance subtrees: every write that moves the alarm names it, here as in `fleet-queries.ts`,
  // or a board left open never hears of a reading somebody else recorded.
  // The dashboard's two live reads ride the rows whose writes move one of its figures (D13); the
  // custody rows do not — the overview's custody line is the custody hooks' own
  // `['fleet', 'custody']`.
  'fleet.vehicle': [
    ['fleet', 'vehicles'],
    ['fleet', 'roster'],
    ['fleet', 'availability'],
    ['fleet', 'alarms'],
    ...fleetDashboardBoth,
  ],
  'fleet.vehicleType': [
    ['fleet', 'vehicleTypes'],
    ['fleet', 'vehicles'],
    ['fleet', 'alarms'],
    ...fleetDashboardBoth,
  ],
  'fleet.catalogItem': [['fleet', 'catalogs'], ['fleet', 'alarms'], ...fleetDashboardBoth],
  'fleet.driverProfile': [
    ['fleet', 'drivers'],
    ['fleet', 'roster'],
    ['fleet', 'availability'],
    ...fleetDashboardNow,
  ],
  'fleet.driverUnavailability': [
    ['fleet', 'availability'],
    ['fleet', 'roster'],
    ...fleetDashboardNow,
  ],
  'fleet.dutyAssignment': [['fleet', 'roster'], ['fleet', 'availability'], ...fleetDashboardNow],
  'fleet.fixedCrew': [['fleet', 'roster'], ...fleetDashboardNow],
  'fleet.maintenanceVisit': [
    ['fleet', 'maintenance'],
    ['fleet', 'odometer'],
    ['fleet', 'vehicles'],
    ['fleet', 'alarms'],
    ...fleetDashboardBoth,
  ],
  'fleet.odometerLog': [
    ['fleet', 'odometer'],
    ['fleet', 'vehicles'],
    ['fleet', 'alarms'],
    ...fleetDashboardBoth,
  ],
  // An accident moves «الآن»'s open files AND the period's files — both reads, and a CLOSED period
  // too: «حوادث الفترة» shows each file's status, «منها N مفتوحة حتى الآن», the four money totals
  // and «المتبقي (حتى الآن)» as of now, so closing a file, a money edit or a transfer moves
  // «الشهر الماضي» as a fine's tick does.
  'fleet.accident': [
    ['fleet', 'accidents'],
    ['fleet', 'vehicles'],
    ...fleetDashboardBoth,
    FLEET_DASHBOARD_PAST,
  ],
  // A fine moves «الآن»'s owed totals AND the period's drivers' fines (a tick turns «قائمة» into
  // «محصَّلة»; a new fine or a moved day changes the period's count) — both reads, and a CLOSED
  // period too: its fines' states are as of now, whatever range is chosen.
  'fleet.violation': [
    ['fleet', 'violations'],
    ['fleet', 'drivers'],
    ...fleetDashboardBoth,
    FLEET_DASHBOARD_PAST,
  ],
  'fleet.violationGrievance': [['fleet', 'violations'], ...fleetDashboardNow],
  // The board — and tab 4's paper counts, which read the same papers.
  'fleet.vehicleLicensing': [['fleet', 'licensing'], ...fleetDashboardNow],
  'fleet.notice': [['fleet', 'notices'], ...fleetDashboardNow],
  // A notice's scans (Files rows owned by `fleetNotice`) and a form's set-up both live on the
  // notices screen and its editor (and in the overview's action centre, «إخطارات ناقصة المرفقات»).
  'fleet.fleetNotice': [['fleet', 'notices'], ...fleetDashboardNow],
  'fleet.noticeSettings': [['fleet', 'notices'], ...fleetDashboardNow],
  // A licence record is a settle candidate of the custody fund («تسوية العهدة») too, and a memo of
  // «مصروفات التراخيص في الفترة» («التراخيص والتجديدات»): R2 while its period is live (a back-dated
  // memo reaches a past period on «تحديث» or a reload, as a receipt does).
  'fleet.licenseExpense': [
    ['fleet', 'licenseExpenses'],
    ['fleet', 'custody'],
    FLEET_DASHBOARD_LIVE,
  ],
  'fleet.licenseExpenseSettings': [['fleet', 'licenseExpenses']],
  // «عقود توريد السيارات» alone: a contract, a delivery or an attachment moves nothing else.
  'fleet.vehicleContract': [['fleet', 'vehicleContracts']],
  // The dealership board — not the custody ledger, not a fuel card — and the dashboard's
  // «فواتير التوكيل» figures.
  'fleet.dealershipInvoice': [['fleet', 'dealership'], ...fleetDashboardBoth],
  'fleet.fuelCard': [['fleet', 'fuelCards'], ...fleetDashboardNow],
  // A card photo's thumbnail (a Files row owned by `fuelCardThumb`) lives on the cards screen.
  'fleet.fuelCardThumb': [['fleet', 'fuelCards'], ...fleetDashboardNow],
  // A receipt is its own row, a line of the ledger, and money off a card.
  'fleet.receipt': [
    ['fleet', 'receipts'],
    ['fleet', 'custody'],
    ['fleet', 'fuelCards'],
    ...fleetDashboardBoth,
  ],
  // «المذكرات», «سجل العهدة» and «إعداد المذكرات» live under the custody subtree. A memo also
  // moves the receipts screen (each receipt says which memo holds it); an operation moves the
  // licence screen's «الحالة» (a settle) — a replenish also signals `custodyMemo` for its memos.
  // Both move «منها حتى الآن» of «العهدة»'s period card (`custodyStates`, as of now for ANY period:
  // R2 live AND past); its «الآن» band rides `['fleet', 'custody']`.
  'fleet.custodyMemo': [
    ['fleet', 'custody'],
    ['fleet', 'receipts'],
    FLEET_DASHBOARD_LIVE,
    FLEET_DASHBOARD_PAST,
  ],
  'fleet.custodyOperation': [
    ['fleet', 'custody'],
    ['fleet', 'licenseExpenses'],
    FLEET_DASHBOARD_LIVE,
    FLEET_DASHBOARD_PAST,
  ],
  'fleet.custodyPaperSettings': [['fleet', 'custody']],

  // ── IT ─────────────────────────────────────────────────────────────────────
  'it.asset': [
    ['it', 'assets'],
    ['it', 'custody'],
  ],
  // FR-18 — a receipt's signed copy shows on the custody rows («بانتظار التوقيع» / «موقّع»), and on
  // the `/it` dashboard's «إيصالات استلام بانتظار التوقيع» — only its figures, as the receipt
  // mutations say: the paper moves no asset.
  'it.custodyReceipt': [
    ['it', 'custody'],
    ['it', 'assets', 'list', { dashboard: 'assets' }],
  ],
  // FR-19 — a line moves its register row, its network's card and its history, and its custody
  // intervals (a person's history page reads those).
  'it.mobileLine': [
    ['it', 'mobileLines'],
    ['it', 'mobileLineAssignments'],
  ],
  // A line acknowledgment's signed copy shows on the register's row and on the intervals.
  'it.mobileLineReceipt': [
    ['it', 'mobileLines'],
    ['it', 'mobileLineAssignments'],
  ],
  // FR-20 — the consumables are ONE subtree: a movement moves the item's figures, the ledger's rows
  // (the movements screen, an asset's and a person's cards) and, for an issue, the memo they show.
  'it.consumable': [['it', 'consumables']],
  // A memo's signed copy shows on the ledger's rows («موقّع» / «بانتظار التوقيع»).
  'it.consumableMemo': [['it', 'consumables']],
  // FR-21 — a report filed on a phone, a photo added to it, or a wrong one deleted moves the vehicle
  // checks dashboard's figures, its reports list and an open report: one subtree, as the delete's
  // own `onSuccess` says.
  'it.vehicleCheck': [['it', 'vehicleChecks']],
  'it.catalogItem': [
    ['it', 'catalogs'],
    ['it', 'priorities'],
  ],
  // «المواقع» — a branch's places: the catalogs tab and the pickers' names, and — a renamed place
  // being what every department holder cell names — the assets and the custody register, as the
  // place mutations' own `onSuccess` says.
  'it.location': [
    ['it', 'locations'],
    ['it', 'assets'],
    ['it', 'custody'],
  ],
  'it.license': [['it', 'licenses']],
  'it.maintenanceOrder': [
    ['it', 'maintenance'],
    ['it', 'assets'],
  ],
  'it.maintenancePlan': [
    ['it', 'maintenancePlans'],
    ['it', 'maintenance'],
  ],
  'it.softwareProduct': [['it', 'software']],
  'it.softwareInstallation': [
    ['it', 'software'],
    ['it', 'assets'],
  ],
  'it.sparePart': [
    ['it', 'spareParts'],
    ['it', 'maintenance'],
  ],
  'it.ticket': [
    ['it', 'tickets'],
    ['it', 'ticketStream'],
  ],
  'it.ticketPriority': [
    ['it', 'priorities'],
    ['it', 'catalogs'],
  ],
  'it.vendor': [['it', 'vendors']],

  // ── Administrative Affairs ─────────────────────────────────────────────────
  // An item moves the item screens; a unit or a category moves the catalogs screen and every item
  // screen that names one (administration-module-design-integration.md §9.4); `stock` joins in P5.
  // A category also moves the supplier screens, whose rows and records name the categories each
  // supplier supplies (P1b.W); no supplier names a unit.
  'administration.item': [['administration', 'items']],
  'administration.catalogItem': [
    ['administration', 'catalogs'],
    ['administration', 'items'],
  ],
  'administration.itemCategory': [
    ['administration', 'catalogs'],
    ['administration', 'items'],
    ['administration', 'suppliers'],
  ],
  // A warehouse moves the warehouse register and the home's count. The branch options are their
  // own subtree (`warehouseBranchOptions`): no warehouse write changes what a key reaches.
  'administration.warehouse': [['administration', 'warehouses']],
  // A supplier moves the supplier screens (P1b.W) — its register, its record and the home's count —
  // its papers included (§9.4); `rfqs` joins with P3 and `purchaseOrders` with P4.
  'administration.supplier': [['administration', 'suppliers']],

  // ── Automation ─────────────────────────────────────────────────────────────
  'automation.workflow': [['automation']],
  'automation.variable': [['automation']],
  'automation.credential': [['automation']],

  // ── Platform ───────────────────────────────────────────────────────────────
  'platform.user': [
    ['system-admin', 'users'],
    ['system-admin', 'assignments'],
  ],
  'platform.role': [['system-admin']],
  // A chain is read on one screen and nowhere else, so one key is the whole answer — and it is the
  // feature key rather than a list key, because the editor writes by PLACE, not by id: a save can
  // create a row the list does not have yet.
  'platform.approvalWorkflow': [['system-admin', 'approval-workflows']],
  'platform.organization': [['org'], ['platform', 'organization']],
  'platform.branch': [['org'], ['platform', 'organization'], ['system-admin', 'branch-options']],
  // P-ORG-3 §6.2: the organization module's own keys start with 'organization' — the two rows above
  // matched no /organization/* query, so another user's edit refreshed nothing there.
  'platform.department': [
    ['org'],
    ['platform', 'organization'],
    ['organization', 'departments'],
    ['organization', 'org-chart'],
  ],
  'platform.departmentCatalog': [
    ['org'],
    ['platform', 'organization'],
    ['organization', 'departments'],
    ['organization', 'org-chart'],
  ],
  'platform.sectionCatalog': [
    ['org'],
    ['platform', 'organization'],
    ['organization', 'sections'],
    ['organization', 'org-chart'],
  ],
  'platform.section': [
    ['org'],
    ['platform', 'organization'],
    ['organization', 'sections'],
    ['organization', 'org-chart'],
  ],
  'platform.costCenter': [
    ['hr', 'assignableCostCenters'],
    ['platform', 'costCenters'],
  ],
  'platform.jobTitle': [
    ['org', 'job-titles'],
    ['organization', 'jobTitles'],
    ['organization', 'job-titles'],
    ['organization', 'org-chart'],
  ],
  'platform.application': [['me', 'applications']],
  'platform.applicationCategory': [['me', 'applications']],
  'platform.applicationSection': [['me', 'applications']],
  'platform.setting': [['platform', 'settings']],
  'platform.scheduledTask': [['platform', 'scheduled-tasks']],
  'platform.notificationTemplate': [['platform', 'notification-templates']],
  'platform.file': [['platform', 'fileCategories']],
  'platform.fileCategory': [['platform', 'fileCategories']],
  'platform.auditLog': [['platform', 'audit-logs']],
  'platform.activityLog': [['platform', 'activity-logs']],
};

/** Every prefix the registry can touch — the reconnect sweep invalidates exactly these. */
export const ALL_REALTIME_KEY_PREFIXES: readonly KeyPrefix[] = (() => {
  const seen = new Map<string, KeyPrefix>();
  for (const prefixes of Object.values(INVALIDATION_REGISTRY)) {
    for (const prefix of prefixes) seen.set(JSON.stringify(prefix), prefix);
  }
  for (const prefix of NOTIFICATION_KEYS) seen.set(JSON.stringify(prefix), prefix);
  return [...seen.values()];
})();

export const keysForTopic = (topic: string): readonly KeyPrefix[] =>
  INVALIDATION_REGISTRY[topic] ?? [];
