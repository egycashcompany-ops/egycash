// The catalogue, and the five rows the company asks for today (D-APP-4).
//
// Seeded idempotently at boot the way every other catalogue in HR is, so a fresh database has the
// documents the design names without anybody typing them in — and so changing one next year is an
// UPDATE to a row rather than a code change. `ensure` never overwrites what an administrator has
// since edited: the seed states the row's existence, not its permanent contents.
import { Types } from 'mongoose';
import {
  type ApplicantDocumentTypeDto,
  type CreateApplicantDocumentType,
  type UpdateApplicantDocumentType,
} from '@ecms/contracts';
import { NotFoundError, StaleDocumentError } from '../../../../shared/errors';
import { auditService } from '../../../../platform/audit';
import {
  ApplicantDocumentTypeModel,
  type ApplicantDocumentTypeDoc,
} from './applicant-document-type.model';

/** The five the design names. Order is the order a candidate is asked for them. */
const SEEDED: CreateApplicantDocumentType[] = [
  {
    key: 'qualification',
    name: { ar: 'صورة شهادة المؤهل الدراسي', en: 'Qualification certificate' },
    applicability: 'all',
    required: true,
    licenseClassRequired: false,
    order: 1,
  },
  {
    key: 'birthCertificate',
    name: { ar: 'صورة شهادة الميلاد', en: 'Birth certificate' },
    applicability: 'all',
    required: true,
    licenseClassRequired: false,
    order: 2,
  },
  {
    key: 'militaryService',
    name: { ar: 'صورة شهادة تأدية الخدمة العسكرية', en: 'Military service certificate' },
    applicability: 'all',
    required: true,
    licenseClassRequired: false,
    order: 3,
  },
  {
    key: 'nationalIdCard',
    name: { ar: 'صورة البطاقة الشخصية (سارية)', en: 'National ID card (valid)' },
    applicability: 'all',
    required: true,
    licenseClassRequired: false,
    order: 4,
  },
  {
    key: 'professionalDrivingLicense',
    name: { ar: 'صورة رخصة قيادة مهنية (أولى/ثانية)', en: 'Professional driving licence (1st/2nd)' },
    applicability: 'driversOnly',
    required: true,
    licenseClassRequired: true,
    order: 5,
  },
];

export const toApplicantDocumentTypeDto = (
  doc: ApplicantDocumentTypeDoc,
): ApplicantDocumentTypeDto => ({
  id: String(doc._id),
  key: doc.key,
  name: doc.name,
  applicability: doc.applicability,
  required: doc.required,
  licenseClassRequired: doc.licenseClassRequired,
  order: doc.order,
  active: doc.active,
  version: doc.__v ?? 0,
});

class ApplicantDocumentTypeService {
  /** Boot-time seed of the five. Idempotent, and it never overwrites an edited row. */
  async ensureSeeded(): Promise<void> {
    for (const row of SEEDED) {
      // `key` and `isDeleted` are pinned by the filter and deliberately absent below: an upsert
      // seeds the new document from the filter's equality conditions, and a field named in both
      // places is a path conflict Mongo refuses — which would fail the whole boot sequence.
      const { key, ...rest } = row;
      await ApplicantDocumentTypeModel.updateOne(
        { key, isDeleted: false },
        { $setOnInsert: { ...rest, active: true } },
        { upsert: true, setDefaultsOnInsert: true },
      ).exec();
    }
  }

  /** Every row, ordered — the shape the rules module consumes. */
  async all(): Promise<ApplicantDocumentTypeDoc[]> {
    return ApplicantDocumentTypeModel.find({ isDeleted: false })
      .sort({ order: 1, key: 1 })
      .lean<ApplicantDocumentTypeDoc[]>()
      .exec();
  }

  async findById(id: string): Promise<ApplicantDocumentTypeDoc | null> {
    if (!Types.ObjectId.isValid(id)) return null;
    return ApplicantDocumentTypeModel.findOne({ _id: id, isDeleted: false })
      .lean<ApplicantDocumentTypeDoc>()
      .exec();
  }

  async list(query: { page: number; pageSize: number; active?: boolean }): Promise<{
    items: ApplicantDocumentTypeDoc[];
    total: number;
  }> {
    const filter: Record<string, unknown> = { isDeleted: false };
    if (query.active !== undefined) filter.active = query.active;
    const [items, total] = await Promise.all([
      ApplicantDocumentTypeModel.find(filter)
        .sort({ order: 1, key: 1 })
        .skip((query.page - 1) * query.pageSize)
        .limit(query.pageSize)
        .lean<ApplicantDocumentTypeDoc[]>()
        .exec(),
      ApplicantDocumentTypeModel.countDocuments(filter).exec(),
    ]);
    return { items, total };
  }

  async update(id: string, input: UpdateApplicantDocumentType): Promise<ApplicantDocumentTypeDoc> {
    const { version, ...rest } = input;
    const updated = await ApplicantDocumentTypeModel.findOneAndUpdate(
      { _id: id, isDeleted: false, __v: version },
      { $set: rest, $inc: { __v: 1 } },
      { new: true },
    )
      .lean<ApplicantDocumentTypeDoc>()
      .exec();
    if (updated === null) {
      const exists = await this.findById(id);
      if (exists === null) throw new NotFoundError();
      throw new StaleDocumentError();
    }
    await auditService.record({
      entityRef: { moduleId: 'hr', entityType: 'applicantDocumentType', entityId: id },
      action: 'update',
      changes: Object.entries(rest).map(([field, value]) => ({
        field,
        old: null,
        new: value === null ? null : String(JSON.stringify(value)),
      })),
    });
    return updated;
  }
}

export const applicantDocumentTypeService = new ApplicantDocumentTypeService();
