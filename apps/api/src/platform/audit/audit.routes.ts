// Router: authenticate → authorize → validate → controller (ADR-003).
import { Router } from 'express';
import { asyncHandler } from '../../infrastructure/http/async-handler';
import { validate } from '../../infrastructure/http/validate';
import { authenticate } from '../auth';
import { authorize } from '../rbac';
import { ListAuditLogsQuerySchema, ListActivityLogsQuerySchema } from './audit.validation';
import { listAuditLogs, listActivityLogs } from './audit.controller';

// Routers are BUILT at app-assembly time (buildApp), after every feature module has
// finished evaluating — feature modules reference each other's middleware, and building
// routers at import time would read those bindings mid-cycle.
export const buildAuditLogsRouter = (): Router => {
  const router = Router();
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
