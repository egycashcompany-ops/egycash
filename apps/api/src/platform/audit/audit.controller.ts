// Thin HTTP mapping only (ADR-003).
import { type Request, type Response } from 'express';
import {
  type ExportAuditLogsQuery,
  type ListAuditLogsQuery,
  type ListActivityLogsQuery,
  type TimelineQuery,
} from '@ecms/contracts';
import { ok, okPage } from '../../infrastructure/http/respond';
import { validated } from '../../infrastructure/http/validate';
import { authContext } from '../auth';
import { auditService } from './audit.service';
import { streamAuditExport } from './audit.export';
import { getTimeline as getTimelineView } from './audit.timeline';

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

export const exportAuditLogs = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { query } = validated<never, ExportAuditLogsQuery>(req);
  await streamAuditExport(res, ctx, query);
};

export const getTimeline = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { query } = validated<never, TimelineQuery>(req);
  const result = await getTimelineView(ctx, query);
  ok(res, { items: result.items, included: result.included }, result.meta);
};
