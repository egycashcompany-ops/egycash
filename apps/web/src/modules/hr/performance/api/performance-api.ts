// Performance api/ surface (ADR-013 — P-HR-PRF, phase P2).
//
// Two resources: the round, and the rows opening it writes. There is no `createPerformanceReview`
// and there will not be one — a review is materialized by opening a cycle (D2), and a call that
// minted one by hand would put somebody in a round the cycle's scope does not name.
import {
  type AssignPerformanceEvaluator,
  type ClosePerformanceCycle,
  type CreatePerformanceCycle,
  type Paginated,
  type PerformanceCycleDto,
  type PerformanceCycleOpenResultDto,
  type PerformanceReviewDto,
  type OpenPerformanceCycle,
  type UpdatePerformanceCycle,
} from '@ecms/contracts';
import {
  buildQuery,
  get,
  getPage,
  patch,
  post,
  type QueryParams,
} from '../../../../shared/lib/api-client';

const CYCLES = '/hr/performance/cycles';
const REVIEWS = '/hr/performance/reviews';

// ── Cycles ──────────────────────────────────────────────────────────────────

export const listPerformanceCycles = (
  params: QueryParams,
): Promise<Paginated<PerformanceCycleDto>> =>
  getPage<PerformanceCycleDto>(`${CYCLES}${buildQuery(params)}`);

export const getPerformanceCycle = (id: string): Promise<PerformanceCycleDto> =>
  get<PerformanceCycleDto>(`${CYCLES}/${id}`);

export const createPerformanceCycle = (
  body: CreatePerformanceCycle,
): Promise<PerformanceCycleDto> => post<PerformanceCycleDto>(CYCLES, body);

export const updatePerformanceCycle = (
  id: string,
  body: UpdatePerformanceCycle,
): Promise<PerformanceCycleDto> => patch<PerformanceCycleDto>(`${CYCLES}/${id}`, body);

/** Opening returns the cycle AND the receipt — see the controller for why both. */
export const openPerformanceCycle = (
  id: string,
  body: OpenPerformanceCycle,
): Promise<{ cycle: PerformanceCycleDto; result: PerformanceCycleOpenResultDto }> =>
  post<{ cycle: PerformanceCycleDto; result: PerformanceCycleOpenResultDto }>(
    `${CYCLES}/${id}/open`,
    body,
  );

export const closePerformanceCycle = (
  id: string,
  body: ClosePerformanceCycle,
): Promise<PerformanceCycleDto> => post<PerformanceCycleDto>(`${CYCLES}/${id}/close`, body);

// ── Reviews ─────────────────────────────────────────────────────────────────

export const listPerformanceReviews = (
  params: QueryParams,
): Promise<Paginated<PerformanceReviewDto>> =>
  getPage<PerformanceReviewDto>(`${REVIEWS}${buildQuery(params)}`);

export const getPerformanceReview = (id: string): Promise<PerformanceReviewDto> =>
  get<PerformanceReviewDto>(`${REVIEWS}/${id}`);

export const assignPerformanceEvaluator = (
  id: string,
  body: AssignPerformanceEvaluator,
): Promise<PerformanceReviewDto> => patch<PerformanceReviewDto>(`${REVIEWS}/${id}/evaluator`, body);
