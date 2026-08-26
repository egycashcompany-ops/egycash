// Reads and the four writes, and every write states the condition it needs in the SAME query.
//
// That is the whole reason this file is not two lines of `findById` + `save`. The set is written
// by two different parties — the candidate uploads, HR reviews — so a read-then-write would leave
// a window in which HR accepts a document and the candidate replaces it a moment later, each
// having read a state that was true when they read it. Naming the required state in the filter
// closes the window in the database rather than hoping about it in the service.
import { Types, type FilterQuery } from 'mongoose';
import {
  ApplicantDocumentSetModel,
  type ApplicantDocumentItem,
  type ApplicantDocumentSetDoc,
} from './applicant-document.model';

const live = (extra: FilterQuery<ApplicantDocumentSetDoc> = {}): FilterQuery<ApplicantDocumentSetDoc> => ({
  isDeleted: false,
  ...extra,
});

class ApplicantDocumentRepository {
  async findByApplicant(applicantId: string): Promise<ApplicantDocumentSetDoc | null> {
    if (!Types.ObjectId.isValid(applicantId)) return null;
    return ApplicantDocumentSetModel.findOne(live({ applicantId: new Types.ObjectId(applicantId) }))
      .lean<ApplicantDocumentSetDoc>()
      .exec();
  }

  /**
   * The set for this applicant, made if it is not there yet.
   *
   * `upsert` rather than find-then-create: the candidate's first upload and a second browser tab
   * are the same instant often enough, and the unique index would turn the loser into a 500. The
   * denormalized name and code are set only ON INSERT — a later correction to the applicant is not
   * this collection's business to chase.
   */
  async ensureFor(
    applicantId: string,
    applicantCode: string,
    applicantName: string,
  ): Promise<ApplicantDocumentSetDoc> {
    const oid = new Types.ObjectId(applicantId);
    return ApplicantDocumentSetModel.findOneAndUpdate(
      live({ applicantId: oid }),
      {
        $setOnInsert: {
          applicantId: oid,
          applicantCode,
          applicantName,
          documents: [],
          isDeleted: false,
        },
      },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    )
      .lean<ApplicantDocumentSetDoc>()
      .exec();
  }

  /** Add a document to a slot that is currently EMPTY — the guard against a double first upload. */
  async addDocument(
    applicantId: string,
    item: ApplicantDocumentItem,
  ): Promise<ApplicantDocumentSetDoc | null> {
    return ApplicantDocumentSetModel.findOneAndUpdate(
      live({
        applicantId: new Types.ObjectId(applicantId),
        'documents.typeId': { $ne: item.typeId },
      }),
      { $push: { documents: item } },
      { new: true },
    )
      .lean<ApplicantDocumentSetDoc>()
      .exec();
  }

  /**
   * Replace what is in a slot, but only while its status is one the candidate may still act on.
   *
   * The statuses are passed in rather than hard-coded so the RULE stays in the rules module and
   * this file stays a query. Returning null means the condition did not hold — the caller turns
   * that into the refusal, and it cannot be a stale read because nothing was read.
   */
  async replaceDocument(
    applicantId: string,
    typeId: string,
    replaceableStatuses: readonly string[],
    patch: Pick<
      ApplicantDocumentItem,
      'fileId' | 'fileName' | 'fileVersion' | 'licenseClass' | 'uploadedAt'
    >,
  ): Promise<ApplicantDocumentSetDoc | null> {
    return ApplicantDocumentSetModel.findOneAndUpdate(
      live({
        applicantId: new Types.ObjectId(applicantId),
        documents: {
          $elemMatch: { typeId: new Types.ObjectId(typeId), status: { $in: replaceableStatuses } },
        },
      }),
      {
        $set: {
          'documents.$[slot].fileId': patch.fileId,
          'documents.$[slot].fileName': patch.fileName,
          'documents.$[slot].fileVersion': patch.fileVersion,
          'documents.$[slot].licenseClass': patch.licenseClass,
          'documents.$[slot].uploadedAt': patch.uploadedAt,
          // A replacement is a fresh submission: whatever was decided about the file it replaces
          // was decided about THAT file. Carrying the old verdict forward would mean a refused
          // slot stayed refused after the candidate fixed it, and an accepted one could never
          // have been replaced anyway.
          'documents.$[slot].status': 'pending',
          'documents.$[slot].reviewedBy': null,
          'documents.$[slot].reviewedAt': null,
          'documents.$[slot].reviewNote': null,
        },
      },
      {
        new: true,
        arrayFilters: [{ 'slot.typeId': new Types.ObjectId(typeId) }],
      },
    )
      .lean<ApplicantDocumentSetDoc>()
      .exec();
  }

  /** Rule on a slot that is still waiting. Null means somebody got there first. */
  async reviewDocument(
    applicantId: string,
    typeId: string,
    verdict: { status: string; reviewedBy: string; reviewedAt: Date; reviewNote: string | null },
  ): Promise<ApplicantDocumentSetDoc | null> {
    return ApplicantDocumentSetModel.findOneAndUpdate(
      live({
        applicantId: new Types.ObjectId(applicantId),
        documents: { $elemMatch: { typeId: new Types.ObjectId(typeId), status: 'pending' } },
      }),
      {
        $set: {
          'documents.$[slot].status': verdict.status,
          'documents.$[slot].reviewedBy': new Types.ObjectId(verdict.reviewedBy),
          'documents.$[slot].reviewedAt': verdict.reviewedAt,
          'documents.$[slot].reviewNote': verdict.reviewNote,
        },
      },
      { new: true, arrayFilters: [{ 'slot.typeId': new Types.ObjectId(typeId) }] },
    )
      .lean<ApplicantDocumentSetDoc>()
      .exec();
  }

  /** The staff-side list. `pendingOnly` is the queue somebody actually works through. */
  async list(query: {
    page: number;
    pageSize: number;
    pendingOnly?: boolean;
    applicantId?: string;
    search?: string;
  }): Promise<{ items: ApplicantDocumentSetDoc[]; total: number }> {
    const filter = live();
    if (query.pendingOnly === true) filter['documents.status'] = 'pending';
    if (query.applicantId !== undefined && Types.ObjectId.isValid(query.applicantId)) {
      filter.applicantId = new Types.ObjectId(query.applicantId);
    }
    if (query.search !== undefined && query.search.trim() !== '') {
      const rx = new RegExp(query.search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ applicantCode: rx }, { applicantName: rx }];
    }
    const [items, total] = await Promise.all([
      ApplicantDocumentSetModel.find(filter)
        .sort({ updatedAt: -1 })
        .skip((query.page - 1) * query.pageSize)
        .limit(query.pageSize)
        .lean<ApplicantDocumentSetDoc[]>()
        .exec(),
      ApplicantDocumentSetModel.countDocuments(filter).exec(),
    ]);
    return { items, total };
  }
}

export const applicantDocumentRepository = new ApplicantDocumentRepository();
