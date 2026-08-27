// The event catalogue (A-2).
//
// The catalogue's only real failure mode is DRIFT — describing a payload that is not the payload
// that gets emitted. So the tests here are almost entirely about the catalogue agreeing with the
// Zod schemas rather than about any particular field: every event is registered, every generated
// sample actually parses against its own schema, and every name resolves to real vocabulary.
// Those three, held together, are what make it safe to build a trigger picker on top of this.
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  EVENT_CATALOG,
  EVENT_CATALOG_VERSION,
  EVENT_MULTI_PUBLISHER,
  HR_EVENT_PAYLOAD_SCHEMAS,
  JSON_SCHEMA_DIALECT,
  PLATFORM_EVENT_PAYLOAD_SCHEMAS,
  buildEventCatalog,
  eventCatalogDigest,
  eventCatalogDocument,
  eventCatalogEntry,
  eventCatalogNames,
  eventTypeName,
  isCatalogedEventName,
  isFullyLocalized,
  stableEventNames,
} from './catalog.js';
import { EVENT_SCHEMA_VERSIONS, PlatformEvents } from './index.js';
import { HrEvents } from '../modules/hr-recruitment.js';
import { HrEmployeeEvents } from '../modules/hr-employee.js';
import { HrLeaveEvents } from '../modules/hr-leave.js';
import { HrAttendanceEvents } from '../modules/hr-attendance.js';
import { HrPayrollEvents } from '../modules/hr-payroll.js';
import { HrEmployeeLoanEvents } from '../modules/hr-employee-loans.js';
import { HrJobRequisitionEvents } from '../modules/hr-job-requisition.js';
import { HrContractEvents } from '../modules/hr-contract.js';
import { HrTrainingEvents } from '../modules/hr-training.js';
import {
  HrTrainingEnrollmentEvents,
  HrTrainingNominationEvents,
} from '../modules/hr-training-nominations.js';
import { HrOfferEvents } from '../modules/hr-job-offer.js';
import { HrInterviewEvents } from '../modules/hr-interview.js';
import { HrScreeningEvents } from '../modules/hr-screening.js';
import { HrEvaluationEvents } from '../modules/hr-evaluation.js';
import { HrEvaluationBatchEvents } from '../modules/hr-evaluation-batch.js';
import { HrEmployeeFileEvents } from '../modules/hr-employee-file.js';
import { HrHiringDocumentsEvents } from '../modules/hr-hiring-documents.js';
import {
  HrRecruitmentWorkflowEvents,
  HrWorkflowEngineEvents,
} from '../modules/hr-recruitment-workflow.js';
import { FleetEvents } from '../modules/fleet.js';
import { HrApplicantDocumentEvents } from '../modules/hr-applicant-documents.js';
import { OperationsEvents } from '../modules/operations.js';
import { ItEvents } from '../modules/it.js';

const HR_EVENT_CONSTANTS = [
  HrEvents,
  HrRecruitmentWorkflowEvents,
  HrWorkflowEngineEvents,
  HrScreeningEvents,
  HrInterviewEvents,
  HrEvaluationEvents,
  HrEvaluationBatchEvents,
  HrOfferEvents,
  HrEmployeeEvents,
  HrEmployeeFileEvents,
  HrHiringDocumentsEvents,
  // P-HR-APP §5 — what a CANDIDATE hands in. Declared here with the entry that catalogues it, for
  // the reason the payroll note below gives: a catalogued name with no constant behind it is a
  // trigger that can never fire.
  HrApplicantDocumentEvents,
  HrLeaveEvents,
  HrAttendanceEvents,
  // P-HR-07 — the payroll decisions somebody waits on. Declared here the moment they were
  // catalogued, because a catalogued name with no constant behind it is a trigger that can never
  // fire, and this list is what proves the two sides agree.
  HrPayrollEvents,
  HrEmployeeLoanEvents,
  // P-HR-REQ — the six requisition facts, declared here with the entry that catalogues them.
  HrJobRequisitionEvents,
  HrContractEvents,
  // P-HR-TRN — the four session facts, declared here with the entry that catalogues them, for the
  // reason the two notes above give: a catalogued name with no constant behind it is a trigger
  // that can never fire, and this list is what proves the two sides agree.
  HrTrainingEvents,
  HrTrainingNominationEvents,
  HrTrainingEnrollmentEvents,
].flatMap((group) => Object.values(group));

const FLEET_EVENT_CONSTANTS = Object.values(FleetEvents);
// OP-2 declares the five shipment lifecycle events with their emit sites — stable from day one.
const OPERATIONS_EVENT_CONSTANTS = Object.values(OperationsEvents);
// IT-1 declares the two registry events with their emit sites — both stable from day one.
const IT_EVENT_CONSTANTS = Object.values(ItEvents);
// Promoted to stable by the slices that added their emit sites (FL-2..FL-6). All 22 are
// stable — FLEET_PLANNED below derives to empty, which is the point: nothing fleet remains
// declared-but-unpublished.
const FLEET_STABLE = new Set<string>([
  FleetEvents.VehicleCreated,
  FleetEvents.VehicleUpdated,
  FleetEvents.VehicleStatusChanged,
  // Catalogs slice — both published by the vehicle service at its commit points.
  FleetEvents.VehicleLicenseImageUploaded,
  FleetEvents.VehicleLicenseImageDeleted,
  // Drivers slice — both published by the driver-profile service at its commit points.
  FleetEvents.DriverLicenseImageUploaded,
  FleetEvents.DriverLicenseImageDeleted,
  FleetEvents.UnavailabilityRecorded,
  FleetEvents.UnavailabilityEnded,
  FleetEvents.OdometerRecorded,
  FleetEvents.OdometerCorrected,
  FleetEvents.MaintenanceCheckedIn,
  FleetEvents.MaintenanceCheckedOut,
  FleetEvents.MaintenanceReopened,
  FleetEvents.MaintenanceAlarmRaised,
  FleetEvents.VehicleLicenseExpiring,
  FleetEvents.VehicleLicenseExpired,
  FleetEvents.DriverLicenseExpiring,
  FleetEvents.DriverLicenseExpired,
  FleetEvents.RosterPlanned,
  FleetEvents.AssignmentChanged,
  FleetEvents.AccidentRecorded,
  FleetEvents.AccidentClosed,
  FleetEvents.AccidentReopened,
  FleetEvents.ViolationRecorded,
  FleetEvents.GrievanceApplied,
]);
const FLEET_PLANNED = FLEET_EVENT_CONSTANTS.filter((name) => !FLEET_STABLE.has(name));

const ALL_SCHEMAS: Record<string, z.ZodTypeAny | null> = {
  ...PLATFORM_EVENT_PAYLOAD_SCHEMAS,
  ...HR_EVENT_PAYLOAD_SCHEMAS,
};

// ── Coverage: nothing emitted is missing, nothing catalogued is invented ─────

describe('coverage', () => {
  it('catalogues every platform event', () => {
    // The compiler already enforces this (`Record<PlatformEventName, …>`); the runtime check
    // catches the case where somebody widens the type to make an omission compile.
    for (const name of Object.values(PlatformEvents)) {
      expect(isCatalogedEventName(name), `${name} is not catalogued`).toBe(true);
    }
  });

  it('catalogues every HR event', () => {
    for (const name of HR_EVENT_CONSTANTS) {
      expect(isCatalogedEventName(name), `${name} is not catalogued`).toBe(true);
    }
  });

  it('catalogues every Fleet event', () => {
    for (const name of FLEET_EVENT_CONSTANTS) {
      expect(isCatalogedEventName(name), `${name} is not catalogued`).toBe(true);
    }
  });

  it('catalogues every IT event', () => {
    for (const name of IT_EVENT_CONSTANTS) {
      expect(isCatalogedEventName(name), `${name} is not catalogued`).toBe(true);
    }
  });

  it('invents nothing — every catalogued name is a declared event constant', () => {
    // An automation may only subscribe to what a publisher emits. A name in the catalogue that
    // no module declares would be a trigger that can never fire, and the workflow built on it
    // would sit enabled and silent forever.
    const declared = new Set<string>([
      ...Object.values(PlatformEvents),
      ...HR_EVENT_CONSTANTS,
      ...FLEET_EVENT_CONSTANTS,
      ...IT_EVENT_CONSTANTS,
      ...OPERATIONS_EVENT_CONSTANTS,
    ]);
    for (const name of eventCatalogNames()) {
      expect(declared.has(name), `${name} is catalogued but declared nowhere`).toBe(true);
    }
  });

  it('has no duplicate names', () => {
    const names = eventCatalogNames();
    expect(new Set(names).size).toBe(names.length);
  });

  it('is sorted by name, so the API response is stable across deploys', () => {
    const names = eventCatalogNames();
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });
});

// ── The anti-drift guarantee ────────────────────────────────────────────────

describe('generated content matches the schemas', () => {
  it('produces a sample that parses against the event′s own payload schema', () => {
    // This is the load-bearing test. The sample is built by walking the schema, so if the walker
    // ever gets a type wrong — or a publisher adds a constraint the walker cannot satisfy — the
    // sample stops parsing and this fails, instead of the UI quietly showing a bad example.
    for (const entry of EVENT_CATALOG) {
      const schema = ALL_SCHEMAS[entry.name];
      if (schema === null || schema === undefined) continue;
      const parsed = schema.safeParse(entry.sample);
      expect(parsed.success, `${entry.name}: ${JSON.stringify(entry.sample)}`).toBe(true);
    }
  });

  it('describes at least one field for every event that declares a payload', () => {
    for (const entry of EVENT_CATALOG) {
      if (!entry.payloadDeclared) continue;
      expect(entry.fields.length, `${entry.name} has no fields`).toBeGreaterThan(0);
    }
  });

  it('reports optional, nullable and enum exactly as the schema declares them', () => {
    const file = eventCatalogEntry('platform.file.uploaded');
    expect(file?.fields.find((f) => f.path === 'fileId')).toMatchObject({
      type: 'string',
      optional: false,
      nullable: false,
    });
    // `categoryId` is `.optional()` — a filter on it has to tolerate absence.
    expect(file?.fields.find((f) => f.path === 'categoryId')?.optional).toBe(true);

    const employee = eventCatalogEntry('hr.employee.created');
    // `.nullable()` is NOT the same as optional, and conflating them makes a filter wrong.
    expect(employee?.fields.find((f) => f.path === 'applicantId')).toMatchObject({
      optional: false,
      nullable: true,
    });

    const decided = eventCatalogEntry('hr.leave.decided');
    const decision = decided?.fields.find((f) => f.path === 'decision');
    expect(decision?.type).toBe('enum');
    expect(decision?.values).toEqual(['approved', 'rejected']);
  });

  it('flattens nested objects into dot paths a filter can address', () => {
    const paths = eventCatalogEntry('platform.file.uploaded')?.fields.map((f) => f.path) ?? [];
    expect(paths).toContain('entityRef');
    expect(paths).toContain('entityRef.moduleId');
  });

  it('renders dates as ISO strings, because that is what arrives over the wire', () => {
    const sample = eventCatalogEntry('hr.leave.requested')?.sample as { startDate: unknown };
    expect(typeof sample.startDate).toBe('string');
  });

  it('carries the declared schema version', () => {
    expect(eventCatalogEntry('platform.user.created')?.schemaVersion).toBe(
      EVENT_SCHEMA_VERSIONS[PlatformEvents.UserCreated],
    );
    // Module sources default to 1 — every declared payload today is a `…V1`.
    expect(eventCatalogEntry('hr.employee.created')?.schemaVersion).toBe(1);
  });
});

// ── Labels ──────────────────────────────────────────────────────────────────

describe('localization', () => {
  it('resolves every event to real vocabulary in both languages', () => {
    // The lexicon is what makes labels generated rather than hand-written. When a new event
    // introduces a word nobody has translated, THIS is what says so — otherwise the Arabic UI
    // silently starts showing English identifiers.
    const unresolved = EVENT_CATALOG.filter((entry) => !isFullyLocalized(entry.name));
    expect(unresolved.map((e) => e.name)).toEqual([]);
  });

  it('gives both languages a non-empty label and module name', () => {
    for (const entry of EVENT_CATALOG) {
      expect(entry.label.en.length, entry.name).toBeGreaterThan(0);
      expect(entry.label.ar.length, entry.name).toBeGreaterThan(0);
      expect(entry.moduleName.ar.length, entry.name).toBeGreaterThan(0);
    }
  });

  it('composes English as <entity> <action> and Arabic as <action> <entity>', () => {
    expect(eventCatalogEntry('hr.employee.created')?.label).toEqual({
      en: 'Employee created',
      ar: 'إنشاء موظف',
    });
  });

  it('uses the written-out label where the name does not decompose into prose', () => {
    // `platform.auth.loggedIn` would compose to "Authentication logged in".
    expect(eventCatalogEntry('platform.auth.loggedIn')?.label.en).toBe('Sign-in succeeded');
  });

  it('splits the name into module, entity and action', () => {
    expect(eventCatalogEntry('hr.leave.balanceAdjusted')).toMatchObject({
      moduleId: 'hr',
      entity: 'leave',
      action: 'balanceAdjusted',
    });
  });
});

// ── The builder itself ──────────────────────────────────────────────────────

describe('buildEventCatalog', () => {
  it('degrades instead of throwing when a module declares no payload schema', () => {
    // A module can ship an event before it ships a payload contract. Saying "no fields declared"
    // is honest; inventing a field list would not be, and refusing to build would take the whole
    // trigger picker down over one module's omission.
    const [entry] = buildEventCatalog({
      moduleId: 'fleet',
      schemas: { 'fleet.vehicle.assigned': null },
    });
    expect(entry?.payloadDeclared).toBe(false);
    expect(entry?.fields).toEqual([]);
    expect(entry?.sample).toBeNull();
  });

  it('falls back to a humanised label for vocabulary it does not know', () => {
    const [entry] = buildEventCatalog({
      moduleId: 'fleet',
      schemas: { 'fleet.vehicle.returnedToDepot': null },
    });
    expect(entry?.label.en).toBe('Vehicle returned to depot');
    expect(isFullyLocalized('fleet.vehicle.returnedToDepot')).toBe(false);
  });

  it('honours a per-event schema version', () => {
    const [entry] = buildEventCatalog({
      moduleId: 'fleet',
      schemas: { 'fleet.vehicle.assigned': z.object({ vehicleId: z.string() }) },
      versions: { 'fleet.vehicle.assigned': 3 },
    });
    expect(entry?.schemaVersion).toBe(3);
  });

  it('merges sources and keeps the result sorted', () => {
    const merged = buildEventCatalog(
      { moduleId: 'z', schemas: { 'z.a.created': null } },
      { moduleId: 'a', schemas: { 'a.a.created': null } },
    );
    expect(merged.map((e) => e.name)).toEqual(['a.a.created', 'z.a.created']);
  });

  it('walks arrays of objects into `field[].child` paths', () => {
    const [entry] = buildEventCatalog({
      moduleId: 'x',
      schemas: {
        'x.y.created': z.object({ lines: z.array(z.object({ sku: z.string(), qty: z.number() })) }),
      },
    });
    expect(entry?.fields.map((f) => f.path)).toEqual(['lines', 'lines[].sku', 'lines[].qty']);
  });
});

// ── The catalogue as a platform API ─────────────────────────────────────────
// Identity, versioning and machine-readable payloads: what a trigger picker, a workflow
// validator, an SDK generator, the API reference and an external integration each need before
// they can depend on this.

describe('identity', () => {
  it('gives every event a versioned id and a stable code-generation symbol', () => {
    const entry = eventCatalogEntry('platform.user.created');
    expect(entry?.id).toBe('platform.user.created@1');
    expect(entry?.typeName).toBe('PlatformUserCreatedV1');
  });

  it('keeps ids unique — an id is what an SDK symbol and a doc anchor pin', () => {
    const ids = EVENT_CATALOG.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('keeps generated type names unique and valid as identifiers', () => {
    const names = EVENT_CATALOG.map((entry) => entry.typeName);
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) expect(name).toMatch(/^[A-Z][A-Za-z0-9]*V\d+$/);
  });

  it('moves the id when the payload version moves, and not otherwise', () => {
    expect(eventTypeName('platform.user.created', 2)).toBe('PlatformUserCreatedV2');
  });
});

describe('lifecycle', () => {
  it('defaults to stable and carries no superseding name', () => {
    expect(eventCatalogEntry('platform.user.created')).toMatchObject({
      status: 'stable',
      supersededBy: null,
    });
  });

  it('marks events nobody publishes as planned, so a picker can refuse them', () => {
    // A workflow on an unpublished event is enabled and silent forever — the failure mode with no
    // error anywhere. The publisher test in `apps/api` is what keeps this list true.
    const planned = EVENT_CATALOG.filter((entry) => entry.status === 'planned');
    // FL-1 declared the whole fleet surface ahead of its publishers; FL-2.. promote each name
    // to stable as its emit site lands, so 'planned' = the two HR stragglers + unshipped fleet.
    expect(planned.map((entry) => entry.name).sort()).toEqual(
      ['hr.applicant.returnedToStage', 'hr.evaluation.opened', ...FLEET_PLANNED].sort(),
    );
  });

  it('excludes planned events from the stable list', () => {
    expect(stableEventNames()).not.toContain('hr.evaluation.opened');
    expect(stableEventNames()).not.toContain('hr.applicant.returnedToStage');
    expect(stableEventNames().length).toBe(EVENT_CATALOG.length - 2 - FLEET_PLANNED.length);
  });

  it('flags the names with a second publisher and a different payload shape', () => {
    // Filtering on a field only one publisher sends means the workflow fires for some causes and
    // not others. Recording it is what lets the UI warn instead of the user guessing.
    const divergent = EVENT_CATALOG.filter((entry) => entry.alsoPublishedBy !== null);
    expect(divergent.length).toBe(Object.keys(EVENT_MULTI_PUBLISHER).length);
    expect(eventCatalogEntry('hr.jobOffer.sent')?.alsoPublishedBy).toContain('workflow engine');
    expect(eventCatalogEntry('platform.user.created')?.alsoPublishedBy).toBeNull();
  });
});

describe('JSON Schema', () => {
  it('emits a dialect-tagged, titled schema for every declared payload', () => {
    for (const entry of EVENT_CATALOG) {
      if (!entry.payloadDeclared) continue;
      expect(entry.jsonSchema?.$schema, entry.name).toBe(JSON_SCHEMA_DIALECT);
      expect(entry.jsonSchema?.title, entry.name).toBe(entry.typeName);
      expect(entry.jsonSchema?.type, entry.name).toBe('object');
    }
  });

  it('agrees with the field list about what is required', () => {
    // Two descriptions of the same payload, generated from one schema. If they can disagree, one
    // of them is lying to whichever tool reads it.
    for (const entry of EVENT_CATALOG) {
      if (!entry.payloadDeclared) continue;
      const requiredFields = entry.fields
        .filter((field) => !field.path.includes('.') && !field.optional)
        .map((field) => field.path)
        .sort();
      expect([...(entry.jsonSchema?.required ?? [])].sort(), entry.name).toEqual(requiredFields);
    }
  });

  it('describes a nullable field as a type union, not as optional', () => {
    const applicantId =
      eventCatalogEntry('hr.employee.created')?.jsonSchema?.properties?.applicantId;
    expect(applicantId?.type).toEqual(['string', 'null']);
    expect(eventCatalogEntry('hr.employee.created')?.jsonSchema?.required).toContain('applicantId');
  });

  it('carries enums, formats and patterns a generator can act on', () => {
    const origin = eventCatalogEntry('hr.employee.created')?.jsonSchema?.properties?.origin;
    expect(origin?.enum).toEqual(['recruitment', 'direct']);

    const contractId = eventCatalogEntry('hr.contract.expired')?.jsonSchema?.properties?.contractId;
    expect(contractId?.pattern).toBe('^[0-9a-fA-F]{24}$');

    const startDate = eventCatalogEntry('hr.leave.requested')?.jsonSchema?.properties?.startDate;
    expect(startDate).toMatchObject({ type: 'string', format: 'date-time' });
  });

  it('allows unknown properties, because consumers are tolerant readers', () => {
    // ADR-008: payload schemas are parsed non-strict, so a producer may add a field without
    // breaking anyone. `additionalProperties: false` would tell an SDK the opposite.
    expect(eventCatalogEntry('platform.user.created')?.jsonSchema?.additionalProperties).toBe(true);
  });

  it('nests object properties rather than flattening them', () => {
    const entityRef =
      eventCatalogEntry('platform.file.uploaded')?.jsonSchema?.properties?.entityRef;
    expect(entityRef?.type).toBe('object');
    expect(Object.keys(entityRef?.properties ?? {})).toEqual([
      'moduleId',
      'entityType',
      'entityId',
    ]);
  });
});

describe('the published document', () => {
  it('is self-describing: version, provenance, dialect, digest, count', () => {
    const document = eventCatalogDocument();
    expect(document).toMatchObject({
      catalogVersion: EVENT_CATALOG_VERSION,
      generatedFrom: 'zod',
      jsonSchemaDialect: JSON_SCHEMA_DIALECT,
      eventCount: EVENT_CATALOG.length,
    });
    expect(document.digest).toMatch(/^[0-9a-f]{8}$/);
  });

  it('carries no timestamp — two identical deployments must serve identical bytes', () => {
    // Otherwise the digest changes on every restart and is useless as an ETag.
    expect(JSON.stringify(eventCatalogDocument())).toEqual(JSON.stringify(eventCatalogDocument()));
  });

  it('changes its digest when the surface changes, and only then', () => {
    const baseline = eventCatalogDigest();
    expect(eventCatalogDigest()).toBe(baseline);

    const [first, ...rest] = EVENT_CATALOG;
    expect(first).toBeDefined();
    expect(eventCatalogDigest(rest)).not.toBe(baseline);
  });
});

// ── Provider independence ───────────────────────────────────────────────────

describe('the catalogue is a platform surface', () => {
  it('mentions no automation provider anywhere in its output', () => {
    // The catalogue predates the automation engine conceptually and must outlive any provider
    // choice: it describes what ECMS emits, not what any runtime consumes.
    expect(JSON.stringify(EVENT_CATALOG)).not.toMatch(/n8n|temporal|camunda|zapier/i);
  });
});
