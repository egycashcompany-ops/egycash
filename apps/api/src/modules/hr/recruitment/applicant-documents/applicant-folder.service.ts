// The Applicant documents page's folders: one per applicant, holding everything kept for them.
//
// Nothing is stored twice to make a folder. A folder is a VIEW over the files the system already
// keeps against the applicant — the National-ID card filed at registration (front, back and the
// holder's photo, told apart by their tags), the attachments HR added on the applicant's page, and
// the documents the candidate handed in through the portal — read through the Files service, whose
// own rules still decide who may open or download each one.
import {
  nationalIdCardTag,
  type ApplicantFolderDetailDto,
  type ApplicantFolderDto,
  type ApplicantFolderFileDto,
  type ApplicantFolderFileKind,
  type FileDto,
  type ListApplicantFoldersQuery,
} from '@ecms/contracts';
import { type FilterQuery } from 'mongoose';
import { fileService, type FileDoc } from '../../../../platform/files';
import { type ScopeSelector } from '../../../../shared/types';
import { NotFoundError } from '../../../../shared/errors';
import { normalizeArabic } from '../../shared/arabic';
import { ApplicantModel, type ApplicantDoc } from '../applicants/applicant.model';
import { resolveNationalIdCardCategoryId } from '../applicants/national-id-card.files';
import { APPLICANT_DOCUMENT_ENTITY_TYPE } from './applicant-document.files';

/**
 * Files carry no branch of their own; the folder is reached through the applicant, so the file
 * query is not narrowed again. (Opening a file's bytes is still checked by the Files service.)
 */
const FILES_UNSCOPED: ScopeSelector = {
  scope: 'organization',
  userId: '',
  branchId: null,
  departmentId: null,
  sectionId: null,
};

/** Order inside a folder: the card's sides and the face first, then everything else. */
const KIND_ORDER: Record<ApplicantFolderFileKind, number> = {
  cardFront: 0,
  cardBack: 1,
  portrait: 2,
  card: 3,
  attachment: 4,
  document: 5,
};

const escapeRegex = (v: string): string => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

class ApplicantFolderService {
  /** Every live file kept against one applicant, whichever feature filed it. */
  private async filesOf(applicantId: string): Promise<FileDoc[]> {
    const page = await fileService.list(
      { moduleId: 'hr', entityId: applicantId, page: 1, pageSize: 100, sortDir: 'desc' },
      FILES_UNSCOPED,
    );
    return page.items.filter(
      (f) =>
        f.entityRef.entityType === 'applicant' ||
        f.entityRef.entityType === APPLICANT_DOCUMENT_ENTITY_TYPE,
    );
  }

  private kindOf(file: FileDoc, cardCategoryId: string): ApplicantFolderFileKind {
    if (file.entityRef.entityType === APPLICANT_DOCUMENT_ENTITY_TYPE) return 'document';
    if (String(file.categoryId) !== cardCategoryId) return 'attachment';
    if (file.tags.includes(nationalIdCardTag('front'))) return 'cardFront';
    if (file.tags.includes(nationalIdCardTag('back'))) return 'cardBack';
    if (file.tags.includes(nationalIdCardTag('portrait'))) return 'portrait';
    return 'card';
  }

  private summary(
    applicant: ApplicantDoc,
    files: { kind: ApplicantFolderFileKind; file: FileDoc }[],
  ): ApplicantFolderDto {
    const portrait = files.find((f) => f.kind === 'portrait');
    return {
      applicantId: String(applicant._id),
      applicantCode: applicant.code,
      applicantName: applicant.fullNameAr,
      fileCount: files.length,
      hasCard: files.some((f) => f.kind === 'cardFront' || f.kind === 'cardBack' || f.kind === 'card'),
      portraitFileId: portrait === undefined ? null : String(portrait.file._id),
      registeredAt: applicant.createdAt.toISOString(),
    };
  }

  private async classified(
    applicantId: string,
  ): Promise<{ kind: ApplicantFolderFileKind; file: FileDoc }[]> {
    const cardCategoryId = await resolveNationalIdCardCategoryId();
    return (await this.filesOf(applicantId))
      .map((file) => ({ kind: this.kindOf(file, cardCategoryId), file }))
      .sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind]);
  }

  /** The folders, newest applicant first, narrowed by name, code or national ID. */
  async list(query: ListApplicantFoldersQuery): Promise<{ items: ApplicantFolderDto[]; total: number }> {
    const filter: FilterQuery<ApplicantDoc> = { isDeleted: false };
    const search = query.search?.trim() ?? '';
    if (search !== '') {
      const digits = search.replace(/\D/g, '');
      filter.$or = [
        { searchName: new RegExp(escapeRegex(normalizeArabic(search)), 'i') },
        { fullNameEn: new RegExp(escapeRegex(search), 'i') },
        { code: new RegExp(escapeRegex(search), 'i') },
        ...(digits.length === 14 ? [{ nationalId: digits }] : []),
      ];
    }
    const [applicants, total] = await Promise.all([
      ApplicantModel.find(filter)
        .sort({ createdAt: -1 })
        .skip((query.page - 1) * query.pageSize)
        .limit(query.pageSize)
        .lean<ApplicantDoc[]>()
        .exec(),
      ApplicantModel.countDocuments(filter).exec(),
    ]);
    const items = await Promise.all(
      applicants.map(async (a) => this.summary(a, await this.classified(String(a._id)))),
    );
    return { items, total };
  }

  /** One applicant's folder, with every file in it. */
  async get(applicantId: string): Promise<ApplicantFolderDetailDto> {
    const applicant = await ApplicantModel.findOne({ _id: applicantId, isDeleted: false })
      .lean<ApplicantDoc>()
      .exec();
    if (applicant === null) throw new NotFoundError();
    const files = await this.classified(applicantId);
    return {
      ...this.summary(applicant, files),
      files: files.map(
        ({ kind, file }): ApplicantFolderFileDto => ({ kind, file: fileService.toDto(file) as FileDto }),
      ),
    };
  }
}

export const applicantFolderService = new ApplicantFolderService();
