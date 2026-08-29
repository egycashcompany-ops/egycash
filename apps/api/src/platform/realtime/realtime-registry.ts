// The realtime topic registry (ADR-029): every entity type the audit trail records, mapped to
// the ONE view permission that gates knowing the entity changed.
//
// Why a registry and not convention: the broadcast decision is an authorization decision. A
// signal that "a payroll run changed" is itself information, so each topic's room is joined only
// by callers holding the same permission that guards the entity's screen. An entity missing from
// both maps below fails `realtime-registry.spec.ts` — forgetting to classify a NEW audited
// entity breaks CI, it does not silently ship a screen that never updates (or worse, one that
// broadcasts to everyone).
//
// The keys mirror `entityRef` exactly: `<moduleId>.<entityType>`.

export interface RealtimeTopicDef {
  /** Holding this permission (at any scope) is the condition for joining the topic's rooms. */
  permission: string;
}

export const REALTIME_TOPICS: Readonly<Record<string, RealtimeTopicDef>> = {
  // ── ATM ────────────────────────────────────────────────────────────────────
  'atm.machine': { permission: 'atmMachine.view' },
  'atm.refLabel': { permission: 'atmMachine.view' },
  'atm.replenishment': { permission: 'atmReplenishment.view' },
  'atm.maintenance': { permission: 'atmMaintenance.view' },
  'atm.mailTicket': { permission: 'atmMailTicket.view' },

  // ── Gold ───────────────────────────────────────────────────────────────────
  'gold.bar': { permission: 'goldBar.view' },
  'gold.vault': { permission: 'goldVault.view' },
  'gold.floor': { permission: 'goldVault.view' },
  'gold.transfer': { permission: 'goldTransfer.view' },
  'gold.receivingReceipt': { permission: 'goldReceiving.view' },
  'gold.deliveryReceipt': { permission: 'goldDelivery.view' },
  'gold.keyHandover': { permission: 'goldKey.view' },
  'gold.company': { permission: 'goldCompany.view' },
  'gold.representative': { permission: 'goldRepresentative.view' },
  'gold.portalAccount': { permission: 'goldPortalAccount.view' },

  // ── Operations ─────────────────────────────────────────────────────────────
  'operations.day': { permission: 'operationsCrew.view' },
  'operations.shipment': { permission: 'operationsShipment.view' },
  'operations.shipmentAssignment': { permission: 'operationsShipment.view' },
  'operations.crewAssignment': { permission: 'operationsCrew.view' },
  'operations.crewRequirements': { permission: 'operationsCrew.view' },
  'operations.standingCrew': { permission: 'operationsCrew.view' },
  'operations.vaultCustody': { permission: 'operationsVault.view' },
  'operations.area': { permission: 'operationsCatalog.manage' },
  'operations.bank': { permission: 'operationsCatalog.manage' },
  'operations.bankBranch': { permission: 'operationsCatalog.manage' },
  'operations.currency': { permission: 'operationsCatalog.manage' },

  // ── HR ─────────────────────────────────────────────────────────────────────
  'hr.employee': { permission: 'employee.view' },
  'hr.employeeFile': { permission: 'employeeFile.view' },
  'hr.employeeLoan': { permission: 'employeeLoan.view' },
  'hr.employeeLoanAttachment': { permission: 'employeeLoan.view' },
  'hr.employeeActionAttachment': { permission: 'employee.view' },
  // Compensation is the canonical sensitive case: even the fact that a pay item changed is
  // gated behind the compensation permission, not plain employee.view.
  'hr.employeePayItem': { permission: 'employee.viewCompensation' },
  // P-HR-TRN. The catalogue is configuration, so it follows the key that administers it; a session
  // is the operational record several people work at once, so it follows the read permission.
  'hr.trainingCourse': { permission: 'trainingCourse.manage' },
  'hr.trainingSession': { permission: 'trainingSession.view' },
  // A nomination and a seat are both about a PERSON, so both follow the key that reads them.
  'hr.trainingNomination': { permission: 'trainingNomination.view' },
  'hr.trainingEnrollment': { permission: 'trainingNomination.view' },
  'hr.trainingRecord': { permission: 'trainingRecord.view' },
  // P-HR-PRF §6 — the existing bus, reused. A cycle changes state under people who are looking at
  // it (opening writes several hundred rows, and the count on screen is the receipt), and a review
  // is an operational row several people work at once. Each follows the key that READS it, which
  // for the review is the one that gates a named person.
  'hr.performanceCycle': { permission: 'performanceCycle.view' },
  'hr.performanceReview': { permission: 'performanceReview.view' },
  // P3. A goal follows its own read key: it is about a person, and the group that reads goals is
  // the group that reads the person's review — but the keys stay separate so ADR-017 finer scopes
  // can diverge later without a migration.
  'hr.performanceGoal': { permission: 'performanceGoal.view' },
  // P-HR-MED. Follows its own key and nothing else (D3) — the realtime layer must not be the one
  // place a clinical change announces itself to a wider audience than may read it.
  'hr.medicalProfile': { permission: 'medicalRecord.view' },
  'hr.contract': { permission: 'contract.view' },
  'hr.contractBranding': { permission: 'contractTemplate.manage' },
  'hr.contractTemplate': { permission: 'contractTemplate.manage' },
  'hr.contractType': { permission: 'contractType.manage' },
  'hr.costCenterAssignment': { permission: 'costCenter.view' },
  'hr.attendanceDay': { permission: 'attendance.view' },
  'hr.attendanceDays': { permission: 'attendance.view' },
  'hr.attendancePeriod': { permission: 'attendance.view' },
  'hr.attendancePunch': { permission: 'attendance.view' },
  'hr.attendancePunchBatch': { permission: 'attendance.view' },
  'hr.attendanceRegularization': { permission: 'attendance.view' },
  'hr.attendanceShift': { permission: 'attendance.view' },
  'hr.attendanceShiftAssignment': { permission: 'attendance.view' },
  'hr.holiday': { permission: 'workCalendar.manage' },
  'hr.leaveRequest': { permission: 'leave.view' },
  'hr.leaveType': { permission: 'leave.manageTypes' },
  'hr.payItem': { permission: 'payItem.view' },
  'hr.payrollRun': { permission: 'payrollRun.view' },
  'hr.payrollAdjustment': { permission: 'payrollAdjustment.view' },
  'hr.payrollAdjustmentAttachment': { permission: 'payrollAdjustment.view' },
  'hr.payrollReportDefinition': { permission: 'payrollReport.view' },
  'hr.payslip': { permission: 'payrollRun.view' },
  'hr.announcement': { permission: 'announcement.view' },
  'hr.notificationRule': { permission: 'notificationRule.view' },
  'hr.applicant': { permission: 'applicant.view' },
  'hr.applicantSource': { permission: 'applicantSource.manage' },
  'hr.recruitmentForm': { permission: 'recruitmentForm.manage' },
  'hr.screening': { permission: 'screening.view' },
  'hr.interview': { permission: 'interview.view' },
  'hr.interviewStage': { permission: 'interviewStage.manage' },
  'hr.evaluation': { permission: 'evaluation.view' },
  'hr.evaluationBatch': { permission: 'evaluation.view' },
  'hr.evaluationPhase': { permission: 'evaluationPhase.manage' },
  'hr.jobOffer': { permission: 'jobOffer.view' },
  // P-HR-REQ — knowing a requisition moved is knowing somebody asked to hire, and who approved
  // it; the room is joined by the same key that opens its screen.
  'hr.jobRequisition': { permission: 'jobRequisition.view' },
  // P-HR-APP — a portal account being opened is an audited HR act, so it must be classified here
  // like every other. Staff who administer the portal are the audience; the candidate is not on
  // this bus at all.
  'hr.applicantPortalAccount': { permission: 'applicant.view' },
  // P-HR-APP §5 — the documents a CANDIDATE hands in, and the catalogue of what is asked for.
  // The audience on this bus is the staff who review them: a reviewer with the queue open should
  // see a new upload arrive without reloading. The candidate is not on this bus at all — their
  // own screen refreshes from their own action, and putting them on it would mean an external
  // account holding a socket into an HR room.
  'hr.applicantDocuments': { permission: 'applicantDocument.view' },
  'hr.applicantDocumentType': { permission: 'applicantDocumentType.manage' },
  'hr.hiringDocuments': { permission: 'hiringDocuments.view' },
  'hr.hiringDocumentType': { permission: 'hiringDocumentType.manage' },

  // ── Fleet ──────────────────────────────────────────────────────────────────
  'fleet.vehicle': { permission: 'fleetVehicle.view' },
  'fleet.vehicleType': { permission: 'fleetVehicle.view' },
  'fleet.catalogItem': { permission: 'fleetCatalog.manage' },
  'fleet.driverProfile': { permission: 'fleetDriver.view' },
  'fleet.driverUnavailability': { permission: 'fleetAvailability.view' },
  'fleet.dutyAssignment': { permission: 'fleetRoster.view' },
  'fleet.fixedCrew': { permission: 'fleetRoster.view' },
  'fleet.maintenanceVisit': { permission: 'fleetMaintenance.view' },
  'fleet.odometerLog': { permission: 'fleetOdometer.view' },
  'fleet.accident': { permission: 'fleetAccident.view' },
  'fleet.violation': { permission: 'fleetViolation.view' },
  'fleet.violationGrievance': { permission: 'fleetViolation.view' },

  // ── IT ─────────────────────────────────────────────────────────────────────
  'it.asset': { permission: 'itAsset.view' },
  'it.catalogItem': { permission: 'itCatalog.manage' },
  'it.license': { permission: 'itLicense.view' },
  'it.maintenanceOrder': { permission: 'itMaintenance.view' },
  'it.maintenancePlan': { permission: 'itMaintenancePlan.manage' },
  'it.softwareProduct': { permission: 'itSoftware.view' },
  'it.softwareInstallation': { permission: 'itSoftware.view' },
  'it.sparePart': { permission: 'itSparePart.view' },
  'it.ticket': { permission: 'itTicket.view' },
  'it.ticketPriority': { permission: 'itCatalog.manage' },
  'it.vendor': { permission: 'itVendor.view' },

  // ── Automation ─────────────────────────────────────────────────────────────
  'automation.workflow': { permission: 'workflow.view' },
  'automation.variable': { permission: 'variable.view' },
  'automation.credential': { permission: 'credential.view' },

  // ── Platform ───────────────────────────────────────────────────────────────
  'platform.user': { permission: 'user.view' },
  'platform.role': { permission: 'role.view' },
  'platform.organization': { permission: 'organization.view' },
  'platform.branch': { permission: 'organization.view' },
  'platform.department': { permission: 'organization.view' },
  'platform.section': { permission: 'organization.view' },
  'platform.costCenter': { permission: 'costCenter.view' },
  'platform.jobTitle': { permission: 'jobTitle.view' },
  'platform.application': { permission: 'application.view' },
  'platform.applicationCategory': { permission: 'applicationCategory.view' },
  'platform.applicationSection': { permission: 'application.view' },
  'platform.setting': { permission: 'setting.view' },
  'platform.scheduledTask': { permission: 'scheduledTask.view' },
  'platform.notificationTemplate': { permission: 'notificationTemplate.view' },
  'platform.file': { permission: 'file.view' },
  'platform.fileCategory': { permission: 'fileCategory.manage' },
  'platform.auditLog': { permission: 'auditLog.view' },
  'platform.activityLog': { permission: 'activityLog.view' },
};

/**
 * Audited entities that deliberately have NO entity topic, each with the reason. They still
 * reach the audit stream — exclusion means "no dedicated screen reacts to this", never "hide it".
 */
export const REALTIME_EXCLUDED_ENTITIES: Readonly<Record<string, string>> = {
  // Notifications are a per-user channel: `notification:new` already reaches exactly the owner's
  // room, and a broadcast topic would tell everyone who is being notified about what.
  'platform.notification': 'per-user channel — user rooms already carry it',
  // Security signals are audit records about the audit stream itself; they surface on the audit
  // screen (via the audit stream), and broadcasting them as an entity topic adds nothing.
  'platform.security': 'audit-stream only — the audit screen is where alerts surface',
  // An export is an artifact, not a record with a list screen to refresh.
  'hr.applicantExport': 'export artifact — no screen lists exports',
};
