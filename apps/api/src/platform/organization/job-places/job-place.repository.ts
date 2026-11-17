// The job places' reads and writes, every one able to take a transaction's session (P-ORG-3 §5.4).
//
// Here and not in `job-title.service.ts`: that service is pinned never to write in bulk
// (`job-defaults-guards.spec.ts` forbids `updateMany` there, because a JOB's defaults must never be
// re-applied to people in bulk). Places are not people, and removing a job's places is a bulk soft
// delete by nature — so it lives with the places.
import { type ClientSession, Types } from 'mongoose';
import { JobPlaceModel, type JobPlaceDoc } from './job-place.model';

const oid = (id: string): Types.ObjectId => new Types.ObjectId(id);

export interface PlaceKey {
  departmentCatalogId: string;
  sectionCatalogId: string | null;
}

/** The identity of a place within one job: what the unique index keys on. */
export const placeKey = (place: PlaceKey): string =>
  `${place.departmentCatalogId.toLowerCase()}|${place.sectionCatalogId?.toLowerCase() ?? ''}`;

export const jobPlaceRepository = {
  async findLiveByJob(jobTitleId: string, session?: ClientSession): Promise<JobPlaceDoc[]> {
    return JobPlaceModel.find({ jobTitleId: oid(jobTitleId), isDeleted: false })
      .session(session ?? null)
      .lean<JobPlaceDoc[]>()
      .exec();
  },

  async insert(
    jobTitleId: string,
    places: readonly PlaceKey[],
    by: string | null,
    session?: ClientSession,
  ): Promise<void> {
    if (places.length === 0) return;
    const actor = by === null ? null : oid(by);
    await JobPlaceModel.create(
      places.map((place) => ({
        jobTitleId: oid(jobTitleId),
        departmentCatalogId: oid(place.departmentCatalogId),
        sectionCatalogId: place.sectionCatalogId === null ? null : oid(place.sectionCatalogId),
        createdBy: actor,
        updatedBy: actor,
      })),
      { session: session ?? null, ordered: true },
    );
  },

  async softDeleteByIds(ids: readonly string[], by: string | null, session?: ClientSession): Promise<void> {
    if (ids.length === 0) return;
    const actor = by === null ? null : oid(by);
    await JobPlaceModel.updateMany(
      { _id: { $in: ids.map(oid) }, isDeleted: false },
      { $set: { isDeleted: true, deletedAt: new Date(), deletedBy: actor, updatedBy: actor } },
      session === undefined ? {} : { session },
    ).exec();
  },

  async softDeleteByJob(jobTitleId: string, by: string | null, session?: ClientSession): Promise<void> {
    const actor = by === null ? null : oid(by);
    await JobPlaceModel.updateMany(
      { jobTitleId: oid(jobTitleId), isDeleted: false },
      { $set: { isDeleted: true, deletedAt: new Date(), deletedBy: actor, updatedBy: actor } },
      session === undefined ? {} : { session },
    ).exec();
  },

  /** Does any live place cite this department or section entry? The catalogs' delete guard. */
  async citesEntry(entryId: string): Promise<boolean> {
    const id = oid(entryId);
    const found = await JobPlaceModel.exists({
      isDeleted: false,
      $or: [{ departmentCatalogId: id }, { sectionCatalogId: id }],
    }).exec();
    return found !== null;
  },

  /** Does this department entry hold any place, live or deleted? The fill's "edited by hand" test. */
  async anyForDepartmentEntry(entryId: string, session?: ClientSession): Promise<boolean> {
    const found = await JobPlaceModel.exists({ departmentCatalogId: oid(entryId) })
      .session(session ?? null)
      .exec();
    return found !== null;
  },
};
