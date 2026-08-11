import { BaseRepository } from '../../shared/base/base.repository';
import { ApplicationModel, type ApplicationDoc } from './application.model';

class ApplicationRepository extends BaseRepository<ApplicationDoc> {
  constructor() {
    super(ApplicationModel, {}); // platform-level catalog: scope = organization
  }

  /**
   * Every live application whose `permissionKey` is one of `permissionKeys` — the catalog half of
   * deriving navigation from what the caller may actually do.
   *
   * A row with a NULL key never matches, and that is the point rather than a side effect: null means
   * "no permission was declared for this screen", and a screen nobody declared authority over must
   * not become a screen EVERYBODY sees. The `$in` cannot match null, so the fail-closed reading is
   * enforced by the query itself and not only by the filter downstream.
   *
   * An empty key set short-circuits: Mongo would answer `{ $in: [] }` with nothing anyway, but
   * saying so here keeps a permissionless account off the database entirely.
   */
  async findByPermissionKeys(permissionKeys: readonly string[]): Promise<ApplicationDoc[]> {
    if (permissionKeys.length === 0) return [];
    return this.model
      .find({
        permissionKey: { $in: [...new Set(permissionKeys)] },
        status: 'active',
        isDeleted: false,
      })
      .lean<ApplicationDoc[]>()
      .exec();
  }
}

export const applicationRepository = new ApplicationRepository();
