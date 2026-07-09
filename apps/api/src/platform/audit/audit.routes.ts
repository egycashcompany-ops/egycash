// Router: authenticate → authorize → validate → controller (ADR-003).
import { Router } from 'express';
import { asyncHandler } from '../../infrastructure/http/async-handler';
import { validate } from '../../infrastructure/http/validate';
import { authenticate } from '../auth';
import { authorize } from '../rbac';
import {
  ExportAuditLogsQuerySchema,
  ListAuditLogsQuerySchema,
  ListActivityLogsQuerySchema,
  TimelineQuerySchema,
} from './audit.validation';
import {
  listAuditLogs,
  listActivityLogs,
  exportAuditLogs,
  getTimeline,
} from './audit.controller';

// Routers are BUILT at app-assembly time (buildApp), after every feature module has
// finished evaluating — feature modules reference each other's middleware, and building
// routers at import time would read those bindings mid-cycle.
export const buildAuditLogsRouter = (): Router => {
  const router = Router();
  // Specific path before the root list route (no route-order hazard either way here,
  // but matches the project's convention of declaring the more specific path first).
  router.get(
    '/export',
    authenticate,
    authorize('auditLog.export'),
    validate({ query: ExportAuditLogsQuerySchema }),
    asyncHandler(exportAuditLogs),
  );
  router.get(
    '/',
    authenticate,
    authorize('auditLog.view'),
    validate({ query: ListAuditLogsQuerySchema }),
    asyncHandler(listAuditLogs),
  );
  return router;
};

export const buildActivityLogsRouter = (): Router => {
  const router = Router();
  router.get(
    '/',
    authenticate,
    authorize('activityLog.view'),
    validate({ query: ListActivityLogsQuerySchema }),
    asyncHandler(listActivityLogs),
  );
  return router;
};

// BD-007: no authorize() here — the content itself degrades to the caller's permissions
// (audit.timeline.ts), so the middleware only needs to authenticate.
export const buildTimelineRouter = (): Router => {
  const router = Router();
  router.get(
    '/',
    authenticate,
    validate({ query: TimelineQuerySchema }),
    asyncHandler(getTimeline),
  );
  return router;
};
