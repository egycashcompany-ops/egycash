// Thin HTTP mapping only (ADR-003).
import { type Request, type Response } from 'express';
import { type ListAuditLogsQuery, type ListActivityLogsQuery } from '@ecms/contracts';
import { okPage } from '../../infrastructure/http/respond';
import { validated } from '../../infrastructure/http/validate';
import { auditService } from './audit.service';

export const listAuditLogs = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, ListAuditLogsQuery>(req);
  const page = await auditService.listAuditLogs(query);
  okPage(res, page, (doc) => auditService.toAuditDto(doc));
};

export const listActivityLogs = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, ListActivityLogsQuery>(req);
  const page = await auditService.listActivityLogs(query);
  okPage(res, page, (doc) => auditService.toActivityDto(doc));
};
