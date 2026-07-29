import { z } from 'zod';

// Automation Service contracts (ADR-018, automation-module-design §2.1).
//
// These types are the boundary between ECMS and whatever runtime executes automations. They are
// deliberately shaped by what a runtime must DO, not by what n8n happens to offer — a contract
// modelled on one vendor's payloads is that vendor's SDK with extra steps, and the whole point of
// D-A4 is that the provider is replaceable.
//
// Nothing here mentions n8n, webhooks, or any transport. A provider translates.

// ── Triggers ────────────────────────────────────────────────────────────────

export const AUTOMATION_TRIGGER_KINDS = [
  'event',
  'schedule',
  'cron',
  'manual',
  'webhook',
  'api',
] as const;
export const AutomationTriggerKindSchema = z.enum(AUTOMATION_TRIGGER_KINDS);
export type AutomationTriggerKind = z.infer<typeof AutomationTriggerKindSchema>;

/**
 * A declarative condition over the trigger payload. Field comparisons only — never code.
 *
 * This is deliberately the SAME restricted expression form ADR-011 mandates for workflow guards.
 * A second expression language would mean a second parser, a second test suite and a second
 * security review, for a capability that already exists.
 */
export const AutomationFilterSchema = z.object({
  field: z.string().min(1).max(200),
  op: z.enum(['eq', 'ne', 'in', 'nin', 'gt', 'gte', 'lt', 'lte', 'exists', 'contains']),
  value: z.unknown().optional(),
});
export type AutomationFilter = z.infer<typeof AutomationFilterSchema>;

export const AutomationTriggerSchema = z.object({
  kind: AutomationTriggerKindSchema,
  /** Required when `kind === 'event'`; an event name from the platform catalogue. */
  event: z.string().min(1).max(200).optional(),
  /** Cron expression (5-field) when `kind === 'cron'`. */
  cron: z.string().min(1).max(120).optional(),
  /** Absolute run time when `kind === 'schedule'`. */
  runAt: z.coerce.date().optional(),
  timezone: z.string().min(1).max(60).default('Africa/Cairo'),
  filters: z.array(AutomationFilterSchema).max(20).default([]),
});
export type AutomationTrigger = z.infer<typeof AutomationTriggerSchema>;

// ── Capabilities ────────────────────────────────────────────────────────────

/**
 * What a provider can actually do, DECLARED rather than assumed.
 *
 * The platform asks before it offers: a provider with no visual builder reports
 * `visualBuilder: false` and the UI hides the affordance, instead of rendering a broken frame.
 * Hard-coding "there is always a builder" is precisely the coupling the seam exists to remove.
 */
export const AutomationCapabilitiesSchema = z.object({
  /** The provider hosts an authoring UI that ECMS can proxy. */
  visualBuilder: z.boolean(),
  /** Graphs can be round-tripped — required for template packages (design §11). */
  graphImportExport: z.boolean(),
  /** A running execution can be stopped. */
  cancellation: z.boolean(),
  /** Per-node progress is reported, which is what makes the execution timeline meaningful. */
  perNodeProgress: z.boolean(),
});
export type AutomationCapabilities = z.infer<typeof AutomationCapabilitiesSchema>;

// ── Workflow + execution shapes ─────────────────────────────────────────────

/** An opaque handle to the provider's own workflow. ECMS never interprets `ref`. */
export const ProviderWorkflowRefSchema = z.object({
  providerId: z.string().min(1).max(50),
  ref: z.string().min(1).max(200),
});
export type ProviderWorkflowRef = z.infer<typeof ProviderWorkflowRefSchema>;

export const ProviderExecutionRefSchema = z.object({
  providerId: z.string().min(1).max(50),
  ref: z.string().min(1).max(200),
});
export type ProviderExecutionRef = z.infer<typeof ProviderExecutionRefSchema>;

/** A provider-native workflow graph. Opaque to ECMS — see ADR-018 §Honest limit. */
export const WorkflowGraphSchema = z.object({
  providerId: z.string().min(1).max(50),
  /** Provider-native format version, so a package can be refused rather than half-imported. */
  formatVersion: z.string().min(1).max(40),
  nodes: z.unknown(),
});
export type WorkflowGraph = z.infer<typeof WorkflowGraphSchema>;

export const WorkflowSpecSchema = z.object({
  key: z.string().min(1).max(120),
  name: z.string().min(1).max(200),
  trigger: AutomationTriggerSchema,
  graph: WorkflowGraphSchema.optional(),
});
export type WorkflowSpec = z.infer<typeof WorkflowSpecSchema>;

export const AUTOMATION_EXECUTION_STATUSES = [
  'pending',
  'running',
  'success',
  'failed',
  'cancelled',
  /** The provider was asked to run nothing — the feature flag is off. Recorded, not hidden. */
  'skipped',
] as const;
export const AutomationExecutionStatusSchema = z.enum(AUTOMATION_EXECUTION_STATUSES);
export type AutomationExecutionStatus = z.infer<typeof AutomationExecutionStatusSchema>;

export const AutomationNodeResultSchema = z.object({
  name: z.string().min(1).max(200),
  status: z.enum(['success', 'failed', 'skipped']),
  durationMs: z.number().nonnegative().optional(),
  error: z.string().max(2000).optional(),
});
export type AutomationNodeResult = z.infer<typeof AutomationNodeResultSchema>;

export const ProviderExecutionStateSchema = z.object({
  ref: ProviderExecutionRefSchema,
  status: AutomationExecutionStatusSchema,
  startedAt: z.coerce.date().optional(),
  finishedAt: z.coerce.date().optional(),
  nodes: z.array(AutomationNodeResultSchema).default([]),
  error: z.string().max(4000).optional(),
});
export type ProviderExecutionState = z.infer<typeof ProviderExecutionStateSchema>;

// ── Dispatch ────────────────────────────────────────────────────────────────

/**
 * Everything a provider needs to run one execution.
 *
 * `actor` is the SUBJECT the execution runs as, and carrying it explicitly is what makes §7.2
 * enforceable: a run is always on behalf of the workflow's owner, in that owner's branch, with
 * that owner's permissions. There is no automation superuser to omit it and fall back to.
 */
export const DispatchInputSchema = z.object({
  executionId: z.string().min(1).max(100),
  payload: z.unknown(),
  actor: z.object({
    userId: z.string().min(1),
    branchId: z.string().min(1).optional(),
  }),
  /**
   * Re-entrancy guard. An action may emit an event that re-triggers the same workflow; without a
   * bound, `entity.updated → update entity` is an infinite loop writing to production.
   */
  depth: z.number().int().min(0).max(10).default(0),
  /** Correlates provider logs with ECMS logs for one request. */
  requestId: z.string().optional(),
});
export type DispatchInput = z.infer<typeof DispatchInputSchema>;

export const ProviderHealthSchema = z.object({
  providerId: z.string().min(1),
  reachable: z.boolean(),
  detail: z.string().max(500).optional(),
});
export type ProviderHealth = z.infer<typeof ProviderHealthSchema>;

// ── Configuration ───────────────────────────────────────────────────────────

/** Providers ECMS knows how to construct. `n8n` arrives at A-6; `null` is the default. */
export const AUTOMATION_PROVIDER_IDS = ['null', 'n8n'] as const;
export const AutomationProviderIdSchema = z.enum(AUTOMATION_PROVIDER_IDS);
export type AutomationProviderId = z.infer<typeof AutomationProviderIdSchema>;

/** Reported by `/health` so a deployment's automation posture is visible without guessing. */
export const AutomationStatusDtoSchema = z.object({
  enabled: z.boolean(),
  providerId: z.string(),
  capabilities: AutomationCapabilitiesSchema,
});
export type AutomationStatusDto = z.infer<typeof AutomationStatusDtoSchema>;
