// Sending an announcement: resolve the audience, then hand it to the platform.
//
// The delivery half is deliberately thin. `notificationsService.notify()` already decides channels
// per recipient, honours their preferences and quiet hours, renders both languages, queues email
// and push, and audits every transition — so an announcement is one `notify()` call against a
// template, not a second delivery pipeline. Everything specific to this feature is the audience,
// and that lives next door in `audience-criteria` where it can be tested without a database.
import { Types } from 'mongoose';
import {
  ANNOUNCEMENT_TEMPLATE_KEY,
  type AnnouncementAudience,
  type AnnouncementDto,
  type AudienceOptionsDto,
  type AudiencePreviewDto,
  type CreateAnnouncement,
  type ListAnnouncementsQuery,
  type Paginated,
} from '@ecms/contracts';
import { notificationsService } from '../../../platform/notifications';
import { userService } from '../../../platform/users';
import { type AuthContext, type ScopeSelector } from '../../../shared/types';
import { employeeRepository, type EmployeeDoc } from '../employee-management/employees';
import { audienceCriteria, recipientUserIds, splitReachable } from './audience-criteria';
import { AnnouncementModel, type AnnouncementDoc } from './announcement.model';

/** How many matched names a preview shows — enough to recognise a wrong filter, not a directory. */
const SAMPLE_SIZE = 5;

const toDto = (doc: AnnouncementDoc, senderName: string | null): AnnouncementDto => ({
  id: String(doc._id),
  title: doc.title,
  body: doc.body,
  audience: doc.audience,
  priority: doc.priority,
  channels: doc.channels,
  matched: doc.matched,
  recipients: doc.recipients,
  unreachable: doc.unreachable,
  sentBy: String(doc.sentBy),
  sentByName: senderName,
  sentAt: doc.sentAt.toISOString(),
});

class AnnouncementService {
  /**
   * Resolve an audience to the employees it selects, narrowed by the caller's own scope.
   *
   * One method, used by both the preview and the send, so the number a sender is shown is
   * produced by the same code that decides who receives — the two disagreeing is the failure that
   * makes a preview worse than none.
   */
  private async resolve(
    audience: AnnouncementAudience,
    scope: ScopeSelector,
  ): Promise<EmployeeDoc[]> {
    return employeeRepository.listForAudience(audienceCriteria(audience), scope);
  }

  /**
   * What an audience comes to, without sending anything.
   *
   * A filter that quietly matches four thousand people is the mistake this exists to prevent —
   * and so is one that matches nobody because a criterion was mis-set. Both are visible here and
   * neither is visible from the compose form alone.
   */
  async preview(audience: AnnouncementAudience, scope: ScopeSelector): Promise<AudiencePreviewDto> {
    const employees = await this.resolve(audience, scope);
    const { unreachable } = splitReachable(employees);
    return {
      matched: employees.length,
      // Deduplicated, because that is the number of notifications this will create.
      recipients: recipientUserIds(employees).length,
      unreachable,
      sample: employees.slice(0, SAMPLE_SIZE).map((employee) => ({
        id: String(employee._id),
        code: employee.code,
        name: employee.personal.fullNameAr,
      })),
      // The sender asked for the whole company but holds less than the whole company.
      narrowedByScope: audience.kind === 'everyone' && scope.scope !== 'organization',
    };
  }

  /**
   * Send, and record what was sent.
   *
   * The announcement row is written FIRST and unconditionally, before `notify()` — so an audience
   * that turns out to be empty, or a delivery that partly fails, still leaves an answer to "what
   * did we announce?". A send with no recipients is recorded and creates nothing, which is the
   * honest outcome for a filter that matched nobody.
   */
  async send(input: CreateAnnouncement, ctx: AuthContext, scope: ScopeSelector): Promise<AnnouncementDto> {
    const employees = await this.resolve(input.audience, scope);
    const { unreachable } = splitReachable(employees);
    const userIds = recipientUserIds(employees);

    const doc = await AnnouncementModel.create({
      title: input.title,
      body: input.body,
      audience: input.audience,
      priority: input.priority,
      channels: input.channels ?? [],
      matched: employees.length,
      recipients: userIds.length,
      unreachable,
      sentBy: new Types.ObjectId(ctx.userId),
      sentAt: new Date(),
    });

    // ONE SEND PER READING LANGUAGE.
    //
    // A template renders one `data` map into both languages, and the platform requires every
    // declared variable to appear in both language bodies — so a single call cannot give an Arabic
    // reader the Arabic text and an English reader the English one. It would give everybody
    // whichever half was passed.
    //
    // So the split moves here: recipients are grouped by the language they read, and each group is
    // addressed its own copy of the message the sender wrote. The cost is honest and worth naming —
    // a person's stored notification carries the text they were addressed in on BOTH language
    // fields, so switching languages afterwards does not retranslate it. It is a human's words,
    // not a rendered template; there is no other copy to show them.
    if (userIds.length > 0) {
      const locales = await userService.localesAmong(userIds);
      const groups: Record<'ar' | 'en', string[]> = { ar: [], en: [] };
      // An account the read did not return keeps the platform default rather than being dropped:
      // a missing row must never cost somebody the announcement.
      for (const userId of userIds) groups[locales.get(userId) ?? 'ar'].push(userId);

      for (const language of ['ar', 'en'] as const) {
        const group = groups[language];
        if (group.length === 0) continue;
        await notificationsService.notify({
          template: ANNOUNCEMENT_TEMPLATE_KEY,
          to: { userIds: group },
          data: { title: input.title[language], body: input.body[language] },
          entityRef: { moduleId: 'hr', entityType: 'announcement', entityId: String(doc._id) },
        });
      }
    }

    return toDto(doc.toObject() as AnnouncementDoc, null);
  }

  /** The values the two free-text criteria actually hold, so the builder offers real choices. */
  async audienceOptions(scope: ScopeSelector): Promise<AudienceOptionsDto> {
    const [religions, nationalities] = await Promise.all([
      employeeRepository.distinctPersonal('religion', scope),
      employeeRepository.distinctPersonal('nationality', scope),
    ]);
    return { religions, nationalities };
  }

  /** What has been announced, newest first. A read of the sender's record, not of anyone's inbox. */
  async list(query: ListAnnouncementsQuery): Promise<Paginated<AnnouncementDto>> {
    const total = await AnnouncementModel.countDocuments().exec();
    const docs = await AnnouncementModel.find()
      .sort({ sentAt: -1 })
      .skip((query.page - 1) * query.pageSize)
      .limit(query.pageSize)
      .lean<AnnouncementDoc[]>()
      .exec();
    return {
      items: docs.map((doc) => toDto(doc, null)),
      meta: {
        page: query.page,
        pageSize: query.pageSize,
        totalItems: total,
        totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
      },
    };
  }
}

export const announcementService = new AnnouncementService();
