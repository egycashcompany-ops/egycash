// Where an offer places the person — the branch, department and job a row shows. «هنحط الاداره و
// الوظيفه و الفرع في الجزء اللي تحت» on «عروض العمل», and the department and job on «جاهزون للتعيين».
//
// One answer for both tables, the same one the server filters by (`placed()` in the job-offer
// repository): the terms ACCEPTED when there are some (they cannot change after acceptance), else the
// terms WRITTEN, else — for a record still «جاهز لعرض العمل», which has no terms yet — where the
// candidate is NOW: the branch and department mirrored from the applicant, which follow a
// reassignment, and the job of the placement it was queued with (the job filter reads that one).
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
  offer: Pick<JobOfferDto, 'acceptedSnapshot' | 'terms' | 'placement' | 'branchId' | 'departmentId'>,
): OfferPlacementIds =>
  offer.acceptedSnapshot?.terms ??
  offer.terms ?? {
    branchId: offer.branchId ?? offer.placement.branchId,
    departmentId: offer.departmentId ?? offer.placement.departmentId,
    jobTitleId: offer.placement.jobTitleId,
  };

type Named = { id: string; name: { ar: string; en: string } };

/**
 * Pure: a unit's name — «…» while its catalog is loading, «—» where the row has none. For an id no
 * catalog carries (a retired job title: the job list holds active titles only), the name captured
 * with the queued placement when there is one, else the offer page's own `#` + the id's last six
 * characters (TermsView).
 */
export const placementName = (
  list: readonly Named[] | undefined,
  id: string | null,
  locale: Locale,
  captured: string | null = null,
): string => {
  if (id === null) return '—';
  if (list === undefined) return '…';
  const hit = list.find((unit) => unit.id === id);
  if (hit !== undefined) return localized(hit.name, locale);
  return captured ?? `#${id.slice(-6)}`;
};

/** The name captured with the queued placement — only when the row shows that very unit. */
const capturedName = (
  offer: JobOfferDto,
  field: 'branchId' | 'departmentId' | 'jobTitleId',
  label: string | null,
): string | null => (offerPlacement(offer)[field] === offer.placement[field] ? label : null);

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
    branch: (offer) =>
      placementName(branches.data, offerPlacement(offer).branchId, locale, capturedName(offer, 'branchId', offer.placementLabel.branch)),
    department: (offer) =>
      placementName(departments.data, offerPlacement(offer).departmentId, locale, capturedName(offer, 'departmentId', offer.placementLabel.department)),
    job: (offer) =>
      placementName(jobs.data, offerPlacement(offer).jobTitleId, locale, capturedName(offer, 'jobTitleId', offer.placementLabel.position)),
  };
};
