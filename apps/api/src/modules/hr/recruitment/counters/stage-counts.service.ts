// The aggregated stage counters (RW15/I3). ONE endpoint feeds every recruitment queue badge and
// the whole stage navigation — never one request per stage.
//
// Two rules shape the response:
//   • `count` is ALWAYS the `waiting` bucket, so the number in the navigation is exactly the
//     number of rows on the page's first tab. The other buckets ride along for the tab badges.
//   • A stage the caller cannot view is OMITTED, not returned as zero, so the navigation never
//     advertises a queue the user cannot open.
//
// Cross-feature reads go through the stage barrels only (ADR-003); this feature owns no data.
import {
  type LocalizedString,
  type RecruitmentStageCountsDto,
  type RecruitmentStageCountsQuery,
  type StageCountDto,
} from '@ecms/contracts';
import {
  hasPermission,
  scopeOf,
  scopeSelector,
  widerScope,
  type AuthContext,
  type ScopeSelector,
} from '../../../../shared/types';
import { applicantService } from '../applicants';
import { screeningService } from '../screening';
import { interviewService, interviewStageService } from '../interviews';
import { evaluationService, evaluationPhaseService } from '../evaluations';
import { jobOfferService } from '../job-offers';

/** Catalogs are paged; recruitment stages and phases are a handful, never hundreds. */
const CATALOG_PAGE_SIZE = 100;

/** Every permission that can grant sight of an evaluation phase (RW7 + the generic superset). */
const EVALUATION_VIEW_PERMISSIONS = [
  'evaluation.view',
  'securityCheck.view',
  'drivingTest.view',
  'medicalCheck.view',
] as const;

const bucketCount = (buckets: Record<string, number>, key: string): number => buckets[key] ?? 0;

/**
 * RW7 back-compat rule: the generic `evaluation.*` grants are a SUPERSET — holding one satisfies
 * any phase's own resource check, so existing roles keep working without a migration.
 */
const canViewPhase = (ctx: AuthContext, resource: string): boolean =>
  hasPermission(ctx, 'evaluation.view') || hasPermission(ctx, `${resource}.view`);

const phasePermission = (ctx: AuthContext, resource: string): string =>
  hasPermission(ctx, `${resource}.view`) ? `${resource}.view` : 'evaluation.view';

class StageCountsService {
  /**
   * Every stage the caller may see, with its live queue count. The per-collection aggregations run
   * in parallel: six grouped queries in one request, each served by an existing index.
   */
  async list(ctx: AuthContext, query: RecruitmentStageCountsQuery): Promise<RecruitmentStageCountsDto> {
    const branchId = query.branchId;
    const [applicants, screening, interviews, evaluations, offers, employeesReady, stages, phases] =
      await Promise.all([
        hasPermission(ctx, 'applicant.view')
          ? applicantService.statusCounts(branchId, scopeSelector(ctx, 'applicant.view'))
          : Promise.resolve(null),
        hasPermission(ctx, 'screening.view')
          ? screeningService.statusCounts(branchId, scopeSelector(ctx, 'screening.view'))
          : Promise.resolve(null),
        hasPermission(ctx, 'interview.view')
          ? interviewService.statusCountsByStage(branchId, scopeSelector(ctx, 'interview.view'))
          : Promise.resolve(null),
        this.canViewAnyPhase(ctx)
          ? evaluationService.statusCountsByPhase(branchId, this.evaluationScope(ctx))
          : Promise.resolve(null),
        hasPermission(ctx, 'jobOffer.view')
          ? jobOfferService.statusCounts(branchId, scopeSelector(ctx, 'jobOffer.view'))
          : Promise.resolve(null),
        hasPermission(ctx, 'employee.create')
          ? jobOfferService.countEmployeesReady(branchId, scopeSelector(ctx, 'employee.create'))
          : Promise.resolve(null),
        hasPermission(ctx, 'interview.view')
          ? interviewStageService.list({ page: 1, pageSize: CATALOG_PAGE_SIZE, sortDir: 'asc', active: true })
          : Promise.resolve(null),
        this.canViewAnyPhase(ctx)
          ? evaluationPhaseService.list({ page: 1, pageSize: CATALOG_PAGE_SIZE, sortDir: 'asc', active: true })
          : Promise.resolve(null),
      ]);

    const out: StageCountDto[] = [];
    let order = 0;

    if (applicants !== null) {
      out.push({
        key: 'applicants',
        kind: 'applicants',
        refId: null,
        name: null,
        route: '/applicants',
        permission: 'applicant.view',
        // Live applicants — the ones still moving through the pipeline.
        count: bucketCount(applicants, 'new'),
        buckets: applicants,
        order: order++,
      });
    }

    if (screening !== null) {
      out.push({
        key: 'screening',
        kind: 'screening',
        refId: null,
        name: null,
        route: '/screening',
        permission: 'screening.view',
        count: bucketCount(screening, 'waiting'),
        buckets: screening,
        order: order++,
      });
    }

    if (interviews !== null && stages !== null) {
      for (const stage of stages.items) {
        const buckets = interviews[String(stage._id)] ?? {};
        out.push({
          key: `interview:${String(stage._id)}`,
          kind: 'interview',
          refId: String(stage._id),
          name: stage.name as LocalizedString,
          route: `/interviews/${String(stage._id)}`,
          permission: 'interview.view',
          count: bucketCount(buckets, 'waiting'),
          buckets,
          order: order++,
        });
      }
    }

    if (evaluations !== null && phases !== null) {
      for (const phase of phases.items) {
        if (!canViewPhase(ctx, phase.permissionResource)) continue;
        const buckets = evaluations[String(phase._id)] ?? {};
        out.push({
          key: `evaluation:${String(phase._id)}`,
          kind: 'evaluation',
          refId: String(phase._id),
          name: phase.name as LocalizedString,
          route: `/evaluations/${String(phase._id)}`,
          permission: phasePermission(ctx, phase.permissionResource),
          count: bucketCount(buckets, 'waiting'),
          buckets,
          order: order++,
        });
      }
    }

    if (offers !== null) {
      out.push({
        key: 'jobOffers',
        kind: 'jobOffer',
        refId: null,
        name: null,
        route: '/job-offers',
        permission: 'jobOffer.view',
        count: bucketCount(offers, 'waiting'),
        buckets: offers,
        order: order++,
      });
    }

    if (employeesReady !== null) {
      out.push({
        key: 'employeesReady',
        kind: 'employeesReady',
        refId: null,
        name: null,
        route: '/employees/ready',
        permission: 'employee.create',
        count: employeesReady,
        buckets: { waiting: employeesReady },
        order: order++,
      });
    }

    return { stages: out, generatedAt: new Date().toISOString() };
  }

  /**
   * Whether the caller can see ANY evaluation phase — the generic grant or one of the concrete
   * per-phase resources (RW7). Decides whether the evaluation aggregation is worth running.
   */
  private canViewAnyPhase(ctx: AuthContext): boolean {
    return EVALUATION_VIEW_PERMISSIONS.some((key) => hasPermission(ctx, key));
  }

  /**
   * The evaluation aggregation spans every phase at once, so it runs at the WIDEST scope the
   * caller holds across the phase permissions — narrowing per phase would need a query per phase,
   * which is exactly what this endpoint exists to avoid.
   */
  private evaluationScope(ctx: AuthContext): ScopeSelector {
    const widest = EVALUATION_VIEW_PERMISSIONS.reduce<ReturnType<typeof scopeOf>>(
      (acc, key) => {
        const granted = scopeOf(ctx, key);
        if (granted === undefined) return acc;
        return acc === undefined ? granted : widerScope(acc, granted);
      },
      undefined,
    );
    return { ...scopeSelector(ctx, 'evaluation.view'), scope: widest ?? 'own' };
  }
}

export const stageCountsService = new StageCountsService();
