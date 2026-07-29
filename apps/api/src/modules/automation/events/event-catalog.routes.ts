// `GET /api/v1/automation/events` — the event catalogue (design §3.3).
//
// The catalogue itself is a PLATFORM surface that lives in `@ecms/contracts`; this is only the
// HTTP mounting of it. It is served from automation because automation is its first consumer, and
// it can be mounted anywhere else later without the document changing.
import { Router, type Request, type Response } from 'express';
import { eventCatalogDigest, eventCatalogDocument } from '@ecms/contracts';
import { asyncHandler } from '../../../infrastructure/http/async-handler';
import { ok } from '../../../infrastructure/http/respond';
import { authenticate } from '../../../platform/auth';
import { authorize } from '../../../platform/rbac';

// The catalogue is a build-time constant: same code, same bytes. Computing the digest once keeps
// the strong ETag honest and costs nothing.
const ETAG = `"${eventCatalogDigest()}"`;

const serveEventCatalog = async (req: Request, res: Response): Promise<void> => {
  res.setHeader('ETag', ETAG);
  // It cannot change without a deploy, so a client that already has it should not be re-sent it.
  res.setHeader('Cache-Control', 'private, max-age=60');
  if (req.headers['if-none-match'] === ETAG) {
    res.status(304).end();
    return;
  }
  ok(res, eventCatalogDocument());
};

export const buildAutomationEventsRouter = (): Router => {
  const router = Router();
  // Gated on `workflow.view`: the catalogue is what a trigger is chosen from, so anyone who can
  // see a workflow needs it, and nobody else has a reason to enumerate the platform's events.
  router.get('/', authenticate, authorize('workflow.view'), asyncHandler(serveEventCatalog));
  return router;
};
