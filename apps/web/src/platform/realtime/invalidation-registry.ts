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
];

/**
 * «لوحة تحكم الحركة» (D13): R1, the «الآن» tabs, and R2 while its period is still LIVE (a period
 * that ended — `past` — never moves, so no signal names it). A dashboard counts over every fleet
 * screen at once, so a busy morning would re-read it on every save: these two prefixes are NOT
 * swept like the rest — the provider hands them to the platform throttle (`throttle.ts`), which
 * marks them stale at once and refetches what is on screen at most once per window.
 */
const FLEET_DASHBOARD_NOW: KeyPrefix = ['fleet', 'dashboard', 'now'];
const FLEET_DASHBOARD_LIVE: KeyPrefix = ['fleet', 'dashboard', 'period', 'live'];
/** The rows whose writes move a figure of both reads (a «الآن» count and a period total). */
const fleetDashboardBoth: readonly KeyPrefix[] = [FLEET_DASHBOARD_NOW, FLEET_DASHBOARD_LIVE];
/** The rows whose writes move only a «الآن» figure (roster, licences, notices, fuel, violations). */
const fleetDashboardNow: readonly KeyPrefix[] = [FLEET_DASHBOARD_NOW];

/** Every prefix realtime refreshes through the throttle rather than the plain sweep. */
export const THROTTLED_KEY_PREFIXES: readonly KeyPrefix[] = [
  FLEET_DASHBOARD_NOW,
  FLEET_DASHBOARD_LIVE,
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
  ],
  'operations.area': [['operations', 'areas']],
  'operations.bank': [
    ['operations', 'banks'],
    ['operations', 'bankBranches'],
    ['operations', 'reportBanks'],
  ],
  'operations.bankBranch': [
    ['operations', 'bankBranches'],
    ['operations', 'banks'],
  ],
  'operations.currency': [['operations', 'currencies']],

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
  // custody rows do not — tab 1's custody line is the custody hooks' own `['fleet', 'custody']`.
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
  'fleet.accident': [['fleet', 'accidents'], ['fleet', 'vehicles'], ...fleetDashboardBoth],
  'fleet.violation': [['fleet', 'violations'], ['fleet', 'drivers'], ...fleetDashboardNow],
  'fleet.violationGrievance': [['fleet', 'violations'], ...fleetDashboardNow],
  // The board — and tab 4's paper counts, which read the same papers.
  'fleet.vehicleLicensing': [['fleet', 'licensing'], ...fleetDashboardNow],
  'fleet.notice': [['fleet', 'notices'], ...fleetDashboardNow],
  // A notice's scans (Files rows owned by `fleetNotice`) and a form's set-up both live on the
  // notices screen and its editor (and in tab 1's «إخطارات ناقصة المرفقات»).
  'fleet.fleetNotice': [['fleet', 'notices'], ...fleetDashboardNow],
  'fleet.noticeSettings': [['fleet', 'notices'], ...fleetDashboardNow],
  // A licence record is a settle candidate of the custody fund («تسوية العهدة») too.
  'fleet.licenseExpense': [
    ['fleet', 'licenseExpenses'],
    ['fleet', 'custody'],
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
  'fleet.custodyMemo': [
    ['fleet', 'custody'],
    ['fleet', 'receipts'],
  ],
  'fleet.custodyOperation': [
    ['fleet', 'custody'],
    ['fleet', 'licenseExpenses'],
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
  'platform.department': [['org'], ['platform', 'organization']],
  'platform.departmentCatalog': [['org'], ['platform', 'organization']],
  'platform.sectionCatalog': [['org'], ['platform', 'organization']],
  'platform.section': [['org'], ['platform', 'organization']],
  'platform.costCenter': [
    ['hr', 'assignableCostCenters'],
    ['platform', 'costCenters'],
  ],
  'platform.jobTitle': [['org', 'job-titles']],
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
