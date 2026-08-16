// Thin HTTP mapping only (ADR-003).
import { type Request, type Response } from 'express';
import { type PayrollRunCostReportRequest } from '@ecms/contracts';
import { ok, validated } from '../../../../platform/web';
import { authContext } from '../../../../platform/auth';
import { scopeSelector } from '../../../../shared/types';
import { costReportService } from './cost-report.service';

type IdParam = { id: string };

/**
 * The report, computed and returned. Nothing is written and nothing is kept.
 *
 * It reads the caller's scope through `employee.viewCompensation` — the same key the breakdown
 * beside it uses, and for the same reason: every figure here is somebody's pay in aggregate, and a
 * separate key would let a person be refused the sum while allowed every term in it (D-REPORT-4).
 */
export const postRunCostReport = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body, params } = validated<PayrollRunCostReportRequest, never, IdParam>(req);
  ok(
    res,
    await costReportService.forRun(
      params.id,
      body.groupBy,
      body.columns,
      scopeSelector(ctx, 'employee.viewCompensation'),
    ),
  );
};
