import { Types, type FilterQuery } from 'mongoose';
import { BaseRepository } from '../../../shared/base/base.repository';
import { collectionReady } from '../shared/collection-ready';
import { ComplianceFolderModel, type ComplianceFolderDoc } from './folder.model';

/** Escaped for a case-insensitive `$regex`: a search is text, never a pattern. */
const escapeRegex = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

class ComplianceFolderRepository extends BaseRepository<ComplianceFolderDoc> {
  /** Awaited before every write: `ux_name_key` is the only guard two racing creates meet. */
  readonly ensureCollection = collectionReady(ComplianceFolderModel);

  constructor() {
    // One shelf for the company: folders carry no branch, and who sees one is its list (§4).
    super(ComplianceFolderModel, {});
  }

  /** The live folder named `nameKey`, other than `exceptId` — a rename never clashes with itself. */
  async findLiveByNameKey(nameKey: string, exceptId?: string): Promise<ComplianceFolderDoc | null> {
    return this.findOne({
      nameKey,
      ...(exceptId === undefined ? {} : { _id: { $ne: new Types.ObjectId(exceptId) } }),
    });
  }

  /** The filter of a shelf page: every folder, or only those shown to `viewerId`; then the search. */
  shelfFilter(
    viewerId: string | null,
    search: string | undefined,
  ): FilterQuery<ComplianceFolderDoc> {
    return {
      ...(viewerId === null ? {} : { viewerUserIds: new Types.ObjectId(viewerId) }),
      ...(search === undefined || search === ''
        ? {}
        : { name: { $regex: escapeRegex(search), $options: 'i' } }),
    };
  }

  /** Is this person on any live folder's list? What decides whether they keep the reader role. */
  async isViewerAnywhere(userId: string): Promise<boolean> {
    return this.exists({ viewerUserIds: new Types.ObjectId(userId) });
  }

  /** Everyone on any live folder's list — the boot reconciliation's half of the reader set. */
  async allViewerIds(): Promise<string[]> {
    const ids = await this.model
      .distinct('viewerUserIds', { isDeleted: false } as FilterQuery<ComplianceFolderDoc>)
      .exec();
    return ids.map(String);
  }
}

export const complianceFolderRepository = new ComplianceFolderRepository();
