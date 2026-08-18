// Thin HTTP mapping only (ADR-003).
import { type Request, type Response } from 'express';
import { type OperationsReportQuery } from '@ecms/contracts';
import { ok, validated } from '../../../platform/web';
import { operationsReportService } from './report.service';

export const getCaptainReport = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, OperationsReportQuery>(req);
  ok(res, await operationsReportService.captainReport(query));
};

export const getBankReport = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, OperationsReportQuery>(req);
  ok(res, await operationsReportService.bankReport(query));
};
