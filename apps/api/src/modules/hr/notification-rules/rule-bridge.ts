// The seam that turns a published platform event into notifications.
//
// It subscribes as an ORDINARY event consumer, the same decision the automation trigger bridge
// made and for the same reason: no new bus, no new delivery guarantee. A business module emits
// `hr.leave.decided` inside its transaction exactly as before, and this — downstream of that
// commit — decides which rules the event answers and tells whoever they name.
//
// IT NEVER THROWS INTO THE BUS. A rule pointed at a field that does not exist, an audience that
// resolves to nobody, a notification service having a bad minute — none of that may fail the
// delivery of a business event to its other consumers. The event already happened; a rule is a
// courtesy on top of it, and a courtesy that can break the thing it is attached to is a liability.
// So the whole handler is wrapped, and every rule is independent of every other.
import mongoose from 'mongoose';
import { type EventEnvelope, RULE_TEMPLATE_KEY, type RuleAudience } from '@ecms/contracts';
import { logger } from '../../../infrastructure/logging/logger';
import { rbacService } from '../../../platform/rbac';
import { employeeRepository } from '../employee-management/employees';
import { audienceCriteria, recipientUserIds, sendLocalisedMessage } from '../announcements';
import { notificationRuleRepository } from './notification-rule.repository';
import { type NotificationRuleDoc } from './notification-rule.model';
import {
  flattenPayload,
  renderRuleText,
  ruleFires,
  subjectEmployeeIds,
} from './rule-matching';

/**
 * Turn a rule's audience into the USER IDS it names.
 *
 * Ids rather than `notify()`'s richer recipient shapes, and deliberately: the message is bilingual
 * and human-written, so it has to be addressed one reading language at a time (see
 * `sendLocalisedMessage`) — and that needs the people, not a description of them. A `permission`
 * audience is therefore resolved here rather than handed to `notify()` to resolve.
 *
 * An empty list is a normal outcome, not an error: a `subject` rule whose payload carries no
 * employee, a filter that matched nobody.
 */
export const resolveUserIds = async (
  audience: RuleAudience,
  payload: unknown,
): Promise<string[]> => {
  if (audience.kind === 'permission') {
    // Names a responsibility rather than a list, so it stays correct as the people holding it
    // change — which is most of why it is worth having.
    return rbacService.listUserIdsWithPermission(audience.permission, 'organization');
  }

  if (audience.kind === 'subject') {
    const employeeIds = subjectEmployeeIds(payload, audience.path);
    if (employeeIds.length === 0) return [];

    const subjects = await employeeRepository.findByIdsSystem(employeeIds);
    const wanted = [...subjects];
    if (audience.includeManager) {
      // A manager is another EMPLOYEE, so their login needs the same read — never assumed from
      // the id on the subject's record.
      const managerIds = subjects
        .map((employee) => employee.employment.managerId)
        .filter((value): value is NonNullable<typeof value> => value !== null)
        .map(String);
      if (managerIds.length > 0) {
        wanted.push(...(await employeeRepository.findByIdsSystem(managerIds)));
      }
    }

    return [
      ...new Set(
        wanted
          .map((employee) => employee.userId)
          .filter((value) => value !== null && value !== undefined)
          .map(String),
      ),
    ];
  }

  // `everyone` and a stage-2 audience both resolve out of the employee registry. A rule runs with
  // no caller, so there is no data scope to apply — which is exactly why authoring one requires an
  // organization-wide grant (see the routes).
  const criteria = audienceCriteria(audience.kind === 'everyone' ? { kind: 'everyone' } : audience.audience);
  const employees = await employeeRepository.listForAudience(criteria, {
    scope: 'organization',
    userId: '',
    branchId: null,
    departmentId: null,
    sectionId: null,
  });
  return recipientUserIds(employees);
};

/** Run one rule. Isolated, so a rule that cannot resolve does not silence the ones beside it. */
const runRule = async (rule: NotificationRuleDoc, envelope: EventEnvelope): Promise<void> => {
  const userIds = await resolveUserIds(rule.audience, envelope.payload);
  if (userIds.length === 0) {
    logger.info({ ruleId: String(rule._id), event: envelope.name }, 'notification rule named nobody');
    return;
  }

  // The event's own values, filling the placeholders the rule's text names — in BOTH languages,
  // from the same payload, so an English reader gets the English sentence with the same data in it.
  const values = flattenPayload(envelope.payload);
  await sendLocalisedMessage({
    template: RULE_TEMPLATE_KEY,
    userIds,
    title: { ar: renderRuleText(rule.title.ar, values), en: renderRuleText(rule.title.en, values) },
    body: { ar: renderRuleText(rule.body.ar, values), en: renderRuleText(rule.body.en, values) },
    entityRef: { moduleId: 'hr', entityType: 'notificationRule', entityId: String(rule._id) },
    // One notification per rule per event, however many times the bus delivers it. The reliable
    // tier can redeliver, and a person told twice that their leave was approved has been told
    // something wrong about how the system works.
    idempotencyKey: `rule:${String(rule._id)}:${envelope.id}`,
  });
  await notificationRuleRepository.recordFired(rule._id, new Date());
};

/**
 * The handler every cataloged event points at.
 *
 * Deliberately shaped like `handleTriggerEvent`: one logical consumer, one handler id, the rules
 * decide the rest. Most events match no rule, and that answer costs one indexed query.
 */
export const handleRuleEvent = async (envelope: EventEnvelope): Promise<void> => {
  // DECLINE IMMEDIATELY WHEN THERE IS NO DATABASE, rather than letting Mongoose buffer.
  //
  // A buffered query does not fail — it waits, for `bufferTimeoutMS` (10s by default), holding a
  // timer. This handler is attached to EVERY cataloged event and is dispatched un-awaited, so a
  // database that is down or still connecting turns each published event into its own ten-second
  // timer. That is a queue of them under any traffic at all, and it outlives whatever asked for it.
  //
  // Answering late would be wrong even if it were free: by the time the buffer drained, the
  // notification is ten seconds stale and the event is long gone. A rule is a courtesy on top of a
  // business event, and the courteous thing to do when it cannot be served is nothing.
  //
  // Quietly, on purpose: a database outage is already reported loudly by everything that has a
  // caller waiting on it. This consumer has none, and one log line per event per outage would bury
  // the reports that matter.
  if (mongoose.connection.readyState !== 1) return;

  try {
    const rules = await notificationRuleRepository.enabledForEvent(envelope.name);
    if (rules.length === 0) return;

    for (const rule of rules) {
      if (!ruleFires(rule, envelope.name, envelope.payload)) continue;
      try {
        await runRule(rule, envelope);
      } catch (error) {
        // One rule's failure is one rule's failure. The others still run, and the event still
        // reaches every other consumer.
        logger.error(
          { ruleId: String(rule._id), event: envelope.name, error },
          'notification rule failed',
        );
      }
    }
  } catch (error) {
    // The read itself failed. Still not the event's problem.
    logger.error({ event: envelope.name, error }, 'notification rules could not be evaluated');
  }
};
