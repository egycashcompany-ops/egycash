// The filing branch's snapshot (design §2.1, `BranchSnap`; §3.5): the one builder of the copy a
// request prints of its branch, read from the organization's own row. The person's snapshot is
// the people feature's (`resolvePerson`) and an item's the catalog's (`itemSnapsOf`): each copy has
// one builder, owned by the row it copies.
import { branchRepository } from '../../../../platform/organization';
import { NotFoundError } from '../../../../shared/errors';
import { type AdministrationPurchaseRequestBranchSnap } from './purchase-request.model';

/**
 * The branch's code and name, read by id and unfiltered: a branch closed since still names
 * itself. A request is filed only on the branch its department copy lies in, which exists; an id
 * that names nothing is a 404 rather than a blank copy.
 */
export const branchSnap = async (
  branchId: string,
): Promise<AdministrationPurchaseRequestBranchSnap> => {
  const [branch] = await branchRepository.findByIdsSystem([branchId]);
  if (branch === undefined) throw new NotFoundError('branch not found');
  return { code: branch.code, name: { ar: branch.name.ar, en: branch.name.en } };
};
