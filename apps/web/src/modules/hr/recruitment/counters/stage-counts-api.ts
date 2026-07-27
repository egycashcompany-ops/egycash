// Aggregated recruitment stage counters (RW15): ONE request feeds every queue badge and the whole
// stage navigation. Uses the shared api-client.
import { type RecruitmentStageCountsDto } from '@ecms/contracts';
import { buildQuery, get } from '../../../../shared/lib/api-client';

export const getRecruitmentStageCounts = (
  branchId?: string,
): Promise<RecruitmentStageCountsDto> =>
  get<RecruitmentStageCountsDto>(
    `/hr/recruitment/stage-counts${buildQuery(branchId === undefined ? {} : { branchId })}`,
  );
