// Thin HTTP mapping only (ADR-003).
import { type Request, type Response } from 'express';
import { type OperationsReportQuery } from '@ecms/contracts';
import { ok, validated } from '../../../platform/web';
import { operationsReportService } from './report.service';

export const getCaptainReport = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, OperationsReportQuery>(req);
  ok(res, await operationsReportService.captainReport(query));
};

/**
 * «تقرير البنوك» (Round 14, the legacy `/vault1_reports`) — over the reports' period, which here
 * means the days the vault RECEIVED the shipments (the owner's decision, report.service.ts).
 */
export const getBankReport = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, OperationsReportQuery>(req);
  ok(res, await operationsReportService.bankReport(query));
};

/**
 * «تقرير الخزينة» (Round 12) — what the vault holds NOW, per bank: live, no period (the query takes
 * no key at all).
 */
export const getVaultHeldReport = async (_req: Request, res: Response): Promise<void> => {
  ok(res, await operationsReportService.vaultHeldReport());
};
