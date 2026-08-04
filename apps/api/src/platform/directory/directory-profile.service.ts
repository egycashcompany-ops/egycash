// Directory profiles: the identity card behind every user name in the system.
//
// Two entry points, and only two, because everything else is a variation on them:
//   • `get(userId)`    — one person, for the drawer.
//   • `resolve(ids)`   — MANY people, one query, for a page of events.
//
// `resolve` is the one that matters. A page of 100 events written by 8 people must cost ONE
// lookup, so nothing here may take an id and go to the database on its own — the org names are
// batched the same way, in one pass per collection rather than one per person.
import { Types } from 'mongoose';
import { type DirectoryProfileDto, type LocalizedString } from '@ecms/contracts';
import { UserModel } from '../users/user.model';
import { BranchModel } from '../organization/branches/branch.model';
import { DepartmentModel } from '../organization/departments/department.model';
import { JobTitleModel } from '../organization/job-titles/job-title.model';

/** Names keyed by id, fetched in one query per collection. Missing ids simply stay absent. */
const namesOf = async (
  model: { find: (f: unknown) => { lean: () => { exec: () => Promise<{ _id: unknown; name: LocalizedString }[]> } } },
  ids: Types.ObjectId[],
): Promise<Map<string, LocalizedString>> => {
  if (ids.length === 0) return new Map();
  const rows = await model.find({ _id: { $in: ids } }).lean().exec();
  return new Map(rows.map((r) => [String(r._id), r.name]));
};

const displayNameOf = (profile: {
  firstName: LocalizedString;
  lastName: LocalizedString;
}): LocalizedString => ({
  ar: `${profile.firstName.ar} ${profile.lastName.ar}`.trim(),
  en: `${profile.firstName.en} ${profile.lastName.en}`.trim(),
});

class DirectoryProfileService {
  /**
   * Everyone asked for, in one pass. Unknown or deleted ids are simply absent from the map — a
   * caller decides what a missing person means, because history and a live drawer answer that
   * question differently.
   */
  async resolve(userIds: readonly string[]): Promise<Map<string, DirectoryProfileDto>> {
    const unique = [...new Set(userIds.filter((id) => Types.ObjectId.isValid(id)))];
    if (unique.length === 0) return new Map();

    const users = await UserModel.find({
      _id: { $in: unique.map((id) => new Types.ObjectId(id)) },
      isDeleted: false,
    })
      .select('profile organization status email')
      .lean()
      .exec();

    // One query per collection for the whole page, not one per user.
    const ids = (pick: 'branchId' | 'departmentId' | 'jobTitleId'): Types.ObjectId[] => [
      ...new Set(
        users
          .map((u) => u.organization[pick])
          .filter((v): v is Types.ObjectId => v !== null && v !== undefined)
          .map(String),
      ),
    ].map((id) => new Types.ObjectId(id));

    const [branches, departments, jobTitles] = await Promise.all([
      namesOf(BranchModel as never, ids('branchId')),
      namesOf(DepartmentModel as never, ids('departmentId')),
      namesOf(JobTitleModel as never, ids('jobTitleId')),
    ]);

    const named = (map: Map<string, LocalizedString>, id: Types.ObjectId | null): LocalizedString | null =>
      id === null || id === undefined ? null : (map.get(String(id)) ?? null);

    return new Map(
      users.map((u) => [
        String(u._id),
        {
          userId: String(u._id),
          displayName: displayNameOf(u.profile),
          // The photo lives on the employee record when there is one; absent is the normal case.
          avatarFileId: null,
          jobTitle: named(jobTitles, u.organization.jobTitleId),
          department: named(departments, u.organization.departmentId),
          branch: named(branches, u.organization.branchId),
          active: u.status === 'active',
          workEmail: u.email,
        } satisfies DirectoryProfileDto,
      ]),
    );
  }

  /** One person, for the drawer. `null` when the account no longer exists. */
  async get(userId: string): Promise<DirectoryProfileDto | null> {
    return (await this.resolve([userId])).get(userId) ?? null;
  }
}

export const directoryProfileService = new DirectoryProfileService();
