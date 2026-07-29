// Trigger validation — PURE, so it is testable without a database and reusable by the UI.
//
// This is where the event catalogue earns its keep. Every check here exists because the failure it
// prevents is SILENT: a workflow saved against an event nobody publishes, or filtered on a field
// that is never sent, is enabled, green, and does nothing. There is no error to find, no log line,
// no failed execution — just work that never happens.
//
// Validation runs at SAVE time rather than at dispatch time on purpose. Telling someone their
// filter is wrong while they are writing it is worth more than recording it as a skipped run
// three weeks later.
import {
  eventCatalogEntry,
  isCatalogedEventName,
  type AutomationFilter,
  type AutomationTrigger,
} from '@ecms/contracts';

export interface TriggerProblem {
  /** `error` blocks the save; `warning` is recorded and shown, but the save proceeds. */
  severity: 'error' | 'warning';
  path: string;
  message: string;
}

/** Filter paths address payload fields; `entityRef.moduleId` and `lines[].sku` are both valid. */
const isKnownField = (fields: readonly { path: string }[], field: string): boolean =>
  fields.some((declared) => declared.path === field);

const checkFilters = (
  filters: readonly AutomationFilter[],
  eventName: string,
): TriggerProblem[] => {
  const entry = eventCatalogEntry(eventName);
  // No declared payload means no field list to check against. Allowing the filter is the honest
  // outcome: the module has not said what it emits, so nobody can say the filter is wrong.
  if (entry === undefined || !entry.payloadDeclared) return [];

  const problems: TriggerProblem[] = [];
  filters.forEach((filter, index) => {
    if (!isKnownField(entry.fields, filter.field)) {
      problems.push({
        severity: 'error',
        path: `trigger.filters[${index}].field`,
        message: `'${filter.field}' is not a field of ${eventName}. Available: ${entry.fields
          .map((f) => f.path)
          .join(', ')}`,
      });
      return;
    }

    const declared = entry.fields.find((f) => f.path === filter.field);
    if (declared?.type === 'enum' && filter.op === 'eq' && typeof filter.value === 'string') {
      if (declared.values !== undefined && !declared.values.includes(filter.value)) {
        problems.push({
          severity: 'error',
          path: `trigger.filters[${index}].value`,
          message: `'${filter.value}' is not one of ${declared.values.join(', ')}`,
        });
      }
    }

    if (entry.alsoPublishedBy !== null) {
      // The field exists in the shape the owning module declares, but a second publisher emits the
      // same event name with a different shape (see the catalogue's §Known divergence). A filter
      // here matches one cause and not the other, which reads as "it fires sometimes".
      problems.push({
        severity: 'warning',
        path: `trigger.filters[${index}].field`,
        message:
          `${eventName} has more than one publisher with different payload shapes — ` +
          `${entry.alsoPublishedBy}. A filter on '${filter.field}' will not match every cause.`,
      });
    }
  });
  return problems;
};

/**
 * Everything wrong with a trigger, in one pass. Returning a list rather than throwing on the first
 * problem is deliberate: a form that reveals one mistake at a time is a form people give up on.
 */
export const validateTrigger = (trigger: AutomationTrigger): TriggerProblem[] => {
  const problems: TriggerProblem[] = [];

  if (trigger.kind === 'event') {
    const eventName = trigger.event ?? '';
    if (!isCatalogedEventName(eventName)) {
      problems.push({
        severity: 'error',
        path: 'trigger.event',
        message: `'${eventName}' is not an event this platform publishes`,
      });
      return problems; // Nothing downstream can be checked against an event that does not exist.
    }

    const entry = eventCatalogEntry(eventName);
    if (entry?.status === 'planned') {
      // Saveable as a draft — a team may be building the automation ahead of the publisher — but
      // `canEnable` refuses it, because an enabled workflow here would be silently dead.
      problems.push({
        severity: 'warning',
        path: 'trigger.event',
        message: `'${eventName}' is declared but not yet published by any module; a workflow on it cannot be enabled`,
      });
    }
    if (entry?.status === 'deprecated') {
      problems.push({
        severity: 'warning',
        path: 'trigger.event',
        message:
          `'${eventName}' is deprecated` +
          (entry.supersededBy === null ? '' : `; use '${entry.supersededBy}' instead`),
      });
    }

    problems.push(...checkFilters(trigger.filters, eventName));
  }

  if (trigger.kind !== 'event' && trigger.filters.length > 0) {
    // A schedule has no payload to compare against, so a filter on one can only ever be dead code.
    problems.push({
      severity: 'error',
      path: 'trigger.filters',
      message: `a ${trigger.kind} trigger has no event payload to filter on`,
    });
  }

  return problems;
};

export const triggerErrors = (trigger: AutomationTrigger): TriggerProblem[] =>
  validateTrigger(trigger).filter((problem) => problem.severity === 'error');

/**
 * Whether a workflow with this trigger may be ENABLED (as opposed to saved as a draft).
 * Stricter than saving on purpose — enabling is the moment it starts costing money and touching
 * production, so anything that would make it silently inert blocks here.
 */
export const canEnableTrigger = (trigger: AutomationTrigger): { ok: boolean; reason?: string } => {
  const errors = triggerErrors(trigger);
  if (errors.length > 0) return { ok: false, reason: errors[0]?.message ?? 'invalid trigger' };

  if (trigger.kind === 'event') {
    const entry = eventCatalogEntry(trigger.event ?? '');
    if (entry?.status === 'planned') {
      return {
        ok: false,
        reason: `'${trigger.event ?? ''}' has no publisher yet, so this workflow would never run`,
      };
    }
  }
  return { ok: true };
};
