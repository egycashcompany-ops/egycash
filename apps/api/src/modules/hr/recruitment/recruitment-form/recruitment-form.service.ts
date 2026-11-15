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
  PUBLIC_APPLY_DOCUMENTS,
  PUBLIC_HEARD_FROM_FIELD,
  PUBLIC_ID_CARD_FIELD,
  PUBLIC_MILITARY_FIELD,
  RECRUITMENT_FORM_DEFAULTS,
  RegisterApplicantSchema,
  asciiDigits,
  parseNationalId,
  type PublicApplyDocument,
  type PublicIdCardError,
  type SubmitRecruitmentForm,
  type PublicNationalIdCardUploadDto,
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
import { extractNationalIdFields } from '../applicants/national-id-ocr';
import { APPLICANT_CARD_SCAN_ENTITY_TYPE } from '../applicants/national-id-scan.files';
import { fileService, type UploadedBinary } from '../../../../platform/files';
import { logger } from '../../../../infrastructure/logging/logger';
import {
  applicantDocumentService,
  applicantDocumentTypeService,
  publicApplyFilingContext,
} from '../applicant-documents';
import { recruitmentFormRepository } from './recruitment-form.repository';
import { APPLICANT_CV_MIME_TYPES, resolveApplicantCvCategoryId } from './applicant-cv.files';
import { type RecruitmentFormDoc } from './recruitment-form.model';
import { invalidCustom, missingRequired, toRegistrationBody, type Answers } from './apply-mapper';

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
      // Nobody created this — the first reader did, on the system's behalf. `by` is written as an
      // ObjectId, and the string 'system' is not one: `new Types.ObjectId('system')` throws, so
      // this line turned every first visit to the page into a 500 and the document was never
      // created, which made the failure permanent rather than one-off. `null` is what "no user"
      // has always meant here — `createdBy` is nullable and the repository maps it straight
      // through.
      { by: null },
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
    const { doc, sourceId, sourceName } = await this.resolve(token);
    const sources = await applicantSourceRepository.listActive();
    return {
      title: doc.title,
      intro: doc.intro,
      sourceName,
      fields: doc.fields,
      sources: sources.map((s) => ({ id: String(s._id), name: s.name })),
      linkSourceId: sourceId,
    };
  }

  /**
   * One National-ID card photo from the public page, filed in the link's own scratch bucket so a
   * submission can name only photos uploaded through a live link of the same source.
   */
  async uploadCardPhoto(token: string, binary: UploadedBinary): Promise<PublicNationalIdCardUploadDto> {
    const { sourceId } = await this.resolve(token);
    return applicantService.uploadNationalIdCardScan(publicContext(), binary, portalBucket(sourceId));
  }

  /**
   * The candidate's CV, from the public page — a PDF, a Word file or a photo. Filed in the link's
   * scratch bucket like the card photos, and copied onto the applicant when the application is sent.
   */
  async uploadCv(token: string, binary: UploadedBinary): Promise<PublicNationalIdCardUploadDto> {
    const { sourceId } = await this.resolve(token);
    if (!APPLICANT_CV_MIME_TYPES.includes(binary.mime)) {
      throw new ValidationError([
        { field: 'file', code: 'UNSUPPORTED_MEDIA_TYPE', message: 'a CV must be a PDF, a Word file or a photo' },
      ]);
    }
    const file = await fileService.upload(
      publicContext(),
      {
        moduleId: 'hr',
        entityType: APPLICANT_CARD_SCAN_ENTITY_TYPE,
        entityId: portalBucket(sourceId),
        categoryId: await resolveApplicantCvCategoryId(),
        displayName: binary.originalName,
        visibility: 'private',
        tags: [],
      },
      binary,
    );
    return { fileId: String(file._id) };
  }

  /** Copy the CV onto the applicant, named as their CV. Never fails the accepted application. */
  private async fileCv(applicantId: string, applicantName: string, cvFileId: string): Promise<void> {
    try {
      await fileService.copy(publicContext(), cvFileId, {
        moduleId: 'hr',
        entityType: 'applicant',
        entityId: applicantId,
        categoryId: await resolveApplicantCvCategoryId(),
        displayName: `${applicantName} — السيرة الذاتية (CV)`,
        visibility: 'private',
      });
    } catch (error) {
      logger.warn({ err: error, applicantId }, 'public apply: filing the CV failed');
    }
  }

  /**
   * THE CARD GATE. The front and back photos are read by the OCR, and the application is accepted
   * only when the card reads clearly and its number is the number the applicant typed. Anything
   * else — no photos, the reader down, a blurred or unreadable card, a different number — refuses
   * the submission with a code the page turns into an instruction (retake the photo, check the
   * number, try again later). Returns the verified National ID.
   */
  private async verifyCard(
    sourceId: string,
    typedNationalId: string | undefined,
    card: { frontFileId: string; backFileId: string } | undefined,
  ): Promise<{ nationalId: string; portraitFileId: string | null; address: string | null; city: string | null }> {
    const refuse = (code: PublicIdCardError, message: string): never => {
      throw new ValidationError([{ field: PUBLIC_ID_CARD_FIELD, code, message }], message);
    };
    if (card === undefined) refuse('ID_CARD_REQUIRED', 'Photos of both sides of the National ID card are required');
    const { frontFileId, backFileId } = card as { frontFileId: string; backFileId: string };
    for (const id of [frontFileId, backFileId]) {
      if (!(await inBucket(id, sourceId))) refuse('ID_CARD_REQUIRED', 'Upload the card photos again');
    }

    let result: Awaited<ReturnType<typeof extractNationalIdFields>>;
    try {
      result = await extractNationalIdFields({ frontFileId, backFileId, actor: publicContext() });
      // Candidates often put the two sides in the wrong boxes. The number is read off the FRONT,
      // so when nothing usable came back, read the pair the other way round before refusing.
      if (result.available && (result.nationalId === null || result.nationalId.confidence === 'low')) {
        const swapped = await extractNationalIdFields({
          frontFileId: backFileId,
          backFileId: frontFileId,
          actor: publicContext(),
        });
        if (swapped.nationalId !== null && swapped.nationalId.confidence !== 'low') result = swapped;
      }
    } catch (error) {
      logger.warn({ err: error }, 'public apply: national-id OCR failed');
      return refuse('ID_OCR_UNAVAILABLE', 'The card could not be checked right now — please try again in a few minutes');
    }
    if (!result.available) {
      refuse('ID_OCR_UNAVAILABLE', 'The card could not be checked right now — please try again in a few minutes');
    }
    const read = result.nationalId === null ? null : asciiDigits(result.nationalId.value).replace(/\D/g, '');
    const rejectedPhoto =
      result.quality?.front?.verdict === 'reject' || result.quality?.back?.verdict === 'reject';
    if (
      read === null ||
      rejectedPhoto ||
      result.nationalId?.confidence === 'low' ||
      parseNationalId(read) === null
    ) {
      refuse('ID_CARD_UNREADABLE', 'The card could not be read clearly — retake a sharper, well-lit photo of each side');
    }
    const typed = typedNationalId === undefined ? undefined : asciiDigits(typedNationalId).replace(/\D/g, '');
    if (typed !== undefined && typed !== read) {
      refuse('ID_CARD_MISMATCH', 'The National ID number on the card does not match the number you entered');
    }
    // The holder's face, cut from the card by the reader — kept with the card like HR's scan, so the
    // interviewer sees who is coming. Never fails the application.
    let portraitFileId: string | null = null;
    const portrait = result.images?.portrait;
    if (portrait !== undefined) {
      try {
        const buffer = Buffer.from(portrait.split(',', 2)[1] ?? '', 'base64');
        if (buffer.length > 0) {
          const up = await applicantService.uploadNationalIdCardScan(
            publicContext(),
            { originalName: 'national-id-photo.jpg', mime: 'image/jpeg', size: buffer.length, buffer },
            portalBucket(sourceId),
          );
          portraitFileId = up.fileId;
        }
      } catch (error) {
        logger.warn({ err: error }, 'public apply: keeping the card portrait failed');
      }
    }
    // The address printed on the card — kept as the applicant's official address, so HR sees where
    // they live without retyping it. A low-confidence read is dropped rather than kept wrong.
    const usable = (f: { value: string; confidence: string } | null | undefined): string | null =>
      f === null || f === undefined || f.confidence === 'low' || f.value.trim() === '' ? null : f.value.trim();
    return {
      nationalId: read as string,
      portraitFileId,
      address: usable(result.address),
      city: usable(result.city),
    };
  }

  /**
   * «How did you hear about us»: the source the applicant is recorded under. A source from the list,
   * or «other» with the candidate's own words — which keeps the link's source and records the words
   * as the source detail, so HR still reads how they came.
   */
  private async heardFrom(
    linkSourceId: string,
    input: SubmitRecruitmentForm['heardFrom'],
  ): Promise<{ sourceId: string; note: string | null }> {
    const refuse = (message: string): never => {
      throw new ValidationError([{ field: PUBLIC_HEARD_FROM_FIELD, code: 'required', message }], message);
    };
    if (input === undefined) return refuse('Tell us how you heard about us');
    if (input.sourceId === null) {
      const other = (input.other ?? '').trim();
      if (other === '') return refuse('Tell us how you heard about us');
      return { sourceId: linkSourceId, note: other };
    }
    const source = await applicantSourceRepository.findActiveById(input.sourceId);
    if (source === null) return refuse('Choose one of the listed options');
    return { sourceId: String(source._id), note: null };
  }

  /** The papers' photos must be ones uploaded through this source's live link, like the card. */
  private async checkDocuments(
    sourceId: string,
    documents: SubmitRecruitmentForm['documents'],
    male: boolean,
  ): Promise<Partial<Record<PublicApplyDocument, string>>> {
    const given = documents ?? {};
    if (male && given.militaryService === undefined) {
      const message = 'A photo of the military service certificate is required';
      throw new ValidationError([{ field: PUBLIC_MILITARY_FIELD, code: 'required', message }], message);
    }
    const out: Partial<Record<PublicApplyDocument, string>> = {};
    for (const key of PUBLIC_APPLY_DOCUMENTS) {
      const id = given[key];
      if (id === undefined) continue;
      if (!(await inBucket(id, sourceId))) {
        const message = 'Upload this photo again';
        throw new ValidationError([{ field: key, code: 'required', message }], message);
      }
      out[key] = id;
    }
    return out;
  }

  /**
   * File the papers in the new applicant's document folder, pending HR's review — the same slots
   * the portal fills later, so HR reviews them where they review everything else. Never fails the
   * application: it has already been accepted, and a paper that did not file can be re-sent.
   */
  private async fileDocuments(
    applicantId: string,
    documents: Partial<Record<PublicApplyDocument, string>>,
  ): Promise<void> {
    const keys = Object.keys(documents) as PublicApplyDocument[];
    if (keys.length === 0) return;
    const types = await applicantDocumentTypeService.all();
    const ctx = publicApplyFilingContext(applicantId);
    for (const key of keys) {
      const type = types.find((t) => t.key === key && t.active);
      const fileId = documents[key];
      if (type === undefined || fileId === undefined) {
        logger.warn({ key }, 'public apply: no active document type for this paper — not filed');
        continue;
      }
      try {
        const { doc: file, buffer } = await fileService.readEntityOwnedBuffer(publicContext(), fileId);
        await applicantDocumentService.submit(ctx, applicantId, { typeId: String(type._id) }, {
          originalName: `${key}${file.extension}`,
          mime: file.mime,
          size: buffer.length,
          buffer,
        });
      } catch (error) {
        logger.warn({ err: error, key, applicantId }, 'public apply: filing a paper failed');
      }
    }
  }

  async submit(
    token: string,
    answers: Answers,
    card?: { frontFileId: string; backFileId: string },
    extras: Pick<SubmitRecruitmentForm, 'heardFrom' | 'documents' | 'cvFileId'> = {},
  ): Promise<RecruitmentFormSubmissionDto> {
    const { doc, sourceId: linkSourceId } = await this.resolve(token);
    const source = await this.heardFrom(linkSourceId, extras.heardFrom);

    const missing = missingRequired(doc.fields, answers);
    if (missing.length > 0) {
      throw new ValidationError(
        missing.map((field) => ({ field, code: 'required', message: 'This answer is required' })),
        'Required answers are missing',
      );
    }

    const badCustom = invalidCustom(doc.fields, answers);
    if (badCustom.length > 0) {
      throw new ValidationError(
        badCustom.map((b) => ({ field: b.field, code: 'invalid', message: b.message })),
        'Some answers are not valid',
      );
    }

    // One schema, one set of rules — the public path earns no exemptions.
    const parsed = RegisterApplicantSchema.safeParse({
      sourceId: source.sourceId,
      ...(source.note === null ? {} : { sourceDetail: { note: source.note } }),
      intakeChannel: 'web',
      ...toRegistrationBody(doc.fields, answers),
      // The questions as they stood at this moment. Editing the form later cannot rewrite what
      // this person was actually asked.
      formSnapshot: {
        title: doc.title,
        formVersion: doc.__v,
        fields: doc.fields,
        submittedAt: new Date(),
      },
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

    // The card is checked last, after every typed answer is valid: it is the slow step, and a
    // candidate fixing a typo should not wait for the reader each time.
    const typedId = parsed.data.identity.nationalId;
    const male = typedId !== undefined && parseNationalId(asciiDigits(typedId))?.gender === 'male';
    const documents = await this.checkDocuments(linkSourceId, extras.documents, male);
    if (extras.cvFileId !== undefined && !(await inBucket(extras.cvFileId, linkSourceId))) {
      const message = 'Upload your CV again';
      throw new ValidationError([{ field: 'cv', code: 'required', message }], message);
    }
    const { nationalId, portraitFileId, address, city } = await this.verifyCard(linkSourceId, typedId, card);
    const typedAddress = parsed.data.officialAddress;
    const cardAddress =
      address === null || (typedAddress !== undefined && typedAddress.line1 !== '')
        ? {}
        : {
            officialAddress: {
              ...(typedAddress ?? { governorate: '' }),
              line1: address.slice(0, 500),
              city: typedAddress?.city !== undefined && typedAddress.city !== '' ? typedAddress.city : (city ?? '').slice(0, 200),
            },
          };
    const verifiedBody = {
      ...parsed.data,
      ...cardAddress,
      identity: { ...parsed.data.identity, nationalId },
      // Filed on the application like HR's scan: under the person's name, front then back.
      nationalIdCardFileIds: [card!.frontFileId, card!.backFileId, ...(portraitFileId === null ? [] : [portraitFileId])],
      nationalIdCardSides: ['front', 'back', ...(portraitFileId === null ? [] : ['portrait'])] as (
        | 'front'
        | 'back'
        | 'portrait'
      )[],
    };

    // The registrar of a public application is the system, not a user: nobody was logged in.
    const applicant = await applicantService.register(publicContext(), verifiedBody, {
      identityVerified: true,
    });
    await recruitmentFormRepository.countSubmission(String(doc._id), token);
    await this.fileDocuments(String(applicant._id), documents);
    if (extras.cvFileId !== undefined) await this.fileCv(String(applicant._id), applicant.fullNameAr, extras.cvFileId);
    return { code: applicant.code };
  }
}

/** The scratch bucket a link's card photos land in — one per source, never HR's own. */
const portalBucket = (sourceId: string): string => `portal:${sourceId}`;

/** True when the photo was uploaded through a live link of this source. */
const inBucket = async (fileId: string, sourceId: string): Promise<boolean> => {
  const file = await fileService.getById(fileId, undefined, publicContext()).catch(() => null);
  return (
    file !== null &&
    file.entityRef.entityType === APPLICANT_CARD_SCAN_ENTITY_TYPE &&
    file.entityRef.entityId === portalBucket(sourceId)
  );
};

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
    // Null, not the string 'system': `userId` is written straight into `createdBy`/`updatedBy`,
    // which are ObjectId-or-null. A placeholder string throws on conversion, so this is the same
    // defect as the one above — it turned every public submission into a 500.
    userId: null,
    permissions: { 'applicant.create': 'organization' },
    branchId: null,
    departmentId: null,
    sectionId: null,
    isPrivileged: false,
  }) as unknown as AuthContext;

export const recruitmentFormService = new RecruitmentFormService();
