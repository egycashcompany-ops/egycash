// One query key for the counters, shared by the sidebar, the stage rail and every queue badge —
// so they always show the same number and one write updates all of them (I3). Recruitment
// mutations do not refetch this: they WRITE it from the `counters` half of the response envelope
// (I6), so the badges move in the same instant as the record they describe.
import { useQuery } from '@tanstack/react-query';
import { type StageCountDto } from '@ecms/contracts';
import { getRecruitmentStageCounts } from './stage-counts-api';

const MODULE = 'hr';
const FEATURE = 'recruitmentStageCounts';

/** Short, so a badge left behind by someone else's write is never stale for long. */
const STALE_TIME_MS = 30_000;

export const stageCountsKey = (branchId?: string): readonly unknown[] => [MODULE, FEATURE, branchId ?? null];

export const useRecruitmentStageCounts = (branchId?: string) =>
  useQuery({
    queryKey: stageCountsKey(branchId),
    queryFn: () => getRecruitmentStageCounts(branchId),
    staleTime: STALE_TIME_MS,
  });

/** The stages of one kind, in display order — what the per-kind nav providers render. */
export const stagesOfKind = (
  stages: StageCountDto[] | undefined,
  kind: StageCountDto['kind'],
): StageCountDto[] => (stages ?? []).filter((s) => s.kind === kind);

/** The single stage of a singleton kind (screening, jobOffers, employeesReady). */
export const stageOfKind = (
  stages: StageCountDto[] | undefined,
  kind: StageCountDto['kind'],
): StageCountDto | undefined => (stages ?? []).find((s) => s.kind === kind);
