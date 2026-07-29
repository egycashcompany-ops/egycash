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
  type HrRecruitmentWorkflowEventName,
  ApplicantHiredPayloadV1,
  PlacementChangedPayloadV1,
  ReturnedToStagePayloadV1,
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
  HrContractEvents,
  type HrContractEventName,
  ContractApprovalDecidedPayloadV1,
  ContractEventPayloadV1,
  ContractGeneratedPayloadV1,
  ContractTerminatedPayloadV1,
} from '../modules/hr-contract.js';

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

export interface EventCatalogEntry {
  name: string;
  moduleId: string;
  /** Second segment of the name (`platform.user.created` → `user`). */
  entity: string;
  /** Third segment of the name (`platform.user.created` → `created`). */
  action: string;
  schemaVersion: number;
  label: LocalizedString;
  moduleName: LocalizedString;
  /**
   * `false` when the owning module has not declared a payload schema. The event can still be
   * triggered on; it just cannot be FILTERED on, and saying so beats inventing a field list.
   */
  payloadDeclared: boolean;
  fields: EventPayloadField[];
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

interface ZodDefLike {
  typeName?: string;
  innerType?: z.ZodTypeAny;
  schema?: z.ZodTypeAny;
  type?: z.ZodTypeAny;
  values?: readonly string[];
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
  '000000000000000000000000',
  'user@example.com',
  '2026-01-01',
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
  screening: { en: 'Screening', ar: 'الفرز' },
  interview: { en: 'Interview', ar: 'مقابلة' },
  evaluation: { en: 'Evaluation', ar: 'تقييم' },
  evaluationBatch: { en: 'Evaluation batch', ar: 'دفعة تقييم' },
  jobOffer: { en: 'Job offer', ar: 'عرض وظيفي' },
  employee: { en: 'Employee', ar: 'موظف' },
  employeeFile: { en: 'Employee file', ar: 'ملف موظف' },
  hiringDocuments: { en: 'Hiring documents', ar: 'مستندات التعيين' },
  leave: { en: 'Leave', ar: 'إجازة' },
  contract: { en: 'Contract', ar: 'عقد' },
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
  approvalRequested: { en: 'approval requested', ar: 'طلب اعتماد' },
  approvalDecided: { en: 'approval decided', ar: 'البت في اعتماد' },
  signed: { en: 'signed', ar: 'توقيع' },
  amended: { en: 'amended', ar: 'تعديل' },
  renewed: { en: 'renewed', ar: 'تجديد' },
  terminated: { en: 'terminated', ar: 'إنهاء' },
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

// ── Building ────────────────────────────────────────────────────────────────

const entryFor = (
  name: string,
  schema: z.ZodTypeAny | null,
  moduleId: string,
  schemaVersion: number,
): EventCatalogEntry => {
  const [, entity = '', action = ''] = name.split('.');
  return {
    name,
    moduleId,
    entity,
    action,
    schemaVersion,
    label: labelFor(name, entity, action),
    moduleName: EVENT_MODULE_NAMES[moduleId] ?? {
      en: capitalize(humanize(moduleId)),
      ar: capitalize(humanize(moduleId)),
    },
    payloadDeclared: schema !== null,
    fields: schema === null ? [] : describeField(schema, ''),
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
  | HrScreeningEventName
  | HrInterviewEventName
  | HrEvaluationEventName
  | HrEvaluationBatchEventName
  | HrOfferEventName
  | HrEmployeeEventName
  | HrEmployeeFileEventName
  | HrHiringDocumentsEventName
  | HrLeaveEventName
  | HrContractEventName;

export const HR_EVENT_PAYLOAD_SCHEMAS: Readonly<
  Record<HrCatalogEventName, z.ZodTypeAny | null>
> = {
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

  [HrContractEvents.Generated]: ContractGeneratedPayloadV1,
  [HrContractEvents.ApprovalRequested]: ContractEventPayloadV1,
  [HrContractEvents.ApprovalDecided]: ContractApprovalDecidedPayloadV1,
  [HrContractEvents.Signed]: ContractEventPayloadV1,
  [HrContractEvents.Amended]: ContractEventPayloadV1,
  [HrContractEvents.Renewed]: ContractEventPayloadV1,
  [HrContractEvents.Terminated]: ContractTerminatedPayloadV1,
  [HrContractEvents.Expired]: ContractEventPayloadV1,
};

export const HR_EVENT_SOURCE: EventCatalogSource = {
  moduleId: 'hr',
  schemas: HR_EVENT_PAYLOAD_SCHEMAS,
};

// ── The catalogue ───────────────────────────────────────────────────────────

export const EVENT_CATALOG: readonly EventCatalogEntry[] = buildEventCatalog(
  PLATFORM_EVENT_SOURCE,
  HR_EVENT_SOURCE,
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
