import { z } from 'zod';
import {
  DataScopeSchema,
  LocalizedStringSchema,
  objectId,
  PaginationQuerySchema,
  booleanQuery,
} from '../common/index.js';
import type { DataScope, LocalizedString } from '../common/index.js';
import {
  AutomationCapabilitiesSchema,
  AutomationExecutionStatusSchema,
  AutomationNodeResultSchema,
  AutomationTriggerKindSchema,
  AutomationTriggerSchema,
  WorkflowGraphSchema,
  type AutomationExecutionStatus,
  type AutomationFilter,
  type AutomationTriggerKind,
} from '../platform/automation.js';

// Automation module contracts (ADR-018 · automation-module-design §8/§9/§11) — the API surface
// of `/api/v1/automation`, delivered by A-2.
//
// Provider-independent by construction. A workflow points at its runtime through an opaque
// `providerRef`, never an `n8nWorkflowId`: the moment a vendor's identifier appears in a DTO it
// appears in the database, in the web client and in every integration written against the API,
// and swapping providers stops being a configuration change and becomes a migration. This
// supersedes the `n8nWorkflowId` column sketched in design §8, per D-A4.
//
// Wire shapes follow the house rules: API INPUT is `.strict()` (an unknown key is a typo the
// caller wants to hear about), DTO dates are ISO strings, list queries extend
// `PaginationQuerySchema`.

// ── Workflows ───────────────────────────────────────────────────────────────

export const AUTOMATION_WORKFLOW_STATUSES = [
  /** Created or installed from a template, never yet enabled. Cannot fire. */
  'draft',
  /** Enabled and listening. */
  'active',
  /** Turned off by a human (`workflow.enable`), and turned back on the same way. */
  'disabled',
  /**
   * Turned off BY THE PLATFORM — the owner was deactivated (§7.2), or a prerequisite the
   * workflow needs disappeared. Distinct from `disabled` on purpose: a human did not choose
   * this, so re-enabling it has to go through `workflow.transfer` first rather than a toggle.
   */
  'suspended',
] as const;
export const AutomationWorkflowStatusSchema = z.enum(AUTOMATION_WORKFLOW_STATUSES);
export type AutomationWorkflowStatus = z.infer<typeof AutomationWorkflowStatusSchema>;

/** `hr-welcome-email` — stable, human-typed, and the join key a template package installs under. */
export const AUTOMATION_KEY_PATTERN = /^[a-z][a-z0-9-]{1,79}$/;
export const AutomationKeySchema = z.string().regex(AUTOMATION_KEY_PATTERN, {
  message: 'must be lower-case, start with a letter, and contain only letters, digits and hyphens',
});

/**
 * The trigger as an API INPUT: strict, and with the cross-field rules the structural schema in
 * `platform/automation.ts` deliberately leaves open (a provider receives a trigger it has already
 * been validated for; a user typing one has not).
 *
 * Without these three checks a workflow can be saved that can never fire — `kind: 'event'` with
 * no event listens to nothing, and nothing in the system would ever say so.
 */
export const AutomationTriggerInputSchema = AutomationTriggerSchema.strict().superRefine(
  (trigger, ctx) => {
    if (trigger.kind === 'event' && trigger.event === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['event'],
        message: 'an event trigger requires an event name',
      });
    }
    if (trigger.kind === 'cron' && trigger.cron === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['cron'],
        message: 'a cron trigger requires a cron expression',
      });
    }
    if (trigger.kind === 'schedule' && trigger.runAt === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['runAt'],
        message: 'a scheduled trigger requires a run time',
      });
    }
  },
);

export const CreateAutomationWorkflowSchema = z
  .object({
    key: AutomationKeySchema,
    name: LocalizedStringSchema,
    description: LocalizedStringSchema.nullable().default(null),
    trigger: AutomationTriggerInputSchema,
    /** How widely the workflow sees data. Never wider than its owner's own scope (§7.2). */
    branchScope: DataScopeSchema.default('branch'),
    /** Payload fields the owner explicitly allows an AI action to see (§6). Empty = none. */
    aiOptIn: z.array(z.string().min(1).max(200)).max(50).default([]),
    templateKey: AutomationKeySchema.optional(),
    templateVersion: z.string().min(1).max(20).optional(),
  })
  .strict();
export type CreateAutomationWorkflow = z.infer<typeof CreateAutomationWorkflowSchema>;

export const UpdateAutomationWorkflowSchema = z
  .object({
    name: LocalizedStringSchema.optional(),
    description: LocalizedStringSchema.nullable().optional(),
    trigger: AutomationTriggerInputSchema.optional(),
    branchScope: DataScopeSchema.optional(),
    aiOptIn: z.array(z.string().min(1).max(200)).max(50).optional(),
    /** Optimistic concurrency — the same `version` gate every other aggregate uses. */
    version: z.number().int().min(0),
  })
  .strict();
export type UpdateAutomationWorkflow = z.infer<typeof UpdateAutomationWorkflowSchema>;

export const SetAutomationWorkflowEnabledSchema = z
  .object({ enabled: z.boolean(), version: z.number().int().min(0) })
  .strict();
export type SetAutomationWorkflowEnabled = z.infer<typeof SetAutomationWorkflowEnabledSchema>;

/** `workflow.transfer` — the audited path out of a suspended workflow (§7.2). */
export const TransferAutomationWorkflowSchema = z
  .object({ ownerUserId: objectId(), version: z.number().int().min(0) })
  .strict();
export type TransferAutomationWorkflow = z.infer<typeof TransferAutomationWorkflowSchema>;

export const RunAutomationWorkflowSchema = z
  .object({ input: z.unknown().optional() })
  .strict();
export type RunAutomationWorkflow = z.infer<typeof RunAutomationWorkflowSchema>;

export const ListAutomationWorkflowsQuerySchema = PaginationQuerySchema.extend({
  status: AutomationWorkflowStatusSchema.optional(),
  triggerKind: AutomationTriggerKindSchema.optional(),
  /** Exact event name — "what runs when an employee is hired?" is the question this answers. */
  event: z.string().min(1).max(200).optional(),
  ownerUserId: objectId().optional(),
  branchId: objectId().optional(),
  templateKey: AutomationKeySchema.optional(),
  q: z.string().min(1).max(120).optional(),
}).strict();
export type ListAutomationWorkflowsQuery = z.infer<typeof ListAutomationWorkflowsQuerySchema>;

/** The trigger as it leaves the API: JSON-shaped, so `runAt` is a string and nothing is absent. */
export interface AutomationTriggerDto {
  kind: AutomationTriggerKind;
  event: string | null;
  cron: string | null;
  runAt: string | null;
  timezone: string;
  filters: AutomationFilter[];
}

/** An opaque handle to the runtime's own object. Rendered, never parsed, by any client. */
export interface ProviderRefDto {
  providerId: string;
  ref: string;
}

export interface AutomationWorkflowDto {
  id: string;
  key: string;
  name: LocalizedString;
  description: LocalizedString | null;
  status: AutomationWorkflowStatus;
  trigger: AutomationTriggerDto;
  owner: { id: string; name: string | null };
  branchScope: DataScope;
  branchId: string | null;
  /** `null` until the graph has been pushed to a provider — a draft may have no runtime yet. */
  providerRef: ProviderRefDto | null;
  template: { key: string; version: string; updateAvailable: boolean } | null;
  aiOptIn: string[];
  lastRun: { at: string; status: AutomationExecutionStatus } | null;
  stats: { runs7d: number; failures7d: number };
  version: number;
  createdAt: string;
  updatedAt: string;
}

// ── Executions ──────────────────────────────────────────────────────────────

export const ListAutomationExecutionsQuerySchema = PaginationQuerySchema.extend({
  workflowId: objectId().optional(),
  status: AutomationExecutionStatusSchema.optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  /** Find every execution caused by one business event — the first question after an incident. */
  eventId: z.string().min(1).max(100).optional(),
}).strict();
export type ListAutomationExecutionsQuery = z.infer<typeof ListAutomationExecutionsQuerySchema>;

export interface AutomationNodeResultDto {
  name: string;
  status: 'success' | 'failed' | 'skipped';
  durationMs: number | null;
  error: string | null;
}

export interface AutomationExecutionDto {
  id: string;
  workflow: { id: string; key: string; name: LocalizedString };
  status: AutomationExecutionStatus;
  trigger: { kind: AutomationTriggerKind; eventName: string | null; eventId: string | null };
  providerRef: ProviderRefDto | null;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  nodes: AutomationNodeResultDto[];
  error: string | null;
  actorUserId: string | null;
  branchId: string | null;
  /** Re-entrancy depth (§7.4). Visible because a depth-limited run looks like a silent one. */
  depth: number;
  /** Set on a retry — the execution this one re-runs. */
  retryOfExecutionId: string | null;
  createdAt: string;
}

export interface AutomationExecutionDetailDto extends AutomationExecutionDto {
  /** Redacted snapshots (§7.4) — business data, so retention and redaction both apply. */
  inputSnapshot: unknown;
  outputSnapshot: unknown;
}

/**
 * The runtime reporting node completion back (`POST /executions/:id/progress`). Service-token
 * only. Provider-independent: a provider translates its own progress format into this.
 */
export const ReportAutomationProgressSchema = z
  .object({
    status: AutomationExecutionStatusSchema,
    nodes: z.array(AutomationNodeResultSchema).max(500).default([]),
    error: z.string().max(4000).optional(),
    outputSnapshot: z.unknown().optional(),
    finishedAt: z.coerce.date().optional(),
  })
  .strict();
export type ReportAutomationProgress = z.infer<typeof ReportAutomationProgressSchema>;

export const RetryAutomationExecutionSchema = z.object({}).strict();
export type RetryAutomationExecution = z.infer<typeof RetryAutomationExecutionSchema>;

// ── Credentials (write-only) ────────────────────────────────────────────────
// There is no read path for a stored secret anywhere in this file, and that is the point (§7.3).
// The response shape is a SCHEMA rather than a bare interface so the rule is executable: a test
// asserts `value` is not among its keys, and adding one to the mapper would fail that test rather
// than quietly shipping an exfiltration endpoint.

export const AUTOMATION_CREDENTIAL_TYPES = [
  'http',
  'httpHeader',
  'smtp',
  'whatsapp',
  'slack',
  'openai',
  'anthropic',
  's3',
  'custom',
] as const;
export const AutomationCredentialTypeSchema = z.enum(AUTOMATION_CREDENTIAL_TYPES);
export type AutomationCredentialType = z.infer<typeof AutomationCredentialTypeSchema>;

export const CreateAutomationCredentialSchema = z
  .object({
    key: AutomationKeySchema,
    name: LocalizedStringSchema,
    type: AutomationCredentialTypeSchema,
    /** Write-only. Sealed with the platform crypto service on arrival and never returned. */
    value: z.string().min(1).max(20000),
    branchScope: DataScopeSchema.default('branch'),
  })
  .strict();
export type CreateAutomationCredential = z.infer<typeof CreateAutomationCredentialSchema>;

/** Replace the secret. There is no "edit" that returns the old one to diff against. */
export const ReplaceAutomationCredentialValueSchema = z
  .object({ value: z.string().min(1).max(20000), version: z.number().int().min(0) })
  .strict();
export type ReplaceAutomationCredentialValue = z.infer<
  typeof ReplaceAutomationCredentialValueSchema
>;

export const UpdateAutomationCredentialSchema = z
  .object({
    name: LocalizedStringSchema.optional(),
    branchScope: DataScopeSchema.optional(),
    version: z.number().int().min(0),
  })
  .strict();
export type UpdateAutomationCredential = z.infer<typeof UpdateAutomationCredentialSchema>;

export const ListAutomationCredentialsQuerySchema = PaginationQuerySchema.extend({
  type: AutomationCredentialTypeSchema.optional(),
  branchId: objectId().optional(),
  q: z.string().min(1).max(120).optional(),
}).strict();
export type ListAutomationCredentialsQuery = z.infer<typeof ListAutomationCredentialsQuerySchema>;

export const AutomationCredentialDtoSchema = z.object({
  id: z.string(),
  key: z.string(),
  name: LocalizedStringSchema,
  type: AutomationCredentialTypeSchema,
  /** What the UI shows in place of the secret. A fixed mask, never a prefix of the real value. */
  masked: z.literal('••••••••'),
  branchScope: DataScopeSchema,
  branchId: z.string().nullable(),
  ownerUserId: z.string().nullable(),
  lastUsedAt: z.string().nullable(),
  /** Which key-ring entry it is sealed under — rotation posture without decrypting anything. */
  keyId: z.string().nullable(),
  version: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type AutomationCredentialDto = z.infer<typeof AutomationCredentialDtoSchema>;

// ── Variables ───────────────────────────────────────────────────────────────

export const AUTOMATION_VARIABLE_SCOPES = ['global', 'branch', 'workflow'] as const;
export const AutomationVariableScopeSchema = z.enum(AUTOMATION_VARIABLE_SCOPES);
export type AutomationVariableScope = z.infer<typeof AutomationVariableScopeSchema>;

export const UpsertAutomationVariableSchema = z
  .object({
    value: z.string().max(20000),
    scope: AutomationVariableScopeSchema.default('global'),
    branchId: objectId().optional(),
    workflowId: objectId().optional(),
  })
  .strict()
  .superRefine((variable, ctx) => {
    if (variable.scope === 'branch' && variable.branchId === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['branchId'],
        message: 'a branch-scoped variable requires a branchId',
      });
    }
    if (variable.scope === 'workflow' && variable.workflowId === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['workflowId'],
        message: 'a workflow-scoped variable requires a workflowId',
      });
    }
  });
export type UpsertAutomationVariable = z.infer<typeof UpsertAutomationVariableSchema>;

export const ListAutomationVariablesQuerySchema = PaginationQuerySchema.extend({
  scope: AutomationVariableScopeSchema.optional(),
  branchId: objectId().optional(),
  workflowId: objectId().optional(),
}).strict();
export type ListAutomationVariablesQuery = z.infer<typeof ListAutomationVariablesQuerySchema>;

export interface AutomationVariableDto {
  id: string;
  key: string;
  value: string;
  scope: AutomationVariableScope;
  branchId: string | null;
  workflowId: string | null;
  version: number;
  updatedAt: string;
}

// ── Template packages (§11) ─────────────────────────────────────────────────

export const AUTOMATION_TEMPLATE_TRUST_STATES = [
  /** Signature verified against a configured public key. Installable by anyone with the rights. */
  'verified',
  /** Unsigned or unverifiable. Stored, never installable until a human explicitly trusts it. */
  'untrusted',
  /** A human with `automation.admin` reviewed an untrusted package and accepted it. */
  'trusted',
] as const;
export const AutomationTemplateTrustStateSchema = z.enum(AUTOMATION_TEMPLATE_TRUST_STATES);
export type AutomationTemplateTrustState = z.infer<typeof AutomationTemplateTrustStateSchema>;

export const SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

/**
 * The declared prerequisites an installer resolves BEFORE creating anything (§11.1). Each one
 * exists because the alternative is a workflow that installs cleanly and then does nothing:
 * an event nobody publishes, a credential type nobody configured, a capability the provider
 * does not have.
 */
export const AutomationTemplateRequiresSchema = z
  .object({
    events: z.array(z.string().min(1).max(200)).max(50).default([]),
    credentials: z
      .array(
        z
          .object({ type: AutomationCredentialTypeSchema, label: z.string().min(1).max(200) })
          .strict(),
      )
      .max(20)
      .default([]),
    /** Keys of `AutomationCapabilities` — derived from the schema, so it cannot drift from it. */
    capabilities: z.array(AutomationCapabilitiesSchema.keyof()).max(10).default([]),
    /** Platform semver range, e.g. `^2.2`. */
    platform: z.string().min(1).max(20).optional(),
  })
  .strict();
export type AutomationTemplateRequires = z.infer<typeof AutomationTemplateRequiresSchema>;

export const AutomationTemplatePackageSchema = z
  .object({
    key: AutomationKeySchema,
    version: z.string().regex(SEMVER_PATTERN, { message: 'must be a semantic version' }),
    name: LocalizedStringSchema,
    category: z.string().min(1).max(60),
    description: LocalizedStringSchema,
    requires: AutomationTemplateRequiresSchema.default({}),
    provider: z
      .object({
        /** Which runtime's graph this carries. Free-form: a future provider is not a new schema. */
        id: z.string().min(1).max(50),
        minVersion: z.string().min(1).max(40).optional(),
      })
      .strict(),
    graph: WorkflowGraphSchema,
    changelog: LocalizedStringSchema.optional(),
    /** Absent ⇒ the package imports as `untrusted` and cannot be installed (§11.4). */
    signature: z.string().min(1).max(4000).optional(),
  })
  .strict();
export type AutomationTemplatePackage = z.infer<typeof AutomationTemplatePackageSchema>;

export const ImportAutomationTemplateSchema = z
  .object({ package: AutomationTemplatePackageSchema })
  .strict();
export type ImportAutomationTemplate = z.infer<typeof ImportAutomationTemplateSchema>;

export const InstallAutomationTemplateSchema = z
  .object({
    version: z.string().regex(SEMVER_PATTERN).optional(),
    /** The installed copy's own key; defaults to the template key. */
    key: AutomationKeySchema.optional(),
    name: LocalizedStringSchema.optional(),
  })
  .strict();
export type InstallAutomationTemplate = z.infer<typeof InstallAutomationTemplateSchema>;

export const ListAutomationTemplatesQuerySchema = PaginationQuerySchema.extend({
  category: z.string().min(1).max(60).optional(),
  trustState: AutomationTemplateTrustStateSchema.optional(),
  /** Only templates whose prerequisites are all satisfiable right now. */
  installable: booleanQuery().optional(),
  q: z.string().min(1).max(120).optional(),
}).strict();
export type ListAutomationTemplatesQuery = z.infer<typeof ListAutomationTemplatesQuerySchema>;

/** Why a template cannot be installed here, in terms an operator can act on. */
export interface AutomationTemplateBlockerDto {
  kind: 'event' | 'credential' | 'capability' | 'platform' | 'provider' | 'trust';
  detail: string;
}

export interface AutomationTemplateDto {
  id: string;
  key: string;
  version: string;
  name: LocalizedString;
  category: string;
  description: LocalizedString;
  requires: AutomationTemplateRequires;
  provider: { id: string; minVersion: string | null };
  trustState: AutomationTemplateTrustState;
  changelog: LocalizedString | null;
  /** Package digest — what an audit record pins, and how two copies are compared. */
  digest: string;
  installable: boolean;
  blockers: AutomationTemplateBlockerDto[];
  importedBy: string | null;
  importedAt: string;
}

// ── Dashboard ───────────────────────────────────────────────────────────────

export const AutomationMetricsQuerySchema = z
  .object({ window: z.enum(['24h', '7d', '30d']).default('7d') })
  .strict();
export type AutomationMetricsQuery = z.infer<typeof AutomationMetricsQuerySchema>;

export interface AutomationMetricsDto {
  window: '24h' | '7d' | '30d';
  workflows: { total: number; active: number; suspended: number };
  executions: Record<AutomationExecutionStatus, number>;
  /** Ranked by failures, because that is the list an operator opens the dashboard to see. */
  topFailing: { workflowId: string; key: string; failures: number }[];
  averageDurationMs: number | null;
}
