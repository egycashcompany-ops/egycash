import { Types } from 'mongoose';
import { COMPLIANCE_REPORT_EVENTS, type ComplianceAccessAction } from '@ecms/contracts';
import { BaseRepository } from '../../../shared/base/base.repository';
import { collectionReady } from '../shared/collection-ready';
import { ComplianceAccessModel, type ComplianceAccessDoc } from './access.model';

/** One person's dealings with one file, as the seen report counts them. */
export interface PersonAccess {
  userId: string;
  viewCount: number;
  downloadCount: number;
  firstAt: Date;
  lastAt: Date;
  /** Newest first, at most `COMPLIANCE_REPORT_EVENTS`. */
  events: { action: ComplianceAccessAction; at: Date }[];
}

const ids = (values: readonly string[]): Types.ObjectId[] =>
  values.map((value) => new Types.ObjectId(value));

class ComplianceAccessRepository extends BaseRepository<ComplianceAccessDoc> {
  readonly ensureCollection = collectionReady(ComplianceAccessModel);

  constructor() {
    super(ComplianceAccessModel, {});
  }

  /** Write one opening or download, as it happened now. */
  async record(input: {
    documentId: string;
    folderId: string;
    userId: string;
    action: ComplianceAccessAction;
  }): Promise<void> {
    await this.ensureCollection();
    await this.create(
      {
        documentId: new Types.ObjectId(input.documentId),
        folderId: new Types.ObjectId(input.folderId),
        userId: new Types.ObjectId(input.userId),
        action: input.action,
        at: new Date(),
      },
      { by: input.userId },
    );
  }

  /**
   * For each of `documentIds`, how many of `userIds` have opened or downloaded it at least once —
   * one read for a whole folder's files. A file nobody has seen is absent.
   */
  async seenCounts(
    documentIds: readonly string[],
    userIds: readonly string[],
  ): Promise<Map<string, number>> {
    if (documentIds.length === 0 || userIds.length === 0) return new Map();
    const rows = await this.model
      .aggregate<{ _id: Types.ObjectId; n: number }>([
        {
          $match: {
            documentId: { $in: ids(documentIds) },
            userId: { $in: ids(userIds) },
            isDeleted: false,
          },
        },
        { $group: { _id: { documentId: '$documentId', userId: '$userId' } } },
        { $group: { _id: '$_id.documentId', n: { $sum: 1 } } },
      ])
      .exec();
    return new Map(rows.map((row) => [String(row._id), row.n]));
  }

  /** Everyone who has opened or downloaded one file, with their counts and their latest rows. */
  async byPerson(documentId: string): Promise<PersonAccess[]> {
    const rows = await this.model
      .aggregate<{
        _id: Types.ObjectId;
        viewCount: number;
        downloadCount: number;
        firstAt: Date;
        lastAt: Date;
        events: { action: ComplianceAccessAction; at: Date }[];
      }>([
        { $match: { documentId: new Types.ObjectId(documentId), isDeleted: false } },
        { $sort: { at: -1, _id: -1 } },
        {
          $group: {
            _id: '$userId',
            viewCount: { $sum: { $cond: [{ $eq: ['$action', 'view'] }, 1, 0] } },
            downloadCount: { $sum: { $cond: [{ $eq: ['$action', 'download'] }, 1, 0] } },
            firstAt: { $min: '$at' },
            lastAt: { $max: '$at' },
            events: { $push: { action: '$action', at: '$at' } },
          },
        },
        {
          $project: {
            viewCount: 1,
            downloadCount: 1,
            firstAt: 1,
            lastAt: 1,
            events: { $slice: ['$events', COMPLIANCE_REPORT_EVENTS] },
          },
        },
      ])
      .exec();
    return rows.map((row) => ({
      userId: String(row._id),
      viewCount: row.viewCount,
      downloadCount: row.downloadCount,
      firstAt: row.firstAt,
      lastAt: row.lastAt,
      events: row.events,
    }));
  }
}

export const complianceAccessRepository = new ComplianceAccessRepository();
