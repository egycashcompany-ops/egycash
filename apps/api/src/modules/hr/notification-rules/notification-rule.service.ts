// CRUD for notification rules, plus the one thing that makes this more than CRUD: a rule is
// REFUSED at save time when it could never fire or could never tell anybody.
//
// Validating on save rather than at dispatch is the whole point. A rule filtered on a field the
// event does not send produces no error, no log line and no failed run — just a notification that
// never comes. Telling somebody their field name is wrong while they are still on the form is
// worth more than a skipped-run record nobody reads three weeks later.
//
// Warnings are recorded and returned, not enforced: an event with no declared payload, a
// deprecated one, a name with two publishers. Each is a reason to look, none is a reason to refuse.
//
// AND THE REFUSAL ONLY APPLIES TO AN ENABLED RULE. A disabled one is saveable however broken it is,
// the same way automation saves an unfireable trigger as a draft — but the reason that matters most
// here is the other direction: TURNING A RULE OFF MUST ALWAYS WORK. If validation guarded every
// write, a rule that became invalid after the fact — an event renamed, a permission retired — could
// no longer be disabled, and switching it off is precisely what somebody is trying to do at that
// moment.
import { Types } from 'mongoose';
import {
  type CreateNotificationRule,
  type ListNotificationRulesQuery,
  type NotificationRuleCheckDto,
  type NotificationRuleDto,
  type Paginated,
  type RulePermissionOptionDto,
  type UpdateNotificationRule,
} from '@ecms/contracts';
import { NotFoundError, StaleDocumentError, ValidationError } from '../../../shared/errors';
import { logger } from '../../../infrastructure/logging/logger';
import { diffChanges } from '../../../shared/utils/diff';
import { auditService } from '../../../platform/audit';
import { rbacService } from '../../../platform/rbac';
import { notificationRuleRepository } from './notification-rule.repository';
import { type NotificationRuleDoc } from './notification-rule.model';
import { resolveUserIds } from './rule-bridge';
import { ruleErrors, ruleProblems, type RuleProblem } from './rule-validation';

const entityRef = (id: string) => ({
  moduleId: 'hr',
  entityType: 'notificationRule',
  entityId: id,
});

const toDto = (doc: NotificationRuleDoc): NotificationRuleDto => ({
  id: String(doc._id),
  name: doc.name,
  event: doc.event,
  filters: doc.filters,
  audience: doc.audience,
  title: doc.title,
  body: doc.body,
  enabled: doc.enabled,
  firedCount: doc.firedCount,
  lastFiredAt: doc.lastFiredAt === null ? null : doc.lastFiredAt.toISOString(),
  createdAt: doc.createdAt.toISOString(),
  version: doc.__v,
});

/** What audit remembers about a rule — the parts a change to which changes who gets told what. */
const snapshot = (doc: NotificationRuleDoc) => ({
  name: doc.name,
  event: doc.event,
  filters: doc.filters,
  audience: doc.audience,
  title: doc.title,
  body: doc.body,
  enabled: doc.enabled,
});

const asValidationError = (problems: RuleProblem[]): ValidationError =>
  new ValidationError(
    problems.map((problem) => ({
      field: problem.path,
      code: 'RULE_WOULD_NEVER_FIRE',
      message: problem.message,
    })),
    'This rule could never fire as written',
  );

class NotificationRuleService {
  /**
   * Check a rule without saving it, so the form can show what is wrong while it is being written.
   *
   * Same function the save uses, deliberately: a preview that disagrees with the save is worse
   * than no preview, because it teaches people to ignore it.
   */
  async check(rule: {
    event: string;
    filters: CreateNotificationRule['filters'];
    audience: CreateNotificationRule['audience'];
  }): Promise<NotificationRuleCheckDto> {
    return {
      problems: ruleProblems(rule, await this.knownPermissions()),
      recipients: await this.reachCount(rule.audience),
    };
  }

  /**
   * How many people this audience comes to RIGHT NOW, or `null` when that cannot be known.
   *
   * The number an author would otherwise never see. A rule is written once and fires unattended
   * for months: "everyone" on a per-employee event is a flood nobody notices until it arrives, and
   * an audience that resolves to nobody is a rule that looks installed and does nothing. Both are
   * invisible from the form and neither raises anything.
   *
   * Produced by the SAME function the bridge uses, never by a second implementation — the two
   * disagreeing is what makes a preview worse than none.
   *
   * `subject` is honestly `null`: its recipient is read out of each event's payload, so there is
   * no answer until one arrives. Saying "1" would be a guess dressed as a count.
   */
  private async reachCount(audience: CreateNotificationRule['audience']): Promise<number | null> {
    if (audience.kind === 'subject') return null;
    try {
      return (await resolveUserIds(audience, {})).length;
    } catch (error) {
      // A count is a courtesy; failing to produce one must not block the form from telling the
      // author about the problems it DID find.
      logger.warn({ error }, 'notification rule audience could not be counted');
      return null;
    }
  }

  async create(input: CreateNotificationRule, by: string): Promise<NotificationRuleDto> {
    if (input.enabled) {
      const errors = ruleErrors(input, await this.knownPermissions());
      if (errors.length > 0) throw asValidationError(errors);
    }

    const doc = await notificationRuleRepository.create({
      name: input.name,
      event: input.event,
      filters: input.filters,
      audience: input.audience,
      title: input.title,
      body: input.body,
      enabled: input.enabled,
      firedCount: 0,
      lastFiredAt: null,
      createdBy: new Types.ObjectId(by),
      createdAt: new Date(),
      isDeleted: false,
    });

    await auditService.record({
      entityRef: entityRef(String(doc._id)),
      action: 'create',
      changes: diffChanges({}, snapshot(doc)),
    });
    return toDto(doc);
  }

  /**
   * Edit at a known version.
   *
   * The MERGED rule is validated, not the patch — switching the event while leaving the old filters
   * in place is the ordinary way to end up with a rule that can never match, and checking only what
   * changed would let it through. And only when the result is enabled, so switching a broken rule
   * off is never the thing that is refused.
   */
  async update(id: string, input: UpdateNotificationRule): Promise<NotificationRuleDto> {
    const existing = await notificationRuleRepository.findById(id);
    if (existing === null) throw new NotFoundError('Notification rule not found');

    const { version, ...patch } = input;
    const merged = {
      event: patch.event ?? existing.event,
      filters: patch.filters ?? existing.filters,
      audience: patch.audience ?? existing.audience,
    };
    if (patch.enabled ?? existing.enabled) {
      const errors = ruleErrors(merged, await this.knownPermissions());
      if (errors.length > 0) throw asValidationError(errors);
    }

    // A patch of nothing but a version is a valid request — Mongo refuses an empty `$set`, so it
    // becomes a version check with no write rather than an error about a document nobody changed.
    const updated = await notificationRuleRepository.updateAtVersion(
      id,
      version,
      Object.keys(patch).length === 0 ? {} : { $set: patch },
    );
    if (updated === null) throw new StaleDocumentError();

    await auditService.record({
      entityRef: entityRef(id),
      action: 'update',
      changes: diffChanges(snapshot(existing), snapshot(updated)),
    });
    return toDto(updated);
  }

  async remove(id: string): Promise<void> {
    const removed = await notificationRuleRepository.softDelete(id);
    if (!removed) throw new NotFoundError('Notification rule not found');
    await auditService.record({ entityRef: entityRef(id), action: 'delete' });
  }

  async get(id: string): Promise<NotificationRuleDto> {
    const doc = await notificationRuleRepository.findById(id);
    if (doc === null) throw new NotFoundError('Notification rule not found');
    return toDto(doc);
  }

  async list(query: ListNotificationRulesQuery): Promise<Paginated<NotificationRuleDto>> {
    const { items, total } = await notificationRuleRepository.list(query.page, query.pageSize);
    return {
      items: items.map(toDto),
      meta: {
        page: query.page,
        pageSize: query.pageSize,
        totalItems: total,
        totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
      },
    };
  }

  /** The permissions a `permission` audience may name, for the picker. */
  async permissionOptions(): Promise<RulePermissionOptionDto[]> {
    const permissions = await rbacService.listPermissions();
    return permissions.map((permission) => ({
      key: permission.key,
      name: permission.name,
      moduleId: permission.moduleId,
    }));
  }

  /** The permission keys a `permission` audience may name — the registry, not a guess. */
  private async knownPermissions(): Promise<string[]> {
    const permissions = await rbacService.listPermissions();
    return permissions.map((permission) => permission.key);
  }
}

export const notificationRuleService = new NotificationRuleService();
