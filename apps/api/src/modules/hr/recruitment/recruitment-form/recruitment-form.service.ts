// The intake form: reading it, editing it, publishing a link per source, and taking what a
// candidate submits through one of those links.
//
// The public path is deliberately narrow. It can do exactly one thing — register an applicant
// against the source its token names — and it does it by calling the SAME
// `applicantService.register` a recruiter's form calls, after the SAME `RegisterApplicantSchema`.
// There is no public write that is not that.
import { randomBytes } from 'node:crypto';
import { Types } from 'mongoose';
import {
  RECRUITMENT_FORM_DEFAULTS,
  RegisterApplicantSchema,
  type LocalizedString,
  type PublicRecruitmentFormDto,
  type RecruitmentFormDto,
  type RecruitmentFormField,
  type RecruitmentFormLinkDto,
  type RecruitmentFormSubmissionDto,
  type UpdateRecruitmentForm,
} from '@ecms/contracts';
import { ConflictError, NotFoundError, ValidationError } from '../../../../shared/errors';
import { auditService } from '../../../../platform/audit';
import { env } from '../../../../infrastructure/config/env';
import { type AuthContext } from '../../../../shared/types';
import { applicantSourceRepository } from '../applicants/applicant-source.repository';
import { applicantService } from '../applicants/applicant.service';
import { recruitmentFormRepository } from './recruitment-form.repository';
import { type RecruitmentFormDoc } from './recruitment-form.model';
import { missingRequired, toRegistrationBody, type Answers } from './apply-mapper';

const entityRef = (id: string) => ({ moduleId: 'hr', entityType: 'recruitmentForm', entityId: id });

const DEFAULT_TITLE: LocalizedString = { ar: 'طلب توظيف', en: 'Job application' };

/** The four the frozen request names, all required — a fresh install is usable immediately. */
const defaultFields = (): RecruitmentFormField[] =>
  RECRUITMENT_FORM_DEFAULTS.map((key) => ({ type: 'builtin', key, required: true }));

/** 32 hex characters from the CSPRNG — a link is a bearer credential, not an identifier. */
const newToken = (): string => randomBytes(16).toString('hex');

const publicUrl = (token: string): string => `${env.WEB_PUBLIC_URL.replace(/\/$/, '')}/apply/${token}`;

class RecruitmentFormService {
  /** The singleton, created on first read so no install step can be forgotten. */
  private async load(): Promise<RecruitmentFormDoc> {
    const existing = await recruitmentFormRepository.findSingleton();
    if (existing !== null) return existing;
    return recruitmentFormRepository.create(
      {
        key: 'default',
        title: DEFAULT_TITLE,
        intro: null,
        fields: defaultFields(),
        internalSourceId: null,
        links: [],
      },
      { by: 'system' },
    );
  }

  async get(): Promise<RecruitmentFormDto> {
    return this.toDto(await this.load());
  }

  private async toDto(doc: RecruitmentFormDoc): Promise<RecruitmentFormDto> {
    // Every ACTIVE source is listed, with or without a link — the page's job is to show what can
    // be published, not only what already has been.
    const sources = await applicantSourceRepository.list({
      filter: { active: true },
      page: 1,
      pageSize: 100,
      sortDir: 'asc',
    });
    const byId = new Map(doc.links.map((l) => [String(l.sourceId), l]));
    const links: RecruitmentFormLinkDto[] = sources.items.map((s) => {
      const link = byId.get(String(s._id));
      return {
        sourceId: String(s._id),
        sourceName: s.name,
        token: link?.token ?? null,
        url: link === undefined || !link.active ? null : publicUrl(link.token),
        active: link?.active ?? false,
        generatedAt: link?.generatedAt.toISOString() ?? null,
        submissions: link?.submissions ?? 0,
      };
    });
    return {
      id: String(doc._id),
      title: doc.title,
      intro: doc.intro,
      fields: doc.fields,
      internalSourceId: doc.internalSourceId === null ? null : String(doc.internalSourceId),
      links,
      version: doc.__v,
    };
  }

  async update(ctx: AuthContext, input: UpdateRecruitmentForm): Promise<RecruitmentFormDto> {
    const doc = await this.load();
    if (doc.__v !== input.version) {
      throw new ConflictError('The form changed while you were editing it. Reload and try again.');
    }
    if (input.internalSourceId !== undefined && input.internalSourceId !== null) {
      const source = await applicantSourceRepository.findActiveById(input.internalSourceId);
      if (source === null) {
        throw new ValidationError(
          [{ field: 'internalSourceId', code: 'unknown', message: 'Unknown or inactive source' }],
        );
      }
    }
    const updated = await recruitmentFormRepository.updateById(
      String(doc._id),
      {
        ...(input.title === undefined ? {} : { title: input.title }),
        ...(input.intro === undefined ? {} : { intro: input.intro }),
        ...(input.fields === undefined ? {} : { fields: input.fields }),
        ...(input.internalSourceId === undefined
          ? {}
          : {
              internalSourceId:
                input.internalSourceId === null ? null : new Types.ObjectId(input.internalSourceId),
            }),
      },
      { by: ctx.userId, version: input.version },
    );
    await auditService.record({
      entityRef: entityRef(String(doc._id)),
      action: 'update',
      changes: [{ field: 'fields', old: doc.fields.length, new: updated.fields.length }],
    });
    return this.toDto(updated);
  }

  /**
   * Publish (or re-publish) this form to a source. Re-generating REPLACES the token: that is the
   * remedy for a link that leaked, so the old URL must stop working the moment the new one exists.
   */
  async generateLink(ctx: AuthContext, sourceId: string): Promise<RecruitmentFormDto> {
    const source = await applicantSourceRepository.findActiveById(sourceId);
    if (source === null) {
      throw new ValidationError([{ field: 'sourceId', code: 'unknown', message: 'Unknown or inactive source' }]);
    }
    const doc = await this.load();
    const token = newToken();
    const links = doc.links.filter((l) => String(l.sourceId) !== sourceId);
    links.push({
      sourceId: new Types.ObjectId(sourceId),
      token,
      active: true,
      generatedAt: new Date(),
      // A rotated link starts its own count; the applicants already registered keep pointing at
      // the source, which is where the lifetime total belongs.
      submissions: 0,
    });
    const updated = await recruitmentFormRepository.updateById(
      String(doc._id),
      { links },
      { by: ctx.userId, version: doc.__v },
    );
    await auditService.record({
      entityRef: entityRef(String(doc._id)),
      action: 'update',
      changes: [{ field: 'link', old: null, new: sourceId }],
    });
    return this.toDto(updated);
  }

  /** Withdraw a published link without forgetting it was published. */
  async revokeLink(ctx: AuthContext, sourceId: string): Promise<RecruitmentFormDto> {
    const doc = await this.load();
    const links = doc.links.map((l) =>
      String(l.sourceId) === sourceId ? { ...l, active: false } : l,
    );
    const updated = await recruitmentFormRepository.updateById(
      String(doc._id),
      { links },
      { by: ctx.userId, version: doc.__v },
    );
    await auditService.record({
      entityRef: entityRef(String(doc._id)),
      action: 'update',
      changes: [{ field: 'link', old: sourceId, new: null }],
    });
    return this.toDto(updated);
  }

  // ── Public ────────────────────────────────────────────────────────────────

  private async resolve(token: string): Promise<{ doc: RecruitmentFormDoc; sourceId: string; sourceName: LocalizedString }> {
    const doc = await recruitmentFormRepository.findByToken(token);
    const link = doc?.links.find((l) => l.token === token && l.active);
    if (doc === null || link === undefined) throw new NotFoundError('Application form');
    const source = await applicantSourceRepository.findActiveById(String(link.sourceId));
    // A revoked source takes its links with it — the form is only reachable while the thing it
    // records still exists.
    if (source === null) throw new NotFoundError('Application form');
    return { doc, sourceId: String(link.sourceId), sourceName: source.name };
  }

  async getPublic(token: string): Promise<PublicRecruitmentFormDto> {
    const { doc, sourceName } = await this.resolve(token);
    return { title: doc.title, intro: doc.intro, sourceName, fields: doc.fields };
  }

  async submit(token: string, answers: Answers): Promise<RecruitmentFormSubmissionDto> {
    const { doc, sourceId } = await this.resolve(token);

    const missing = missingRequired(doc.fields, answers);
    if (missing.length > 0) {
      throw new ValidationError(
        missing.map((field) => ({ field, code: 'required', message: 'This answer is required' })),
        'Required answers are missing',
      );
    }

    // One schema, one set of rules — the public path earns no exemptions.
    const parsed = RegisterApplicantSchema.safeParse({
      sourceId,
      intakeChannel: 'web',
      ...toRegistrationBody(doc.fields, answers),
    });
    if (!parsed.success) {
      throw new ValidationError(
        parsed.error.issues.map((i) => ({
          // Report the FIELD the candidate filled, not the API path it maps to: "contact.email"
          // means nothing on a page whose box is labelled "البريد الإلكتروني".
          field: builtinFor(i.path.map(String)),
          code: 'invalid',
          message: i.message,
        })),
        'Some answers are not valid',
      );
    }

    // The registrar of a public application is the system, not a user: nobody was logged in.
    const applicant = await applicantService.register(publicContext(), parsed.data);
    await recruitmentFormRepository.countSubmission(String(doc._id), token);
    return { code: applicant.code };
  }
}

/** Map an API path back to the form field a candidate can actually see and fix. */
const builtinFor = (path: string[]): string => {
  const last = path[path.length - 1] ?? '';
  const head = path[0] ?? '';
  if (head === 'identity' || head === 'contact') return last;
  if (head === 'officialAddress') return last === 'line1' ? 'addressLine1' : last;
  if (head === 'education') return last === 'level' ? 'educationLevel' : `education${last[0]?.toUpperCase() ?? ''}${last.slice(1)}`;
  if (head === 'military') return 'militaryStatus';
  if (head === 'expectedSalary') return 'expectedSalary';
  return head === '' ? 'form' : head;
};

/**
 * A public submission has no signed-in user. It is recorded as an unattributed system action
 * rather than borrowed from some admin account, so the audit trail says what actually happened.
 */
const publicContext = (): AuthContext =>
  ({
    userId: 'system',
    permissions: { 'applicant.create': 'organization' },
    branchId: null,
    departmentId: null,
    sectionId: null,
    isPrivileged: false,
  }) as unknown as AuthContext;

export const recruitmentFormService = new RecruitmentFormService();
