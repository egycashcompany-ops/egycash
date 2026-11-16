// Where an offer places the person — the branch, department and job a row shows. «هنحط الاداره و
// الوظيفه و الفرع في الجزء اللي تحت» on «عروض العمل», and the department and job on «جاهزون للتعيين».
//
// One answer for both tables, the same one the server filters by: the terms ACCEPTED when there are
// some (they cannot change after acceptance), else the terms WRITTEN, else — for a record still
// «جاهز لعرض العمل», which has no terms yet — the placement it was queued with.
import { type JobOfferDto, type Locale } from '@ecms/contracts';
import { useAppSelector } from '../../../../../store';
import { localized } from '../../../../../shared/lib/format';
import {
  useBranchNames,
  useDepartmentNames,
  useJobTitleReferenceOptions,
} from '../../../../organization/shared/references';

export interface OfferPlacementIds {
  branchId: string | null;
  departmentId: string | null;
  jobTitleId: string | null;
}

/** Pure: the ids of the placement a row shows (see the header). */
export const offerPlacement = (
  offer: Pick<JobOfferDto, 'acceptedSnapshot' | 'terms' | 'placement'>,
): OfferPlacementIds => offer.acceptedSnapshot?.terms ?? offer.terms ?? offer.placement;

type Named = { id: string; name: { ar: string; en: string } };

/**
 * Pure: a unit's name — «…» while its catalog is loading, «—» where the row has none, and the
 * offer page's own `#` + the id's last six characters (TermsView) for an id no catalog carries.
 */
export const placementName = (
  list: readonly Named[] | undefined,
  id: string | null,
  locale: Locale,
): string => {
  if (id === null) return '—';
  if (list === undefined) return '…';
  const hit = list.find((unit) => unit.id === id);
  return hit === undefined ? `#${id.slice(-6)}` : localized(hit.name, locale);
};

/**
 * The names of a row's placement. Branches and departments are named from the lists that keep the
 * retired ones too, so an old offer still reads as the unit it was written for.
 */
export const useOfferPlacementNames = (): {
  branch: (offer: JobOfferDto) => string;
  department: (offer: JobOfferDto) => string;
  job: (offer: JobOfferDto) => string;
} => {
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const branches = useBranchNames();
  const departments = useDepartmentNames();
  const jobs = useJobTitleReferenceOptions();
  return {
    branch: (offer) => placementName(branches.data, offerPlacement(offer).branchId, locale),
    department: (offer) => placementName(departments.data, offerPlacement(offer).departmentId, locale),
    job: (offer) => placementName(jobs.data, offerPlacement(offer).jobTitleId, locale),
  };
};
