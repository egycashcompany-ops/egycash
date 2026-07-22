// Express app assembly (no listen) — global middleware, platform + module routes,
// central error handling.
import express, { Router, type Express } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import mongoSanitize from 'express-mongo-sanitize';
import { env } from './infrastructure/config/env';
import { logger } from './infrastructure/logging/logger';
import { newRequestId, runWithContext } from './infrastructure/http/request-context';
import { errorHandler, notFoundHandler } from './infrastructure/http/error-handler';
import { mongoReady } from './infrastructure/database/mongo';
import { buildAuthRouter } from './platform/auth';
import { buildUsersRouter } from './platform/users';
import {
  buildPermissionsRouter,
  buildRoleAssignmentsRouter,
  buildRolesRouter,
} from './platform/rbac';
import {
  buildBranchesRouter,
  buildDepartmentsRouter,
  buildJobPositionsRouter,
  buildJobTitlesRouter,
  buildOrganizationRouter,
  buildSectionsRouter,
} from './platform/organization';
import { buildApplicationsRouter } from './platform/applications';
import { buildApplicationCategoriesRouter } from './platform/application-categories';
import { buildDepartmentApplicationsRouter } from './platform/department-applications';
import { buildFeatureFlagsRouter, buildSettingsRouter } from './platform/settings';
import {
  buildActivityLogsRouter,
  buildAuditLogsRouter,
  buildTimelineRouter,
} from './platform/audit';
import { buildScheduledTasksRouter } from './platform/scheduler';
import { buildFileCategoriesRouter, buildFilesRouter } from './platform/files';
import {
  buildNotificationPreferencesRouter,
  buildNotificationsRouter,
  buildNotificationTemplatesRouter,
} from './platform/notifications';
import { getRegisteredModules } from './platform/kernel/module-registry';

export const buildApp = (): Express => {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', true);

  // Request context: one requestId traces api → queue → worker (ADR-012).
  app.use((req, res, next) => {
    const requestId = newRequestId();
    res.setHeader('X-Request-Id', requestId);
    runWithContext(
      {
        requestId,
        actor: {
          userId: null,
          ip: req.ip ?? null,
          userAgent: req.headers['user-agent'] ?? null,
        },
      },
      () => {
        const startedAt = Date.now();
        res.on('finish', () => {
          logger.info(
            {
              method: req.method,
              path: req.path,
              status: res.statusCode,
              durationMs: Date.now() - startedAt,
            },
            'http request',
          );
        });
        next();
      },
    );
  });

  app.use(helmet());
  app.use(cors({ origin: env.CORS_ORIGINS, credentials: true }));
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());
  app.use(mongoSanitize());

  // Health endpoints (Deployment Strategy §1).
  app.get('/health/live', (_req, res) => {
    res.json({ status: 'ok' });
  });
  app.get('/health/ready', (_req, res) => {
    const ready = mongoReady();
    res.status(ready ? 200 : 503).json({ status: ready ? 'ok' : 'not-ready' });
  });

  // Routers are built here — after every feature module finished evaluating —
  // so cross-feature middleware references are safe (no import-cycle reads).
  const api = Router();
  api.use('/auth', buildAuthRouter());
  api.use('/platform/users', buildUsersRouter());
  api.use('/platform/roles', buildRolesRouter());
  api.use('/platform/role-assignments', buildRoleAssignmentsRouter());
  api.use('/platform/permissions', buildPermissionsRouter());
  api.use('/platform/organization', buildOrganizationRouter());
  api.use('/platform/branches', buildBranchesRouter());
  api.use('/platform/departments', buildDepartmentsRouter());
  api.use('/platform/departments/:departmentId/applications', buildDepartmentApplicationsRouter());
  api.use('/platform/sections', buildSectionsRouter());
  api.use('/platform/job-titles', buildJobTitlesRouter());
  api.use('/platform/job-positions', buildJobPositionsRouter());
  api.use('/platform/application-categories', buildApplicationCategoriesRouter());
  api.use('/platform/applications', buildApplicationsRouter());
  api.use('/platform/settings', buildSettingsRouter());
  api.use('/platform/feature-flags', buildFeatureFlagsRouter());
  api.use('/platform/audit-logs', buildAuditLogsRouter());
  api.use('/platform/activity-logs', buildActivityLogsRouter());
  api.use('/platform/timeline', buildTimelineRouter());
  api.use('/platform/scheduled-tasks', buildScheduledTasksRouter());
  api.use('/platform/files', buildFilesRouter());
  api.use('/platform/file-categories', buildFileCategoriesRouter());
  api.use('/platform/notification-templates', buildNotificationTemplatesRouter());
  api.use('/platform/notifications', buildNotificationsRouter());
  api.use('/platform/notification-preferences', buildNotificationPreferencesRouter());

  // Layer 2 modules mount under /api/v1/<module-id> from their manifests.
  for (const manifest of getRegisteredModules()) {
    for (const route of manifest.routes) {
      api.use(route.prefix, route.router);
    }
  }

  app.use('/api/v1', api);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
};
