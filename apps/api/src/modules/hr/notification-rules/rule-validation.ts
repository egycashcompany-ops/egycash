// Is this rule capable of ever firing, and of ever telling anybody? PURE — no database, so the
// answers are testable and the UI can show them while somebody is still typing.
//
// Every check here exists because the failure it prevents is SILENT. A rule saved against an event
// nobody publishes, filtered on a field that is never sent, or pointed at a payload path that does
// not exist, is enabled, green, and does nothing. Nobody reports it, because there is nothing to
// report — the notification simply never comes, and the person waiting for it assumes the system
// works differently than they thought.
//
// The event and filter half is `validateTrigger`, borrowed WHOLE from automation rather than
// reimplemented. A rule and a workflow trigger ask the same question of the same catalogue; two
// implementations of that question is how the two answers start to differ.
import {
  eventCatalogEntry,
  isRuleTriggerable,
  type AutomationFilter,
  type RuleAudience,
} from '@ecms/contracts';
import { validateTrigger, type TriggerProblem } from '../../automation/workflows/trigger-validation';

export { type TriggerProblem as RuleProblem } from '../../automation/workflows/trigger-validation';

/**
 * The event and its filters, checked against the catalogue.
 *
 * `validateTrigger` wants an `AutomationTrigger`, so one is constructed here. The fabricated
 * fields (`timezone`) are inert for an event trigger — the alternative was a second copy of the
 * field-and-enum checking, which is a worse trade than an unused property.
 */
const eventProblems = (event: string, filters: readonly AutomationFilter[]): TriggerProblem[] => {
  // Checked before the catalogue, because this one is about what a rule may do rather than about
  // what the platform emits — `platform.notification.created` is a perfectly real event, and that
  // is exactly why a rule on it would loop for ever (see `RULE_FORBIDDEN_EVENT_PREFIX`).
  if (!isRuleTriggerable(event)) {
    return [
      {
        severity: 'error',
        path: 'event',
        message: `a rule may not trigger on '${event}': a notification event would answer this rule's own output`,
      },
    ];
  }

  return validateTrigger({
    kind: 'event',
    event,
    timezone: 'Africa/Cairo',
    filters: [...filters],
  }).map((problem) => ({
    ...problem,
    // `trigger.` is the workflow's path prefix; a rule has no trigger object.
    path: problem.path.replace(/^trigger\./, ''),
  }));
};

/**
 * A `permission` audience, checked against the permission registry.
 *
 * Independent of the event, so it is worth answering even when the event is also wrong: a key that
 * does not exist grants nobody, so the rule would fire correctly and tell nobody, for ever.
 */
const permissionAudienceProblems = (
  audience: RuleAudience,
  knownPermissions: readonly string[],
): TriggerProblem[] => {
  if (audience.kind !== 'permission') return [];
  if (knownPermissions.includes(audience.permission)) return [];
  return [
    {
      severity: 'error',
      path: 'audience.permission',
      message: `'${audience.permission}' is not a permission this platform declares`,
    },
  ];
};

/**
 * A `subject` audience's path, checked against the event's own field list.
 *
 * This is the check worth having. "Tell the person this is about" is most of why a rule exists,
 * and getting the field name wrong — `employeeId` where the event sends `applicantId` — produces a
 * rule that fires correctly, matches correctly, and tells nobody, every time.
 */
const subjectPathProblems = (audience: RuleAudience, event: string): TriggerProblem[] => {
  if (audience.kind !== 'subject') return [];

  const entry = eventCatalogEntry(event);
  // No declared payload means no field list to check against — the module has not said what it
  // emits, so nobody can say the path is wrong. A warning rather than silence: the author should
  // know the platform could not confirm this one for them.
  if (entry === undefined || !entry.payloadDeclared) {
    return [
      {
        severity: 'warning',
        path: 'audience.path',
        message: `${event} does not declare its payload, so '${audience.path}' cannot be checked`,
      },
    ];
  }

  if (entry.fields.some((field) => field.path === audience.path)) return [];
  return [
    {
      severity: 'error',
      path: 'audience.path',
      message: `'${audience.path}' is not a field of ${event}. Available: ${entry.fields
        .map((field) => field.path)
        .join(', ')}`,
    },
  ];
};

export interface EvaluableRuleInput {
  event: string;
  filters: readonly AutomationFilter[];
  audience: RuleAudience;
}

/**
 * Everything wrong with a rule, in one pass.
 *
 * A list rather than a throw on the first problem, for the same reason automation returns one: a
 * form that reveals one mistake at a time is a form people give up on.
 *
 * The one thing deliberately NOT reported alongside the rest is the subject path when the event
 * itself is unknown. There is no field list to check it against, so the only honest answer is the
 * one already given — fix the event first.
 */
export const ruleProblems = (
  rule: EvaluableRuleInput,
  knownPermissions: readonly string[],
): TriggerProblem[] => {
  const problems = eventProblems(rule.event, rule.filters);
  const eventIsUsable = !problems.some((problem) => problem.severity === 'error');
  return [
    ...problems,
    ...permissionAudienceProblems(rule.audience, knownPermissions),
    ...(eventIsUsable ? subjectPathProblems(rule.audience, rule.event) : []),
  ];
};

export const ruleErrors = (
  rule: EvaluableRuleInput,
  knownPermissions: readonly string[],
): TriggerProblem[] =>
  ruleProblems(rule, knownPermissions).filter((problem) => problem.severity === 'error');
