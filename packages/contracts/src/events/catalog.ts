// The event catalogue — the canonical list of what an automation can trigger on
// (ADR-018 · automation-module-design §3.3). Served by `GET /api/v1/automation/events`.
//
// GENERATED, NOT MAINTAINED. Every field description and every sample payload below is derived by
// walking the Zod payload schemas the publishers already declare, so the catalogue cannot describe
// a field that is not really emitted. A hand-written catalogue is correct on the day it is written
// and wrong after the next payload change — and wrong SILENTLY, because nothing downstream notices.
//
// The one thing a human writes is the name → schema link. Each link table is typed
// `Record<<EventName union>, …>`, so adding an event constant without cataloguing it is a compile
// error, not an omission someone discovers in production six months later.
//
// Nothing here is automation-specific or provider-specific. This is a platform surface; automation
// is simply its first consumer.
import type { z } from 'zod';
import type { LocalizedString } from '../common/localized.js';
import {
  EVENT_SCHEMA_VERSIONS,
  PlatformEvents,
  type PlatformEventName,
  AuditAlertRaisedPayloadV1,
  AuthEventPayloadV1,
  FileEventPayloadV1,
  FileProcessorEventPayloadV1,
  NotificationCreatedPayloadV1,
  NotificationDeliveryFailedPayloadV1,
  OrganizationUpdatedPayloadV1,
  OrgUnitChangedPayloadV1,
  RoleAssignmentChangedPayloadV1,
  RoleChangedPayloadV1,
  SettingsChangedPayloadV1,
  UserEventPayloadV1,
} from './index.js';
import {
  HrEvents,
  type HrEventName,
  ApplicantEventPayloadV1,
  ApplicantRejectedPayloadV1,
  ApplicantWithdrawnPayloadV1,
} from '../modules/hr-recruitment.js';
import {
  HrRecruitmentWorkflowEvents,
  HrWorkflowEngineEvents,
  type HrRecruitmentWorkflowEventName,
  type HrWorkflowEngineEventName,
  ApplicantHiredPayloadV1,
  PlacementChangedPayloadV1,
  ReturnedToStagePayloadV1,
  WorkflowTransitionPayloadV1,
} from '../modules/hr-recruitment-workflow.js';
import {
  HrScreeningEvents,
  type HrScreeningEventName,
  ScreeningCreatedPayloadV1,
  ScreeningDecidedPayloadV1,
} from '../modules/hr-screening.js';
import {
  HrInterviewEvents,
  type HrInterviewEventName,
  InterviewDecidedPayloadV1,
  InterviewEventPayloadV1,
  InterviewStartedPayloadV1,
} from '../modules/hr-interview.js';
import {
  HrEvaluationEvents,
  type HrEvaluationEventName,
  EvaluationDecidedPayloadV1,
  EvaluationOpenedPayloadV1,
} from '../modules/hr-evaluation.js';
import {
  HrEvaluationBatchEvents,
  type HrEvaluationBatchEventName,
  EvaluationBatchEventPayloadV1,
  EvaluationBatchPackagePayloadV1,
  EvaluationBatchReturnedPayloadV1,
} from '../modules/hr-evaluation-batch.js';
import {
  HrOfferEvents,
  type HrOfferEventName,
  JobOfferEventPayloadV1,
} from '../modules/hr-job-offer.js';
import {
  HrEmployeeEvents,
  type HrEmployeeEventName,
  EmployeeActionAppliedPayloadV1,
  EmployeeCreatedPayloadV1,
  EmployeeExitedPayloadV1,
  EmployeeLoginLinkedPayloadV1,
  EmployeeRehiredPayloadV1,
  EmployeeStatusChangedPayloadV1,
  EmployeeTransferredPayloadV1,
} from '../modules/hr-employee.js';
import {
  HrEmployeeFileEvents,
  type HrEmployeeFileEventName,
  EmployeeFileEventPayloadV1,
} from '../modules/hr-employee-file.js';
import {
  HrHiringDocumentsEvents,
  type HrHiringDocumentsEventName,
  HiringDocumentsEventPayloadV1,
} from '../modules/hr-hiring-documents.js';
import {
  HrLeaveEvents,
  type HrLeaveEventName,
  LeaveBalanceAdjustedPayloadV1,
  LeaveCancelledPayloadV1,
  LeaveDecidedPayloadV1,
  LeaveRequestedPayloadV1,
  LeaveSpanPayloadV1,
} from '../modules/hr-leave.js';
import {
  HrAttendanceEvents,
  type HrAttendanceEventName,
  AttendanceDayPayloadV1,
  AttendanceOvertimeApprovedPayloadV1,
  AttendancePeriodFrozenPayloadV1,
  AttendancePunchRecordedPayloadV1,
  AttendancePunchesImportedPayloadV1,
  AttendanceRegularizationDecidedPayloadV1,
  AttendanceRegularizationRequestedPayloadV1,
} from '../modules/hr-attendance.js';
import {
  HrPayrollEvents,
  type HrPayrollEventName,
  PayrollAdjustmentDecidedPayloadV1,
  PayrollAdjustmentSubmittedPayloadV1,
  PayrollRunLifecyclePayloadV1,
} from '../modules/hr-payroll.js';
import {
  HrEmployeeLoanEvents,
  type HrEmployeeLoanEventName,
  EmployeeLoanDecidedPayloadV1,
  EmployeeLoanDisbursedPayloadV1,
  EmployeeLoanSubmittedPayloadV1,
} from '../modules/hr-employee-loans.js';
import {
  HrContractEvents,
  type HrContractEventName,
  ContractApprovalDecidedPayloadV1,
  ContractEventPayloadV1,
  ContractGeneratedPayloadV1,
  ContractSupersededPayloadV1,
  ContractTerminatedPayloadV1,
} from '../modules/hr-contract.js';
import {
  FleetEvents,
  type FleetEventName,
  FleetAccidentPayloadV1,
  FleetAssignmentChangedPayloadV1,
  FleetGrievanceAppliedPayloadV1,
  FleetLicenseExpiryPayloadV1,
  FleetMaintenanceAlarmPayloadV1,
  FleetMaintenancePayloadV1,
  FleetOdometerCorrectedPayloadV1,
  FleetOdometerRecordedPayloadV1,
  FleetRosterPlannedPayloadV1,
  FleetUnavailabilityPayloadV1,
  FleetVehicleEventPayloadV1,
  FleetVehicleStatusChangedPayloadV1,
  FleetViolationRecordedPayloadV1,
} from '../modules/fleet.js';
import {
  ItEvents,
  type ItEventName,
  ItAssetEventPayloadV1,
  ItAssetAssignedPayloadV1,
  ItAssetReturnedPayloadV1,
  ItAssetTransferredPayloadV1,
  ItAssetDisposedPayloadV1,
  ItTicketOpenedPayloadV1,
  ItTicketAssignedPayloadV1,
  ItTicketStatusChangedPayloadV1,
  ItTicketSlaBreachedPayloadV1,
  ItMaintenanceOrderCreatedPayloadV1,
  ItMaintenanceOrderCompletedPayloadV1,
  ItSparePartBelowMinPayloadV1,
  ItAssetWarrantyExpiringPayloadV1,
  ItAssetWarrantyExpiredPayloadV1,
  ItLicenseExpiringPayloadV1,
  ItLicenseExpiredPayloadV1,
  ItLicenseSeatsExceededPayloadV1,
} from '../modules/it.js';
import {
  OperationsEvents,
  type OperationsEventName,
  OperationsCrewAssignmentChangedPayloadV1,
  OperationsCrewPlannedPayloadV1,
  OperationsCustodyEventPayloadV1,
  OperationsDayEventPayloadV1,
  OperationsShipmentAssignmentPayloadV1,
  OperationsShipmentEventPayloadV1,
  OperationsShipmentExecutionPayloadV1,
  OperationsShipmentReorderedPayloadV1,
} from '../modules/operations.js';

// ── The shape a consumer sees ───────────────────────────────────────────────

export const EVENT_FIELD_TYPES = [
  'string',
  'number',
  'boolean',
  'date',
  'enum',
  'object',
  'array',
  'record',
  'unknown',
] as const;
export type EventFieldType = (typeof EVENT_FIELD_TYPES)[number];

export interface EventPayloadField {
  /** Dot path from the payload root; array elements are addressed as `items[].name`. */
  path: string;
  type: EventFieldType;
  /** The publisher may omit it — a trigger filter on this field must tolerate its absence. */
  optional: boolean;
  nullable: boolean;
  /** Present only for `enum`: the exact set a filter may compare against. */
  values?: readonly string[];
}

export const EVENT_STATUSES = [
  /** Published today. Safe to build a workflow, an SDK client or a document on. */
  'stable',
  /** Declared, but nothing publishes it yet. A workflow triggering on it would never fire. */
  'planned',
  /** Still published, scheduled for removal. `supersededBy` names what to move to. */
  'deprecated',
] as const;
export type EventStatus = (typeof EVENT_STATUSES)[number];

export interface EventCatalogEntry {
  /**
   * The versioned identity: `<name>@<schemaVersion>`. This is what an SDK symbol, a
   * documentation anchor or an external integration pins, and it is stable for as long as the
   * payload shape is. `name` alone identifies the FACT; `id` identifies the fact in one shape.
   */
  id: string;
  /**
   * The permanent identity. Names are added to, never renamed — a rename would silently stop
   * every workflow subscribed to the old one, with no error anywhere.
   */
  name: string;
  moduleId: string;
  /** Second segment of the name (`platform.user.created` → `user`). */
  entity: string;
  /** Third segment of the name (`platform.user.created` → `created`). */
  action: string;
  schemaVersion: number;
  status: EventStatus;
  /** Set only when `status === 'deprecated'` — the event name to migrate to. */
  supersededBy: string | null;
  /**
   * Non-null when a second publisher emits this name with a DIFFERENT payload shape. `fields`
   * describes the module-declared shape; a filter on a field the other publisher does not send
   * will silently fail to match it.
   */
  alsoPublishedBy: string | null;
  /** Stable code-generation symbol, e.g. `PlatformUserCreatedV1`. Derived, never hand-picked. */
  typeName: string;
  label: LocalizedString;
  /** Longer prose where the label is not enough. Optional by design — see §Descriptions. */
  description: LocalizedString | null;
  moduleName: LocalizedString;
  /**
   * `false` when the owning module has not declared a payload schema. The event can still be
   * triggered on; it just cannot be FILTERED on, and saying so beats inventing a field list.
   */
  payloadDeclared: boolean;
  /** Flattened, for filter builders and validation. */
  fields: EventPayloadField[];
  /**
   * The same payload as JSON Schema (2020-12), for SDK generation, OpenAPI/AsyncAPI components
   * and any consumer that does not speak Zod. Generated from the same schema as `fields`, so the
   * two cannot disagree.
   */
  jsonSchema: JsonSchemaNode | null;
  /** A JSON-shaped example, generated from the schema and verified to parse against it. */
  sample: unknown;
}

/** One module's contribution: event name → declared payload schema (`null` when none). */
export interface EventCatalogSource {
  moduleId: string;
  schemas: Readonly<Record<string, z.ZodTypeAny | null>>;
  /** Payload schema version per event. Defaults to 1 — every declared payload today is `…V1`. */
  versions?: Readonly<Record<string, number>>;
}

// ── Zod introspection ───────────────────────────────────────────────────────
// Zod 3 exposes its structure through `_def`; this is the only place in the codebase that reaches
// for it, and it is deliberately defensive — an unrecognised node degrades to `unknown` rather
// than throwing, because a catalogue that fails to build takes the whole trigger picker down.

interface ZodCheck {
  kind: string;
  value?: number;
  regex?: RegExp;
}

interface ZodDefLike {
  typeName?: string;
  innerType?: z.ZodTypeAny;
  schema?: z.ZodTypeAny;
  type?: z.ZodTypeAny;
  values?: readonly string[];
  checks?: readonly ZodCheck[];
  valueType?: z.ZodTypeAny;
  value?: unknown;
}

const defOf = (schema: z.ZodTypeAny): ZodDefLike => schema._def as unknown as ZodDefLike;

/** Wrappers that carry no shape of their own — peel them off, remembering what they mean. */
const unwrap = (
  schema: z.ZodTypeAny,
): { inner: z.ZodTypeAny; optional: boolean; nullable: boolean } => {
  let inner = schema;
  let optional = false;
  let nullable = false;

  for (let guard = 0; guard < 20; guard += 1) {
    const def = defOf(inner);
    switch (def.typeName) {
      // A defaulted field is optional ON THE WIRE, which is what a filter author needs to know.
      case 'ZodOptional':
      case 'ZodDefault':
      case 'ZodCatch':
        optional = optional || def.typeName !== 'ZodCatch';
        if (def.innerType === undefined) return { inner, optional, nullable };
        inner = def.innerType;
        break;
      case 'ZodNullable':
        nullable = true;
        if (def.innerType === undefined) return { inner, optional, nullable };
        inner = def.innerType;
        break;
      case 'ZodReadonly':
        if (def.innerType === undefined) return { inner, optional, nullable };
        inner = def.innerType;
        break;
      case 'ZodEffects':
        if (def.schema === undefined) return { inner, optional, nullable };
        inner = def.schema;
        break;
      default:
        return { inner, optional, nullable };
    }
  }
  return { inner, optional, nullable };
};

const FIELD_TYPE_BY_ZOD: Readonly<Record<string, EventFieldType>> = {
  ZodString: 'string',
  ZodNumber: 'number',
  ZodBigInt: 'number',
  ZodBoolean: 'boolean',
  ZodDate: 'date',
  ZodEnum: 'enum',
  ZodNativeEnum: 'enum',
  ZodObject: 'object',
  ZodArray: 'array',
  ZodRecord: 'record',
  ZodMap: 'record',
};

const shapeOf = (schema: z.ZodTypeAny): Record<string, z.ZodTypeAny> =>
  (schema as unknown as { shape: Record<string, z.ZodTypeAny> }).shape;

const describeField = (schema: z.ZodTypeAny, path: string): EventPayloadField[] => {
  const { inner, optional, nullable } = unwrap(schema);
  const def = defOf(inner);
  const type = FIELD_TYPE_BY_ZOD[def.typeName ?? ''] ?? 'unknown';
  const values = type === 'enum' && def.values !== undefined ? [...def.values] : undefined;
  const self: EventPayloadField = {
    path,
    type,
    optional,
    nullable,
    ...(values === undefined ? {} : { values }),
  };

  if (type === 'object') {
    const children = Object.entries(shapeOf(inner)).flatMap(([key, child]) =>
      describeField(child, path === '' ? key : `${path}.${key}`),
    );
    // The root object is the payload itself, not a field of it.
    return path === '' ? children : [self, ...children];
  }

  if (type === 'array' && def.type !== undefined) {
    const element = unwrap(def.type);
    if (defOf(element.inner).typeName === 'ZodObject') {
      const children = Object.entries(shapeOf(element.inner)).flatMap(([key, child]) =>
        describeField(child, `${path}[].${key}`),
      );
      return [self, ...children];
    }
  }

  return [self];
};

// Ordered so the first candidate that a schema accepts is also the most readable one: a plain
// string gets `example`, an ObjectId gets a hex id, an email gets an address. Guessing from the
// field NAME would be wrong the moment a field is renamed; asking the schema cannot be.
const STRING_CANDIDATES = [
  'example',
  // A three-letter currency (`MoneyCurrencySchema`), which no other candidate satisfies — `example`
  // is seven characters and `a` is one. It sits here rather than being special-cased by field name
  // for the reason above: the schema is asked, not the identifier. P-HR-07 was the first payload to
  // carry money, and any later one gets a readable sample for free.
  'EGP',
  '000000000000000000000000',
  'user@example.com',
  '2026-01-01',
  // A payroll MONTH (`YYYY-MM`) — the period a payroll adjustment names and the month a loan's
  // first instalment falls in. It goes after the full date so a date field still samples as one.
  '2026-01',
  'a',
] as const;
const SAMPLE_INSTANT = '2026-01-01T09:00:00.000Z';

const sampleFor = (schema: z.ZodTypeAny): unknown => {
  const { inner } = unwrap(schema);
  const def = defOf(inner);

  switch (def.typeName) {
    case 'ZodString':
      return STRING_CANDIDATES.find((c) => inner.safeParse(c).success) ?? 'example';
    case 'ZodNumber':
    case 'ZodBigInt':
      return 1;
    case 'ZodBoolean':
      return true;
    case 'ZodDate':
      // Payloads travel as JSON, so the sample shows what actually arrives: an ISO string.
      return SAMPLE_INSTANT;
    case 'ZodEnum':
    case 'ZodNativeEnum':
      return def.values?.[0] ?? null;
    case 'ZodObject':
      return Object.fromEntries(
        Object.entries(shapeOf(inner)).map(([key, child]) => [key, sampleFor(child)]),
      );
    case 'ZodArray':
      return def.type === undefined ? [] : [sampleFor(def.type)];
    case 'ZodRecord':
    case 'ZodMap':
      return {};
    case 'ZodLiteral':
      return (def as unknown as { value: unknown }).value;
    default:
      return null;
  }
};

// ── JSON Schema ─────────────────────────────────────────────────────────────
// The interchange format every consumer outside this repository speaks: SDK generators, OpenAPI
// and AsyncAPI components, documentation renderers, contract-testing tools. Emitted from the same
// Zod schema the field list comes from, so the two descriptions of a payload cannot disagree.
//
// Written by hand rather than pulled from `zod-to-json-schema` on purpose: `@ecms/contracts` has
// exactly one dependency, and it is imported by the browser bundle. A converter for the handful of
// Zod nodes payloads actually use is ~80 lines and adds nothing to ship.

export interface JsonSchemaNode {
  $schema?: string;
  title?: string;
  type?: string | string[];
  format?: string;
  const?: unknown;
  enum?: readonly string[];
  properties?: Record<string, JsonSchemaNode>;
  required?: string[];
  additionalProperties?: boolean | JsonSchemaNode;
  items?: JsonSchemaNode;
  pattern?: string;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
}

export const JSON_SCHEMA_DIALECT = 'https://json-schema.org/draft/2020-12/schema';

const checkOf = (def: ZodDefLike, kind: string): ZodCheck | undefined =>
  def.checks?.find((c) => c.kind === kind);

const stringNode = (def: ZodDefLike): JsonSchemaNode => {
  const node: JsonSchemaNode = { type: 'string' };
  const min = checkOf(def, 'min')?.value;
  const max = checkOf(def, 'max')?.value;
  const pattern = checkOf(def, 'regex')?.regex?.source;
  if (min !== undefined) node.minLength = min;
  if (max !== undefined) node.maxLength = max;
  if (pattern !== undefined) node.pattern = pattern;
  if (checkOf(def, 'email') !== undefined) node.format = 'email';
  if (checkOf(def, 'uuid') !== undefined) node.format = 'uuid';
  return node;
};

const numberNode = (def: ZodDefLike): JsonSchemaNode => {
  const node: JsonSchemaNode = { type: checkOf(def, 'int') === undefined ? 'number' : 'integer' };
  const min = checkOf(def, 'min')?.value;
  const max = checkOf(def, 'max')?.value;
  if (min !== undefined) node.minimum = min;
  if (max !== undefined) node.maximum = max;
  return node;
};

const withNull = (node: JsonSchemaNode, nullable: boolean): JsonSchemaNode => {
  if (!nullable || node.type === undefined) return node;
  return { ...node, type: Array.isArray(node.type) ? [...node.type, 'null'] : [node.type, 'null'] };
};

const toJsonSchemaNode = (schema: z.ZodTypeAny): JsonSchemaNode => {
  const { inner, nullable } = unwrap(schema);
  const def = defOf(inner);

  switch (def.typeName) {
    case 'ZodString':
      return withNull(stringNode(def), nullable);
    case 'ZodNumber':
    case 'ZodBigInt':
      return withNull(numberNode(def), nullable);
    case 'ZodBoolean':
      return withNull({ type: 'boolean' }, nullable);
    case 'ZodDate':
      // Payloads travel as JSON. A consumer generating a client sees the wire type, not `Date`.
      return withNull({ type: 'string', format: 'date-time' }, nullable);
    case 'ZodEnum':
    case 'ZodNativeEnum':
      return withNull({ type: 'string', enum: [...(def.values ?? [])] }, nullable);
    case 'ZodLiteral':
      return withNull({ const: def.value }, nullable);
    case 'ZodObject': {
      const shape = shapeOf(inner);
      const properties: Record<string, JsonSchemaNode> = {};
      const required: string[] = [];
      for (const [key, child] of Object.entries(shape)) {
        properties[key] = toJsonSchemaNode(child);
        if (!unwrap(child).optional) required.push(key);
      }
      return withNull(
        {
          type: 'object',
          properties,
          ...(required.length === 0 ? {} : { required }),
          // Consumers are tolerant readers (ADR-008): payload schemas are parsed non-strict, so a
          // producer may add a field without breaking anyone. Emitting `false` here would tell an
          // SDK generator the opposite of how the bus actually behaves.
          additionalProperties: true,
        },
        nullable,
      );
    }
    case 'ZodArray':
      return withNull(
        { type: 'array', ...(def.type === undefined ? {} : { items: toJsonSchemaNode(def.type) }) },
        nullable,
      );
    case 'ZodRecord':
    case 'ZodMap':
      return withNull(
        {
          type: 'object',
          additionalProperties:
            def.valueType === undefined ? true : toJsonSchemaNode(def.valueType),
        },
        nullable,
      );
    default:
      // `z.unknown()` / `z.any()` / an unrecognised node: an empty schema accepts anything, which
      // is exactly what the Zod side does. Never emit a guess.
      return {};
  }
};

// ── Labels ──────────────────────────────────────────────────────────────────
// The structure of the catalogue is generated; its WORDS cannot be, because Arabic does not fall
// out of an English identifier. What is generated is the COMPOSITION: a lexicon of entities and a
// lexicon of actions, each translated once, combined per event exactly the way `declarePermissions`
// combines an action with a resource. A new event usually needs no new vocabulary at all, and the
// drift test fails if it does and nobody added it.
//
// Word order differs by language on purpose: English reads `<entity> <action>` ("Employee hired"),
// Arabic reads `<action> <entity>` ("تعيين موظف").

export const EVENT_MODULE_NAMES: Readonly<Record<string, LocalizedString>> = {
  platform: { en: 'Platform', ar: 'المنصة' },
  hr: { en: 'Human Resources', ar: 'الموارد البشرية' },
  automation: { en: 'Automation', ar: 'الأتمتة' },
  fleet: { en: 'Fleet', ar: 'الحركة' },
  it: { en: 'IT', ar: 'تقنية المعلومات' },
  operations: { en: 'Operations', ar: 'العمليات' },
};

export const EVENT_ENTITY_NAMES: Readonly<Record<string, LocalizedString>> = {
  // platform
  user: { en: 'User', ar: 'مستخدم' },
  auth: { en: 'Authentication', ar: 'المصادقة' },
  role: { en: 'Role', ar: 'دور' },
  roleAssignment: { en: 'Role assignment', ar: 'إسناد دور' },
  organization: { en: 'Organization', ar: 'المؤسسة' },
  orgUnit: { en: 'Organizational unit', ar: 'وحدة تنظيمية' },
  settings: { en: 'Settings', ar: 'الإعدادات' },
  file: { en: 'File', ar: 'ملف' },
  audit: { en: 'Audit', ar: 'التدقيق' },
  notification: { en: 'Notification', ar: 'إشعار' },
  // hr
  applicant: { en: 'Applicant', ar: 'متقدم' },
  recruitment: { en: 'Recruitment pipeline', ar: 'مسار التوظيف' },
  screening: { en: 'Screening', ar: 'الفرز' },
  interview: { en: 'Interview', ar: 'مقابلة' },
  evaluation: { en: 'Evaluation', ar: 'تقييم' },
  evaluationBatch: { en: 'Evaluation batch', ar: 'دفعة تقييم' },
  jobOffer: { en: 'Job offer', ar: 'عرض وظيفي' },
  employee: { en: 'Employee', ar: 'موظف' },
  employeeFile: { en: 'Employee file', ar: 'ملف موظف' },
  hiringDocuments: { en: 'Hiring documents', ar: 'مستندات التعيين' },
  leave: { en: 'Leave', ar: 'إجازة' },
  attendance: { en: 'Attendance', ar: 'حضور' },
  // P-HR-07. `payroll` is the subject of an adjustment decision, and `employeeLoan` is its own
  // subject rather than an action on the employee — a debt outlives any one month, which is the
  // same reasoning that gave `assetWarranty` an entity of its own below.
  payroll: { en: 'Payroll', ar: 'الرواتب' },
  employeeLoan: { en: 'Employee loan', ar: 'قرض موظف' },
  contract: { en: 'Contract', ar: 'عقد' },
  // fleet
  vehicle: { en: 'Vehicle', ar: 'سيارة' },
  odometer: { en: 'Odometer', ar: 'عداد المسافة' },
  maintenance: { en: 'Maintenance visit', ar: 'زيارة صيانة' },
  maintenanceAlarm: { en: 'Maintenance alarm', ar: 'إنذار صيانة' },
  vehicleLicense: { en: 'Vehicle license', ar: 'رخصة سيارة' },
  driverLicense: { en: 'Driving license', ar: 'رخصة قيادة' },
  roster: { en: 'Duty roster', ar: 'تعيين اليوم' },
  assignment: { en: 'Duty assignment', ar: 'تكليف' },
  driverUnavailability: { en: 'Driver unavailability', ar: 'عدم إتاحة سائق' },
  accident: { en: 'Accident', ar: 'حادث' },
  violation: { en: 'Violation', ar: 'مخالفة' },
  // it
  asset: { en: 'Asset', ar: 'أصل' },
  ticket: { en: 'Ticket', ar: 'تذكرة' },
  // NOT `maintenance` — that key is Fleet's "Maintenance visit". An IT maintenance ORDER is a
  // different thing, so it gets its own entity rather than borrowing a word (§17 naming note).
  maintenanceOrder: { en: 'Maintenance order', ar: 'أمر صيانة' },
  sparePart: { en: 'Spare part', ar: 'قطعة غيار' },
  // The warranty is its own subject, not an action on the asset (§17). Giving it an entity is
  // what lets both of its events reuse `expiring` / `expired` below.
  assetWarranty: { en: 'Asset warranty', ar: 'ضمان أصل' },
  // Bare `license` is free: Fleet's two are `vehicleLicense` and `driverLicense`, and neither
  // means a software entitlement.
  license: { en: 'Software license', ar: 'ترخيص برمجي' },

  // operations (OP-2/OP-3): the cash shipment, the operating day, and the cash crew.
  shipment: { en: 'Shipment', ar: 'شحنة' },
  day: { en: 'Operating day', ar: 'يوم التشغيل' },
  crew: { en: 'Crew', ar: 'الطاقم' },
  crewAssignment: { en: 'Crew assignment', ar: 'تعيين طاقم' },
  custody: { en: 'Vault custody', ar: 'عهدة الخزينة' },
  shipmentAssignment: { en: 'Shipment assignment', ar: 'تعيين شحنة' },
};

export const EVENT_ACTION_NAMES: Readonly<Record<string, LocalizedString>> = {
  created: { en: 'created', ar: 'إنشاء' },
  updated: { en: 'updated', ar: 'تعديل' },
  deleted: { en: 'deleted', ar: 'حذف' },
  changed: { en: 'changed', ar: 'تغيير' },
  statusChanged: { en: 'status changed', ar: 'تغيير حالة' },
  archived: { en: 'archived', ar: 'أرشفة' },
  restored: { en: 'restored', ar: 'استعادة' },
  uploaded: { en: 'uploaded', ar: 'رفع' },
  thumbnailCreated: { en: 'thumbnail created', ar: 'إنشاء مصغّرة' },
  virusScanCompleted: { en: 'virus scan completed', ar: 'اكتمال فحص الفيروسات' },
  deliveryFailed: { en: 'delivery failed', ar: 'فشل تسليم' },
  // recruitment
  identityVerified: { en: 'identity verified', ar: 'توثيق هوية' },
  withdrawn: { en: 'withdrawn', ar: 'سحب' },
  rejected: { en: 'rejected', ar: 'رفض' },
  approved: { en: 'approved', ar: 'اعتماد' },
  movedToOffer: { en: 'moved to job offer', ar: 'نقل إلى العرض الوظيفي' },
  placementChanged: { en: 'placement changed', ar: 'تغيير التعيين' },
  returnedToStage: { en: 'returned to an earlier stage', ar: 'إرجاع إلى مرحلة سابقة' },
  hired: { en: 'hired', ar: 'تعيين' },
  reactivated: { en: 'reactivated', ar: 'إعادة تنشيط' },
  stageEntered: { en: 'stage entered', ar: 'دخول مرحلة' },
  stageLeft: { en: 'stage left', ar: 'مغادرة مرحلة' },
  redecided: { en: 'decision reversed', ar: 'عكس القرار' },
  reopened: { en: 'reopened', ar: 'إعادة فتح' },
  superseded: { en: 'superseded', ar: 'استبدال' },
  decided: { en: 'decided', ar: 'البت في' },
  opened: { en: 'opened', ar: 'فتح' },
  scheduled: { en: 'scheduled', ar: 'جدولة' },
  rescheduled: { en: 'rescheduled', ar: 'إعادة جدولة' },
  started: { en: 'started', ar: 'بدء' },
  cancelled: { en: 'cancelled', ar: 'إلغاء' },
  evaluated: { en: 'evaluated', ar: 'تقييم' },
  completed: { en: 'completed', ar: 'إتمام' },
  issued: { en: 'issued', ar: 'إصدار' },
  generated: { en: 'generated', ar: 'توليد' },
  packageReady: { en: 'package ready', ar: 'جاهزية الحزمة' },
  packageFailed: { en: 'package failed', ar: 'فشل الحزمة' },
  returned: { en: 'returned', ar: 'إرجاع' },
  closed: { en: 'closed', ar: 'إغلاق' },
  revised: { en: 'revised', ar: 'مراجعة' },
  sent: { en: 'sent', ar: 'إرسال' },
  accepted: { en: 'accepted', ar: 'قبول' },
  expired: { en: 'expired', ar: 'انتهاء صلاحية' },
  // employee
  actionApplied: { en: 'personnel action applied', ar: 'تنفيذ إجراء وظيفي' },
  transferred: { en: 'transferred', ar: 'نقل' },
  exited: { en: 'exited', ar: 'إنهاء خدمة' },
  rehired: { en: 'rehired', ar: 'إعادة تعيين' },
  loginLinked: { en: 'login linked', ar: 'ربط حساب دخول' },
  noteAdded: { en: 'note added', ar: 'إضافة ملاحظة' },
  documentUploaded: { en: 'document uploaded', ar: 'رفع مستند' },
  documentReplaced: { en: 'document replaced', ar: 'استبدال مستند' },
  // leave + contract
  requested: { en: 'requested', ar: 'طلب' },
  ended: { en: 'ended', ar: 'انتهاء' },
  balanceAdjusted: { en: 'balance adjusted', ar: 'تسوية رصيد' },
  // attendance
  punchRecorded: { en: 'punch recorded', ar: 'تسجيل بصمة' },
  punchesImported: { en: 'punches imported', ar: 'استيراد بصمات' },
  dayComputed: { en: 'day computed', ar: 'احتساب يوم' },
  dayAbsent: { en: 'absence recorded', ar: 'تسجيل غياب' },
  periodFrozen: { en: 'period frozen', ar: 'تجميد فترة' },
  regularizationRequested: { en: 'regularization requested', ar: 'طلب تسوية' },
  regularizationDecided: { en: 'regularization decided', ar: 'البت في تسوية' },
  overtimeApproved: { en: 'overtime approved', ar: 'اعتماد عمل إضافي' },
  approvalRequested: { en: 'approval requested', ar: 'طلب اعتماد' },
  approvalDecided: { en: 'approval decided', ar: 'البت في اعتماد' },
  signed: { en: 'signed', ar: 'توقيع' },
  amended: { en: 'amended', ar: 'تعديل' },
  renewed: { en: 'renewed', ar: 'تجديد' },
  terminated: { en: 'terminated', ar: 'إنهاء' },
  // payroll decisions + employee loans (P-HR-07)
  adjustmentSubmitted: { en: 'adjustment submitted', ar: 'إرسال مؤثر للاعتماد' },
  adjustmentDecided: { en: 'adjustment decided', ar: 'البت في مؤثر' },
  // P-HR-16 — the RUN's lifecycle. Compound actions, because the entity these hang off is
  // `payroll` (the same one the adjustment decisions use) and "frozen" alone would not say what
  // was frozen — attendance already freezes a period, and that is a different fact.
  runFrozen: { en: 'run frozen', ar: 'تجميد دورة رواتب' },
  runApproved: { en: 'run approved', ar: 'اعتماد دورة رواتب' },
  runPaid: { en: 'run recorded as paid', ar: 'تسجيل صرف دورة رواتب' },
  submitted: { en: 'submitted', ar: 'إرسال للاعتماد' },
  // The word is deliberately about MONEY LEAVING, not about a status: ECMS pays nobody, and this
  // records that a payment happened elsewhere — which is also the moment instalments begin.
  disbursed: { en: 'paid out', ar: 'صرف' },
  // fleet
  recorded: { en: 'recorded', ar: 'تسجيل' },
  corrected: { en: 'corrected', ar: 'تصحيح' },
  checkedIn: { en: 'checked in', ar: 'دخول' },
  checkedOut: { en: 'checked out', ar: 'خروج' },
  raised: { en: 'raised', ar: 'رفع' },
  expiring: { en: 'expiring soon', ar: 'قرب انتهاء' },
  planned: { en: 'planned', ar: 'تخطيط' },
  grievanceApplied: { en: 'grievance applied', ar: 'تطبيق تظلم' },
  // it
  registered: { en: 'registered', ar: 'تسجيل' },
  assigned: { en: 'assigned', ar: 'تسليم' },
  // operations (OP-4): the vault hand-offs and the secured dispatch.
  received: { en: 'received', ar: 'استلام' },
  released: { en: 'released', ar: 'صرف' },
  dispatched: { en: 'dispatched', ar: 'خروج' },
  reordered: { en: 'reordered', ar: 'إعادة ترتيب' },
  // operations (OP-7): the captain's execution steps. `started` and `completed` are already in this
  // vocabulary and mean exactly what execution means by them — reused, not duplicated.
  pickedUp: { en: 'picked up', ar: 'استلام من المصدر' },
  delivered: { en: 'delivered', ar: 'توصيل' },
  disposed: { en: 'disposed', ar: 'استبعاد' },
  // `opened` is already defined above (recruitment uses it) — one entry serves both modules,
  // which is the point of a shared action vocabulary.
  slaBreached: { en: 'SLA breached', ar: 'تجاوز زمن الاستجابة' },
  // `created` and `completed` are already in this vocabulary and mean exactly what IT-4 means by
  // them — reused, not duplicated. Only the stock warning needs a new word.
  belowMin: { en: 'below minimum', ar: 'تحت الحد الأدنى' },
  // `expiring` and `expired` are already in this vocabulary — Fleet's licenses use both, and they
  // mean exactly what IT-5 means. Only the seat warning needs a word of its own.
  seatsExceeded: { en: 'seats exceeded', ar: 'تجاوز عدد المقاعد' },
};

/**
 * Events whose name does not decompose into readable prose. `platform.auth.loggedIn` would
 * compose to "Authentication logged in"; these six are written out instead of contorting the
 * lexicon to accommodate them.
 */
export const EVENT_LABEL_OVERRIDES: Readonly<Record<string, LocalizedString>> = {
  [PlatformEvents.AuthLoggedIn]: { en: 'Sign-in succeeded', ar: 'نجاح تسجيل الدخول' },
  [PlatformEvents.AuthLoginFailed]: { en: 'Sign-in failed', ar: 'فشل تسجيل الدخول' },
  [PlatformEvents.AuthSessionRevoked]: { en: 'Session revoked', ar: 'إلغاء جلسة' },
  [PlatformEvents.AuthRefreshReuseDetected]: {
    en: 'Refresh-token reuse detected',
    ar: 'اكتشاف إعادة استخدام رمز التحديث',
  },
  [PlatformEvents.OcrCompleted]: {
    en: 'File OCR completed',
    ar: 'اكتمال التعرّف الضوئي على ملف',
  },
  [PlatformEvents.AuditAlertRaised]: { en: 'Security alert raised', ar: 'رفع تنبيه أمني' },
};

/** `refreshReuseDetected` → `refresh reuse detected`; the last-resort label for both languages. */
const humanize = (token: string): string =>
  token
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .trim();

const capitalize = (text: string): string =>
  text.length === 0 ? text : `${text[0]?.toUpperCase() ?? ''}${text.slice(1)}`;

const labelFor = (name: string, entity: string, action: string): LocalizedString => {
  const override = EVENT_LABEL_OVERRIDES[name];
  if (override !== undefined) return override;

  const entityName = EVENT_ENTITY_NAMES[entity] ?? {
    en: capitalize(humanize(entity)),
    ar: capitalize(humanize(entity)),
  };
  const actionName = EVENT_ACTION_NAMES[action] ?? {
    en: humanize(action),
    ar: humanize(action),
  };
  return {
    en: `${entityName.en} ${actionName.en}`.trim(),
    ar: `${actionName.ar} ${entityName.ar}`.trim(),
  };
};

/** True when every segment of the name resolved to real vocabulary — the drift test asserts it. */
export const isFullyLocalized = (name: string): boolean => {
  if (EVENT_LABEL_OVERRIDES[name] !== undefined) return true;
  const [, entity, action] = name.split('.');
  return (
    entity !== undefined &&
    action !== undefined &&
    EVENT_ENTITY_NAMES[entity] !== undefined &&
    EVENT_ACTION_NAMES[action] !== undefined
  );
};

// ── Lifecycle and descriptions ──────────────────────────────────────────────

const WORKFLOW_ENGINE_MIRROR =
  'the recruitment workflow engine also publishes this name with the transition payload ' +
  '(applicantId, applicantCode, entityId, from, to)';

/**
 * Events that are not plain `stable`. Empty today: every declared event is published, which the
 * publisher test in `apps/api` asserts against the real source rather than trusting this table.
 *
 * A `planned` entry is how a module declares an event before it publishes one, without a workflow
 * silently subscribing to nothing. A `deprecated` entry keeps firing while `supersededBy` tells
 * every consumer — UI, SDK, docs — where to go, which is what makes a rename unnecessary.
 */
export const EVENT_LIFECYCLE: Readonly<
  Record<string, { status: EventStatus; supersededBy?: string }>
> = {
  // Declared by their modules, published by nobody. Found by the publisher test in `apps/api`,
  // which scans the real source rather than trusting this table — so an entry that gains a
  // publisher fails the suite until it is promoted to `stable`.
  'hr.applicant.returnedToStage': { status: 'planned' },
  'hr.evaluation.opened': { status: 'planned' },
  // Fleet (FL-1): the whole surface was declared ahead of its publishers — FL-2..FL-6 promoted
  // each name to `stable` as its emit site landed, and the publisher test enforces the promotion.
  // FL-2 `fleet.vehicle.*`; FL-3 `fleet.driverUnavailability.*`; FL-4 odometer, maintenance,
  // maintenanceAlarm and both license surfaces; FL-5 roster + assignment; FL-6 accident +
  // violation. All 22 fleet events are stable — the module's automation surface is complete.
};

/**
 * Names emitted by MORE THAN ONE publisher, with different payload shapes.
 *
 * The recruitment workflow engine mirrors every validated transition onto the platform bus
 * (`workflow-dispatcher.ts`) carrying the TRANSITION — `applicantId`, `applicantCode`, `entityId`,
 * `from`, `to` — while the feature service that owns the entity emits the same name carrying the
 * ENTITY. Both are real; `fields` describes the entity shape, because that is what the module
 * declares.
 *
 * This matters to anything filtering on the payload: a filter on a field only one publisher sends
 * silently fails to match the other, and a workflow that "sometimes doesn't fire" is the hardest
 * kind of automation bug to find. A trigger picker should warn; A-5 will refuse a filter on a
 * field that is not in every variant. The divergence itself is pre-existing HR behaviour, recorded
 * here rather than changed by a contracts slice.
 */
export const EVENT_MULTI_PUBLISHER: Readonly<Record<string, string>> = {
  'hr.applicant.withdrawn': WORKFLOW_ENGINE_MIRROR,
  'hr.interview.scheduled': WORKFLOW_ENGINE_MIRROR,
  'hr.interview.started': WORKFLOW_ENGINE_MIRROR,
  'hr.interview.cancelled': WORKFLOW_ENGINE_MIRROR,
  'hr.jobOffer.created': WORKFLOW_ENGINE_MIRROR,
  'hr.jobOffer.sent': WORKFLOW_ENGINE_MIRROR,
  'hr.jobOffer.accepted': WORKFLOW_ENGINE_MIRROR,
  'hr.jobOffer.rejected': WORKFLOW_ENGINE_MIRROR,
  'hr.jobOffer.withdrawn': WORKFLOW_ENGINE_MIRROR,
  'hr.jobOffer.expired': WORKFLOW_ENGINE_MIRROR,
};

/**
 * Prose where the composed label is not enough. Optional on purpose: 87 hand-written bilingual
 * sentences would be exactly the manual maintenance this catalogue exists to avoid, and a label
 * plus a typed field list plus a sample already documents most events completely. A module owner
 * adds an entry here when their event genuinely needs explaining.
 */
export const EVENT_DESCRIPTIONS: Readonly<Record<string, LocalizedString>> = {};

/** `platform.user.created` + v1 → `PlatformUserCreatedV1`. Stable as long as name and version are. */
export const eventTypeName = (name: string, schemaVersion: number): string =>
  `${name
    .split('.')
    .map((segment) => capitalize(segment.replace(/[^A-Za-z0-9]/g, '')))
    .join('')}V${schemaVersion}`;

// ── Building ────────────────────────────────────────────────────────────────

const entryFor = (
  name: string,
  schema: z.ZodTypeAny | null,
  moduleId: string,
  schemaVersion: number,
): EventCatalogEntry => {
  const [, entity = '', action = ''] = name.split('.');
  const lifecycle = EVENT_LIFECYCLE[name];
  return {
    id: `${name}@${schemaVersion}`,
    name,
    moduleId,
    entity,
    action,
    schemaVersion,
    status: lifecycle?.status ?? 'stable',
    supersededBy: lifecycle?.supersededBy ?? null,
    alsoPublishedBy: EVENT_MULTI_PUBLISHER[name] ?? null,
    typeName: eventTypeName(name, schemaVersion),
    label: labelFor(name, entity, action),
    description: EVENT_DESCRIPTIONS[name] ?? null,
    moduleName: EVENT_MODULE_NAMES[moduleId] ?? {
      en: capitalize(humanize(moduleId)),
      ar: capitalize(humanize(moduleId)),
    },
    payloadDeclared: schema !== null,
    fields: schema === null ? [] : describeField(schema, ''),
    jsonSchema:
      schema === null
        ? null
        : {
            $schema: JSON_SCHEMA_DIALECT,
            title: eventTypeName(name, schemaVersion),
            ...toJsonSchemaNode(schema),
          },
    sample: schema === null ? null : sampleFor(schema),
  };
};

/** Merge module sources into one catalogue, sorted by name so the output is stable. */
export const buildEventCatalog = (...sources: readonly EventCatalogSource[]): EventCatalogEntry[] =>
  sources
    .flatMap((source) =>
      Object.entries(source.schemas).map(([name, schema]) =>
        entryFor(name, schema, source.moduleId, source.versions?.[name] ?? 1),
      ),
    )
    .sort((a, b) => a.name.localeCompare(b.name));

// ── Sources ─────────────────────────────────────────────────────────────────
// `Record<…EventName, …>` is what makes these tables self-enforcing: declaring a new event
// constant without adding it here does not compile.

export const PLATFORM_EVENT_PAYLOAD_SCHEMAS: Readonly<
  Record<PlatformEventName, z.ZodTypeAny | null>
> = {
  [PlatformEvents.UserCreated]: UserEventPayloadV1,
  [PlatformEvents.UserUpdated]: UserEventPayloadV1,
  [PlatformEvents.UserStatusChanged]: UserEventPayloadV1,
  [PlatformEvents.AuthLoggedIn]: AuthEventPayloadV1,
  [PlatformEvents.AuthLoginFailed]: AuthEventPayloadV1,
  [PlatformEvents.AuthSessionRevoked]: AuthEventPayloadV1,
  [PlatformEvents.AuthRefreshReuseDetected]: AuthEventPayloadV1,
  [PlatformEvents.RoleChanged]: RoleChangedPayloadV1,
  [PlatformEvents.RoleAssignmentChanged]: RoleAssignmentChangedPayloadV1,
  [PlatformEvents.OrganizationUpdated]: OrganizationUpdatedPayloadV1,
  [PlatformEvents.OrgUnitChanged]: OrgUnitChangedPayloadV1,
  [PlatformEvents.SettingsChanged]: SettingsChangedPayloadV1,
  [PlatformEvents.FileUploaded]: FileEventPayloadV1,
  [PlatformEvents.FileDeleted]: FileEventPayloadV1,
  [PlatformEvents.FileArchived]: FileEventPayloadV1,
  [PlatformEvents.FileRestored]: FileEventPayloadV1,
  [PlatformEvents.ThumbnailCreated]: FileProcessorEventPayloadV1,
  [PlatformEvents.OcrCompleted]: FileProcessorEventPayloadV1,
  [PlatformEvents.VirusScanCompleted]: FileProcessorEventPayloadV1,
  [PlatformEvents.AuditAlertRaised]: AuditAlertRaisedPayloadV1,
  [PlatformEvents.NotificationCreated]: NotificationCreatedPayloadV1,
  [PlatformEvents.NotificationDeliveryFailed]: NotificationDeliveryFailedPayloadV1,
};

export const PLATFORM_EVENT_SOURCE: EventCatalogSource = {
  moduleId: 'platform',
  schemas: PLATFORM_EVENT_PAYLOAD_SCHEMAS,
  versions: EVENT_SCHEMA_VERSIONS,
};

/** Every event name the HR module declares, across its features. */
export type HrCatalogEventName =
  | HrEventName
  | HrRecruitmentWorkflowEventName
  | HrWorkflowEngineEventName
  | HrScreeningEventName
  | HrInterviewEventName
  | HrEvaluationEventName
  | HrEvaluationBatchEventName
  | HrOfferEventName
  | HrEmployeeEventName
  | HrEmployeeFileEventName
  | HrHiringDocumentsEventName
  | HrLeaveEventName
  | HrAttendanceEventName
  | HrPayrollEventName
  | HrEmployeeLoanEventName
  | HrContractEventName;

export const HR_EVENT_PAYLOAD_SCHEMAS: Readonly<Record<HrCatalogEventName, z.ZodTypeAny | null>> = {
  [HrEvents.ApplicantCreated]: ApplicantEventPayloadV1,
  [HrEvents.ApplicantUpdated]: ApplicantEventPayloadV1,
  [HrEvents.ApplicantIdentityVerified]: ApplicantEventPayloadV1,
  [HrEvents.ApplicantWithdrawn]: ApplicantWithdrawnPayloadV1,
  [HrEvents.ApplicantRejected]: ApplicantRejectedPayloadV1,
  [HrEvents.ApplicantRestored]: ApplicantEventPayloadV1,
  [HrEvents.ApplicantMovedToOffer]: ApplicantEventPayloadV1,

  [HrRecruitmentWorkflowEvents.PlacementChanged]: PlacementChangedPayloadV1,
  [HrRecruitmentWorkflowEvents.ReturnedToStage]: ReturnedToStagePayloadV1,
  [HrRecruitmentWorkflowEvents.ApplicantHired]: ApplicantHiredPayloadV1,

  // The workflow engine's transition surface — one payload shape for all of them.
  [HrWorkflowEngineEvents.StageEntered]: WorkflowTransitionPayloadV1,
  [HrWorkflowEngineEvents.StageLeft]: WorkflowTransitionPayloadV1,
  [HrWorkflowEngineEvents.ScreeningAccepted]: WorkflowTransitionPayloadV1,
  [HrWorkflowEngineEvents.ScreeningRejected]: WorkflowTransitionPayloadV1,
  [HrWorkflowEngineEvents.ScreeningCancelled]: WorkflowTransitionPayloadV1,
  [HrWorkflowEngineEvents.ScreeningRedecided]: WorkflowTransitionPayloadV1,
  [HrWorkflowEngineEvents.InterviewRedecided]: WorkflowTransitionPayloadV1,
  [HrWorkflowEngineEvents.EvaluationCancelled]: WorkflowTransitionPayloadV1,
  [HrWorkflowEngineEvents.EvaluationRedecided]: WorkflowTransitionPayloadV1,
  [HrWorkflowEngineEvents.EvaluationReopened]: WorkflowTransitionPayloadV1,
  [HrWorkflowEngineEvents.OfferSuperseded]: WorkflowTransitionPayloadV1,
  [HrWorkflowEngineEvents.ApplicantReactivated]: WorkflowTransitionPayloadV1,

  [HrScreeningEvents.ScreeningCreated]: ScreeningCreatedPayloadV1,
  [HrScreeningEvents.ScreeningDecided]: ScreeningDecidedPayloadV1,

  [HrInterviewEvents.InterviewScheduled]: InterviewEventPayloadV1,
  [HrInterviewEvents.InterviewRescheduled]: InterviewEventPayloadV1,
  [HrInterviewEvents.InterviewCancelled]: InterviewEventPayloadV1,
  [HrInterviewEvents.InterviewEvaluated]: InterviewEventPayloadV1,
  [HrInterviewEvents.InterviewStarted]: InterviewStartedPayloadV1,
  [HrInterviewEvents.InterviewDecided]: InterviewDecidedPayloadV1,
  [HrInterviewEvents.InterviewCompleted]: InterviewDecidedPayloadV1,

  [HrEvaluationEvents.EvaluationOpened]: EvaluationOpenedPayloadV1,
  [HrEvaluationEvents.EvaluationDecided]: EvaluationDecidedPayloadV1,
  [HrEvaluationEvents.EvaluationApproved]: EvaluationDecidedPayloadV1,
  [HrEvaluationEvents.EvaluationRejected]: EvaluationDecidedPayloadV1,

  [HrEvaluationBatchEvents.BatchCreated]: EvaluationBatchEventPayloadV1,
  [HrEvaluationBatchEvents.BatchGenerated]: EvaluationBatchEventPayloadV1,
  [HrEvaluationBatchEvents.BatchIssued]: EvaluationBatchEventPayloadV1,
  [HrEvaluationBatchEvents.BatchClosed]: EvaluationBatchEventPayloadV1,
  [HrEvaluationBatchEvents.BatchCancelled]: EvaluationBatchEventPayloadV1,
  [HrEvaluationBatchEvents.BatchPackageReady]: EvaluationBatchPackagePayloadV1,
  [HrEvaluationBatchEvents.BatchPackageFailed]: EvaluationBatchPackagePayloadV1,
  [HrEvaluationBatchEvents.BatchReturned]: EvaluationBatchReturnedPayloadV1,

  [HrOfferEvents.OfferCreated]: JobOfferEventPayloadV1,
  [HrOfferEvents.OfferRevised]: JobOfferEventPayloadV1,
  [HrOfferEvents.OfferSent]: JobOfferEventPayloadV1,
  [HrOfferEvents.OfferAccepted]: JobOfferEventPayloadV1,
  [HrOfferEvents.OfferRejected]: JobOfferEventPayloadV1,
  [HrOfferEvents.OfferExpired]: JobOfferEventPayloadV1,
  [HrOfferEvents.OfferWithdrawn]: JobOfferEventPayloadV1,

  [HrEmployeeEvents.EmployeeCreated]: EmployeeCreatedPayloadV1,
  [HrEmployeeEvents.EmployeeStatusChanged]: EmployeeStatusChangedPayloadV1,
  [HrEmployeeEvents.EmployeeActionApplied]: EmployeeActionAppliedPayloadV1,
  [HrEmployeeEvents.EmployeeTransferred]: EmployeeTransferredPayloadV1,
  [HrEmployeeEvents.EmployeeExited]: EmployeeExitedPayloadV1,
  [HrEmployeeEvents.EmployeeRehired]: EmployeeRehiredPayloadV1,
  [HrEmployeeEvents.EmployeeLoginLinked]: EmployeeLoginLinkedPayloadV1,

  [HrEmployeeFileEvents.Created]: EmployeeFileEventPayloadV1,
  [HrEmployeeFileEvents.NoteAdded]: EmployeeFileEventPayloadV1,

  [HrHiringDocumentsEvents.Created]: HiringDocumentsEventPayloadV1,
  [HrHiringDocumentsEvents.DocumentUploaded]: HiringDocumentsEventPayloadV1,
  [HrHiringDocumentsEvents.DocumentReplaced]: HiringDocumentsEventPayloadV1,
  [HrHiringDocumentsEvents.Completed]: HiringDocumentsEventPayloadV1,

  [HrLeaveEvents.Requested]: LeaveRequestedPayloadV1,
  [HrLeaveEvents.Decided]: LeaveDecidedPayloadV1,
  [HrLeaveEvents.Cancelled]: LeaveCancelledPayloadV1,
  [HrLeaveEvents.Started]: LeaveSpanPayloadV1,
  [HrLeaveEvents.Ended]: LeaveSpanPayloadV1,
  [HrLeaveEvents.BalanceAdjusted]: LeaveBalanceAdjustedPayloadV1,

  [HrAttendanceEvents.PunchRecorded]: AttendancePunchRecordedPayloadV1,
  [HrAttendanceEvents.PunchesImported]: AttendancePunchesImportedPayloadV1,
  [HrAttendanceEvents.DayComputed]: AttendanceDayPayloadV1,
  [HrAttendanceEvents.DayAbsent]: AttendanceDayPayloadV1,
  [HrAttendanceEvents.PeriodFrozen]: AttendancePeriodFrozenPayloadV1,
  [HrAttendanceEvents.RegularizationRequested]: AttendanceRegularizationRequestedPayloadV1,
  [HrAttendanceEvents.RegularizationDecided]: AttendanceRegularizationDecidedPayloadV1,
  [HrAttendanceEvents.OvertimeApproved]: AttendanceOvertimeApprovedPayloadV1,

  // P-HR-07 — the two payroll decisions somebody waits on, and the three a debt has.
  [HrPayrollEvents.AdjustmentSubmitted]: PayrollAdjustmentSubmittedPayloadV1,
  [HrPayrollEvents.AdjustmentDecided]: PayrollAdjustmentDecidedPayloadV1,

  // P-HR-16 — the run's three, each the moment the NEXT person's turn begins.
  [HrPayrollEvents.RunFrozen]: PayrollRunLifecyclePayloadV1,
  [HrPayrollEvents.RunApproved]: PayrollRunLifecyclePayloadV1,
  [HrPayrollEvents.RunPaid]: PayrollRunLifecyclePayloadV1,

  [HrEmployeeLoanEvents.Submitted]: EmployeeLoanSubmittedPayloadV1,
  [HrEmployeeLoanEvents.Decided]: EmployeeLoanDecidedPayloadV1,
  [HrEmployeeLoanEvents.Disbursed]: EmployeeLoanDisbursedPayloadV1,

  [HrContractEvents.Generated]: ContractGeneratedPayloadV1,
  [HrContractEvents.ApprovalRequested]: ContractEventPayloadV1,
  [HrContractEvents.ApprovalDecided]: ContractApprovalDecidedPayloadV1,
  [HrContractEvents.Signed]: ContractEventPayloadV1,
  [HrContractEvents.Amended]: ContractSupersededPayloadV1,
  [HrContractEvents.Renewed]: ContractSupersededPayloadV1,
  [HrContractEvents.Terminated]: ContractTerminatedPayloadV1,
  [HrContractEvents.Expired]: ContractEventPayloadV1,
};

export const HR_EVENT_SOURCE: EventCatalogSource = {
  moduleId: 'hr',
  schemas: HR_EVENT_PAYLOAD_SCHEMAS,
};

export const FLEET_EVENT_PAYLOAD_SCHEMAS: Readonly<Record<FleetEventName, z.ZodTypeAny | null>> = {
  [FleetEvents.VehicleCreated]: FleetVehicleEventPayloadV1,
  [FleetEvents.VehicleUpdated]: FleetVehicleEventPayloadV1,
  [FleetEvents.VehicleStatusChanged]: FleetVehicleStatusChangedPayloadV1,
  [FleetEvents.OdometerRecorded]: FleetOdometerRecordedPayloadV1,
  [FleetEvents.OdometerCorrected]: FleetOdometerCorrectedPayloadV1,
  [FleetEvents.MaintenanceCheckedIn]: FleetMaintenancePayloadV1,
  [FleetEvents.MaintenanceCheckedOut]: FleetMaintenancePayloadV1,
  [FleetEvents.MaintenanceReopened]: FleetMaintenancePayloadV1,
  [FleetEvents.MaintenanceAlarmRaised]: FleetMaintenanceAlarmPayloadV1,
  [FleetEvents.VehicleLicenseExpiring]: FleetLicenseExpiryPayloadV1,
  [FleetEvents.VehicleLicenseExpired]: FleetLicenseExpiryPayloadV1,
  [FleetEvents.DriverLicenseExpiring]: FleetLicenseExpiryPayloadV1,
  [FleetEvents.DriverLicenseExpired]: FleetLicenseExpiryPayloadV1,
  [FleetEvents.RosterPlanned]: FleetRosterPlannedPayloadV1,
  [FleetEvents.AssignmentChanged]: FleetAssignmentChangedPayloadV1,
  [FleetEvents.UnavailabilityRecorded]: FleetUnavailabilityPayloadV1,
  [FleetEvents.UnavailabilityEnded]: FleetUnavailabilityPayloadV1,
  [FleetEvents.AccidentRecorded]: FleetAccidentPayloadV1,
  [FleetEvents.AccidentClosed]: FleetAccidentPayloadV1,
  [FleetEvents.AccidentReopened]: FleetAccidentPayloadV1,
  [FleetEvents.ViolationRecorded]: FleetViolationRecordedPayloadV1,
  [FleetEvents.GrievanceApplied]: FleetGrievanceAppliedPayloadV1,
};

export const FLEET_EVENT_SOURCE: EventCatalogSource = {
  moduleId: 'fleet',
  schemas: FLEET_EVENT_PAYLOAD_SCHEMAS,
};

// IT-1 registered the two registry events; IT-2 adds the four custody facts. IT-3…IT-6 extend
// this map with their slices. Each becomes an automation trigger with no extra work.
export const IT_EVENT_PAYLOAD_SCHEMAS: Readonly<Record<ItEventName, z.ZodTypeAny | null>> = {
  [ItEvents.AssetRegistered]: ItAssetEventPayloadV1,
  [ItEvents.AssetUpdated]: ItAssetEventPayloadV1,
  [ItEvents.AssetAssigned]: ItAssetAssignedPayloadV1,
  [ItEvents.AssetReturned]: ItAssetReturnedPayloadV1,
  [ItEvents.AssetTransferred]: ItAssetTransferredPayloadV1,
  [ItEvents.AssetDisposed]: ItAssetDisposedPayloadV1,
  [ItEvents.TicketOpened]: ItTicketOpenedPayloadV1,
  [ItEvents.TicketAssigned]: ItTicketAssignedPayloadV1,
  [ItEvents.TicketStatusChanged]: ItTicketStatusChangedPayloadV1,
  [ItEvents.TicketSlaBreached]: ItTicketSlaBreachedPayloadV1,
  [ItEvents.MaintenanceOrderCreated]: ItMaintenanceOrderCreatedPayloadV1,
  [ItEvents.MaintenanceOrderCompleted]: ItMaintenanceOrderCompletedPayloadV1,
  [ItEvents.SparePartBelowMin]: ItSparePartBelowMinPayloadV1,
  [ItEvents.AssetWarrantyExpiring]: ItAssetWarrantyExpiringPayloadV1,
  [ItEvents.AssetWarrantyExpired]: ItAssetWarrantyExpiredPayloadV1,
  [ItEvents.LicenseExpiring]: ItLicenseExpiringPayloadV1,
  [ItEvents.LicenseExpired]: ItLicenseExpiredPayloadV1,
  [ItEvents.LicenseSeatsExceeded]: ItLicenseSeatsExceededPayloadV1,
};

export const IT_EVENT_SOURCE: EventCatalogSource = {
  moduleId: 'it',
  schemas: IT_EVENT_PAYLOAD_SCHEMAS,
};

// OP-2 registered the shipment lifecycle facts. Later operations slices (vault custody, crew
// assignment, captain execution) extend this map with theirs.
export const OPERATIONS_EVENT_PAYLOAD_SCHEMAS: Readonly<
  Record<OperationsEventName, z.ZodTypeAny | null>
> = {
  [OperationsEvents.ShipmentCreated]: OperationsShipmentEventPayloadV1,
  [OperationsEvents.ShipmentUpdated]: OperationsShipmentEventPayloadV1,
  [OperationsEvents.ShipmentCompleted]: OperationsShipmentEventPayloadV1,
  [OperationsEvents.ShipmentReopened]: OperationsShipmentEventPayloadV1,
  [OperationsEvents.ShipmentDeleted]: OperationsShipmentEventPayloadV1,
  [OperationsEvents.DayCreated]: OperationsDayEventPayloadV1,
  [OperationsEvents.DayOpened]: OperationsDayEventPayloadV1,
  [OperationsEvents.DayClosed]: OperationsDayEventPayloadV1,
  [OperationsEvents.CrewPlanned]: OperationsCrewPlannedPayloadV1,
  [OperationsEvents.CrewAssignmentChanged]: OperationsCrewAssignmentChangedPayloadV1,
  [OperationsEvents.VaultReceived]: OperationsCustodyEventPayloadV1,
  [OperationsEvents.VaultReleased]: OperationsCustodyEventPayloadV1,
  [OperationsEvents.SecuredLegAssigned]: OperationsShipmentAssignmentPayloadV1,
  [OperationsEvents.SecuredDispatched]: OperationsShipmentEventPayloadV1,
  [OperationsEvents.ShipmentOrderReordered]: OperationsShipmentReorderedPayloadV1,
  // OP-7 — the four captain execution facts. One payload shape for all four: they differ only in
  // which step they report, and `from`/`to` already carry that.
  [OperationsEvents.ExecutionStarted]: OperationsShipmentExecutionPayloadV1,
  [OperationsEvents.ExecutionPickupConfirmed]: OperationsShipmentExecutionPayloadV1,
  [OperationsEvents.ExecutionDeliveryConfirmed]: OperationsShipmentExecutionPayloadV1,
  [OperationsEvents.ExecutionCompleted]: OperationsShipmentExecutionPayloadV1,
};

export const OPERATIONS_EVENT_SOURCE: EventCatalogSource = {
  moduleId: 'operations',
  schemas: OPERATIONS_EVENT_PAYLOAD_SCHEMAS,
};

// ── The catalogue ───────────────────────────────────────────────────────────

export const EVENT_CATALOG: readonly EventCatalogEntry[] = buildEventCatalog(
  PLATFORM_EVENT_SOURCE,
  HR_EVENT_SOURCE,
  FLEET_EVENT_SOURCE,
  IT_EVENT_SOURCE,
  OPERATIONS_EVENT_SOURCE,
);

const CATALOG_BY_NAME: ReadonlyMap<string, EventCatalogEntry> = new Map(
  EVENT_CATALOG.map((entry) => [entry.name, entry]),
);

export const eventCatalogEntry = (name: string): EventCatalogEntry | undefined =>
  CATALOG_BY_NAME.get(name);

/**
 * The gate an event trigger is validated against, and the gate a template package's
 * `requires.events` resolves against (design §11.1). An automation may not subscribe to a name
 * nobody publishes — otherwise a workflow sits enabled and silent forever.
 */
export const isCatalogedEventName = (name: string): boolean => CATALOG_BY_NAME.has(name);

export const eventCatalogNames = (): string[] => EVENT_CATALOG.map((entry) => entry.name);

/** Events safe to build on. `planned` and `deprecated` are still listed, and marked. */
export const stableEventNames = (): string[] =>
  EVENT_CATALOG.filter((entry) => entry.status === 'stable').map((entry) => entry.name);

// ── The published document ──────────────────────────────────────────────────
// The catalogue is a PLATFORM API, not an automation implementation detail: it is what a trigger
// picker, a workflow validator, an SDK generator, the API reference and any future external
// integration all read. That means it needs the things any API needs — a stable identity per
// item, an explicit version, and a way for a consumer to tell whether anything changed.

/**
 * The version of the catalogue DOCUMENT — the shape of an entry, not the events inside it.
 *
 * Minor bump when a field is added to `EventCatalogEntry` (additive; existing consumers keep
 * working). Major bump when one is removed or retyped, which is a breaking change for every
 * generated SDK and needs a deprecation window like any other API break.
 */
export const EVENT_CATALOG_VERSION = '1.0.0';

/**
 * Content hash of the catalogue, for HTTP caching (`ETag`) and for telling at a glance whether two
 * environments are running the same event surface. FNV-1a, not a cryptographic digest: this
 * detects change, it does not authenticate it — and `@ecms/contracts` is bundled for the browser,
 * so `node:crypto` is not available here.
 */
export const eventCatalogDigest = (
  entries: readonly EventCatalogEntry[] = EVENT_CATALOG,
): string => {
  const text = JSON.stringify(entries);
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
};

export interface EventCatalogDocument {
  catalogVersion: string;
  /** How the payload descriptions were produced. Pinned so a consumer knows they are derived. */
  generatedFrom: 'zod';
  jsonSchemaDialect: string;
  digest: string;
  eventCount: number;
  events: readonly EventCatalogEntry[];
}

/**
 * The exact JSON `GET /api/v1/automation/events` returns. Deliberately carries no timestamp: two
 * identical deployments must produce byte-identical documents, or the digest is worthless.
 */
export const eventCatalogDocument = (
  entries: readonly EventCatalogEntry[] = EVENT_CATALOG,
): EventCatalogDocument => ({
  catalogVersion: EVENT_CATALOG_VERSION,
  generatedFrom: 'zod',
  jsonSchemaDialect: JSON_SCHEMA_DIALECT,
  digest: eventCatalogDigest(entries),
  eventCount: entries.length,
  events: entries,
});
