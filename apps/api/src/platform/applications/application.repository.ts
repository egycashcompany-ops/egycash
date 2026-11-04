import { type FilterQuery } from 'mongoose';
import { BaseRepository } from '../../shared/base/base.repository';
import { ApplicationModel, type ApplicationDoc } from './application.model';

class ApplicationRepository extends BaseRepository<ApplicationDoc> {
  constructor() {
    super(ApplicationModel, {}); // platform-level catalog: scope = organization
  }

  /**
   * Every live application whose `permissionKey` is one of `permissionKeys` — the catalog half of
   * deriving navigation from what the caller may actually do — plus the rows at `hubRoutes`: the
   * navigation hubs the caller opens through one of their tabs' keys, whatever key the row itself
   * carries. The resolver still decides entitlement; this only keeps the candidates small.
   *
   * A row with a NULL key never matches, and that is the point rather than a side effect: null means
   * "no permission was declared for this screen", and a screen nobody declared authority over must
   * not become a screen EVERYBODY sees. The `$in` cannot match null, and the hub branch asks for a
   * string key outright, so the fail-closed reading is enforced by the query itself and not only by
   * the filter downstream.
   *
   * An empty request short-circuits: Mongo would answer `{ $in: [] }` with nothing anyway, but
   * saying so here keeps a permissionless account off the database entirely.
   */
  async findByPermissionKeys(
    permissionKeys: readonly string[],
    hubRoutes: readonly string[] = [],
  ): Promise<ApplicationDoc[]> {
    if (permissionKeys.length === 0 && hubRoutes.length === 0) return [];
    const either: FilterQuery<ApplicationDoc>[] = [
      { permissionKey: { $in: [...new Set(permissionKeys)] } },
    ];
    if (hubRoutes.length > 0) {
      either.push({ route: { $in: [...new Set(hubRoutes)] }, permissionKey: { $type: 'string' } });
    }
    return this.model
      .find({ $or: either, status: 'active', isDeleted: false })
      .lean<ApplicationDoc[]>()
      .exec();
  }
}

export const applicationRepository = new ApplicationRepository();
