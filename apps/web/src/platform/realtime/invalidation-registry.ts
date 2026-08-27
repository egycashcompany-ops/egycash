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

const recruitmentPipeline: readonly KeyPrefix[] = [
  ['hr', 'applicants'],
  ['hr', 'recruitmentStageCounts'],
  ['hr', 'recruitmentTimeline'],
];

export const INVALIDATION_REGISTRY: Readonly<Record<string, readonly KeyPrefix[]>> = {
  // ── ATM ────────────────────────────────────────────────────────────────────
  'atm.machine': [['atm', 'machines']],
  'atm.refLabel': [['atm', 'refLabels'], ['atm', 'machines']],
  'atm.replenishment': [['atm', 'replenishments']],
  'atm.maintenance': [['atm', 'maintenances']],
  'atm.mailTicket': [['atm', 'mailTickets'], ['atm', 'maintenances']],

  // ── Gold ───────────────────────────────────────────────────────────────────
  'gold.bar': goldStockSweep,
  'gold.transfer': goldStockSweep,
  'gold.receivingReceipt': goldStockSweep,
  'gold.deliveryReceipt': goldStockSweep,
  'gold.vault': [['gold', 'vaults'], ['gold', 'drawers'], ['gold', 'floors'], ['gold', 'keysOverview'], ['gold', 'dashboard']],
  'gold.floor': [['gold', 'floors'], ['gold', 'vaults'], ['gold', 'drawers'], ['gold', 'dashboard']],
  'gold.keyHandover': [['gold', 'keys'], ['gold', 'keysOverview']],
  'gold.company': [['gold', 'companies']],
  'gold.representative': [['gold', 'representatives']],
  'gold.portalAccount': [['gold', 'portal-accounts']],

  // ── Operations ─────────────────────────────────────────────────────────────
  'operations.shipment': shipmentSweep,
  'operations.shipmentAssignment': shipmentSweep,
  'operations.day': [['operations', 'dayBoard'], ['operations', 'myDay'], ['operations', 'crewBoard']],
  'operations.crewAssignment': [['operations', 'crewBoard'], ['operations', 'crewAttendance'], ['operations', 'crewDirectory'], ['operations', 'dayBoard'], ['operations', 'myDay']],
  'operations.crewRequirements': [['operations', 'crewRequirements'], ['operations', 'crewBoard']],
  'operations.standingCrew': [['operations', 'standingCrew'], ['operations', 'crewBoard']],
  'operations.vaultCustody': [['operations', 'vault'], ['operations', 'vaultReport'], ['operations', 'securedDue'], ['operations', 'securedBacklog']],
  'operations.area': [['operations', 'areas']],
  'operations.bank': [['operations', 'banks'], ['operations', 'bankBranches'], ['operations', 'reportBanks']],
  'operations.bankBranch': [['operations', 'bankBranches'], ['operations', 'banks']],
  'operations.currency': [['operations', 'currencies']],

  // ── HR ─────────────────────────────────────────────────────────────────────
  'hr.employee': [['hr', 'employees'], ['employees']],
  'hr.employeeFile': [['hr', 'employeeFiles']],
  'hr.employeeLoan': [['hr', 'employeeLoans']],
  'hr.employeeLoanAttachment': [['hr', 'employeeLoans']],
  'hr.employeeActionAttachment': [['hr', 'employees']],
  'hr.employeePayItem': [['hr', 'compensation']],
  // P-HR-TRN. Two topics, and the catalogue reaches BOTH key families: retiring a course changes
  // what the session form may offer, so a screen holding the picker open must not go on offering
  // a course nobody may schedule any more. A session change touches only sessions — the catalogue
  // did not move.
  'hr.trainingCourse': [['hr', 'trainingCourses'], ['hr', 'trainingSessions']],
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
  'hr.performanceCycle': [['hr', 'performanceCycles'], ['hr', 'performanceReviews']],
  'hr.performanceReview': [['hr', 'performanceReviews']],
  'hr.contract': [['hr', 'contracts'], ['hr', 'settlement']],
  'hr.contractBranding': [['hr', 'contracts']],
  'hr.contractTemplate': [['hr', 'contracts']],
  'hr.contractType': [['hr', 'contracts']],
  'hr.costCenterAssignment': [['hr', 'employeeCostCenters'], ['hr', 'assignableCostCenters']],
  'hr.attendanceDay': attendanceDaySweep,
  'hr.attendanceDays': attendanceDaySweep,
  'hr.attendancePeriod': attendanceDaySweep,
  'hr.attendancePunch': attendanceDaySweep,
  'hr.attendancePunchBatch': attendanceDaySweep,
  'hr.attendanceRegularization': attendanceDaySweep,
  'hr.attendanceShift': [['hr', 'attendanceShifts'], ['hr', 'attendanceAssignments']],
  'hr.attendanceShiftAssignment': [['hr', 'attendanceAssignments'], ...attendanceDaySweep],
  'hr.holiday': [['hr', 'leave'], ...attendanceDaySweep],
  'hr.leaveRequest': [['hr', 'leave']],
  'hr.leaveType': [['hr', 'leave']],
  'hr.payItem': [['hr', 'payItems'], ['hr', 'compensation']],
  'hr.payrollRun': [['hr', 'payrollRuns']],
  'hr.payslip': [['hr', 'payrollRuns'], ['hr', 'compensation']],
  'hr.payrollAdjustment': [['hr', 'payrollAdjustments'], ['hr', 'payrollAdjustmentsAll'], ['hr', 'payrollRuns']],
  'hr.payrollAdjustmentAttachment': [['hr', 'payrollAdjustments'], ['hr', 'payrollAdjustmentsAll']],
  'hr.payrollReportDefinition': [['hr', 'payrollReportDefinitions']],
  // An announcement's visible life IS the recipients' inboxes.
  'hr.announcement': NOTIFICATION_KEYS,
  'hr.notificationRule': [['notification-rules']],
  'hr.applicant': recruitmentPipeline,
  'hr.applicantSource': [['hr', 'applicant-sources'], ['hr', 'applicants']],
  'hr.recruitmentForm': [['hr', 'recruitment-form']],
  'hr.screening': [['hr', 'screenings'], ...recruitmentPipeline],
  'hr.interview': [['hr', 'interviews'], ...recruitmentPipeline],
  'hr.interviewStage': [['hr', 'interviewStages'], ['hr', 'interviews']],
  'hr.evaluation': [['hr', 'evaluations'], ...recruitmentPipeline],
  'hr.evaluationBatch': [['hr', 'evaluationBatches'], ['hr', 'evaluations']],
  'hr.evaluationPhase': [['hr', 'evaluations'], ['hr', 'evaluationBatches']],
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
  'hr.applicantDocuments': [['hr', 'applicantDocuments'], ['hr', 'applicants']],
  'hr.applicantDocumentType': [['hr', 'applicantDocumentTypes']],
  'hr.hiringDocuments': [['hr', 'hiringDocuments'], ...recruitmentPipeline],
  'hr.hiringDocumentType': [['hr', 'hiringDocumentTypes']],

  // ── Fleet ──────────────────────────────────────────────────────────────────
  'fleet.vehicle': [['fleet', 'vehicles'], ['fleet', 'roster'], ['fleet', 'availability']],
  'fleet.vehicleType': [['fleet', 'vehicleTypes'], ['fleet', 'vehicles']],
  'fleet.catalogItem': [['fleet', 'catalogs']],
  'fleet.driverProfile': [['fleet', 'drivers'], ['fleet', 'roster'], ['fleet', 'availability']],
  'fleet.driverUnavailability': [['fleet', 'availability'], ['fleet', 'roster']],
  'fleet.dutyAssignment': [['fleet', 'roster'], ['fleet', 'availability']],
  'fleet.fixedCrew': [['fleet', 'roster']],
  'fleet.maintenanceVisit': [['fleet', 'maintenance'], ['fleet', 'odometer'], ['fleet', 'vehicles']],
  'fleet.odometerLog': [['fleet', 'odometer'], ['fleet', 'vehicles']],
  'fleet.accident': [['fleet', 'accidents'], ['fleet', 'vehicles']],
  'fleet.violation': [['fleet', 'violations'], ['fleet', 'drivers']],
  'fleet.violationGrievance': [['fleet', 'violations']],

  // ── IT ─────────────────────────────────────────────────────────────────────
  'it.asset': [['it', 'assets'], ['it', 'custody']],
  'it.catalogItem': [['it', 'catalogs'], ['it', 'priorities']],
  'it.license': [['it', 'licenses']],
  'it.maintenanceOrder': [['it', 'maintenance'], ['it', 'assets']],
  'it.maintenancePlan': [['it', 'maintenancePlans'], ['it', 'maintenance']],
  'it.softwareProduct': [['it', 'software']],
  'it.softwareInstallation': [['it', 'software'], ['it', 'assets']],
  'it.sparePart': [['it', 'spareParts'], ['it', 'maintenance']],
  'it.ticket': [['it', 'tickets'], ['it', 'ticketStream']],
  'it.ticketPriority': [['it', 'priorities'], ['it', 'catalogs']],
  'it.vendor': [['it', 'vendors']],

  // ── Automation ─────────────────────────────────────────────────────────────
  'automation.workflow': [['automation']],
  'automation.variable': [['automation']],
  'automation.credential': [['automation']],

  // ── Platform ───────────────────────────────────────────────────────────────
  'platform.user': [['system-admin', 'users'], ['system-admin', 'assignments']],
  'platform.role': [['system-admin']],
  'platform.organization': [['org'], ['platform', 'organization']],
  'platform.branch': [['org'], ['platform', 'organization'], ['system-admin', 'branch-options']],
  'platform.department': [['org'], ['platform', 'organization']],
  'platform.section': [['org'], ['platform', 'organization']],
  'platform.costCenter': [['hr', 'assignableCostCenters'], ['platform', 'costCenters']],
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
