// Thin HTTP mapping only (ADR-003). Every handler takes the caller's own company from the request
// — minted by `requireGoldPortal`, never parsed from anything the caller sent.
import { type Request, type Response } from 'express';
import {
  type GoldPortalBarsQuery,
  type GoldPortalClosingQuery,
  type GoldPortalListQuery,
  type GoldPortalMovementQuery,
} from '@ecms/contracts';
import { authContext } from '../../../platform/auth';
import { directoryProfileService } from '../../../platform/directory';
import { ok, validated } from '../../../platform/web';
import { goldPortalService } from './portal.service';
import { portalCompany } from './portal-scope';

const meta = (query: { page: number; pageSize: number }, totalItems: number) => ({
  page: query.page,
  pageSize: query.pageSize,
  totalItems,
  totalPages: Math.max(1, Math.ceil(totalItems / query.pageSize)),
});

export const goldPortalMe = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  // The person's own name for the account menu — the identity the snapshot already carries.
  const profile = await directoryProfileService.get(ctx.userId).catch(() => null);
  ok(res, await goldPortalService.me(portalCompany(req), profile?.displayName.ar ?? ''));
};

export const goldPortalOverview = async (req: Request, res: Response): Promise<void> => {
  ok(res, await goldPortalService.overview(portalCompany(req)));
};

export const goldPortalBars = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, GoldPortalBarsQuery>(req);
  const page = await goldPortalService.bars(portalCompany(req), query);
  ok(res, page.items, meta(query, page.totalItems));
};

export const goldPortalDrawers = async (req: Request, res: Response): Promise<void> => {
  ok(res, await goldPortalService.drawers(portalCompany(req)));
};

export const goldPortalReceiving = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, GoldPortalListQuery>(req);
  const page = await goldPortalService.receiving(portalCompany(req), query);
  ok(res, page.items, meta(query, page.totalItems));
};

export const goldPortalDelivery = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, GoldPortalListQuery>(req);
  const page = await goldPortalService.delivery(portalCompany(req), query);
  ok(res, page.items, meta(query, page.totalItems));
};

export const goldPortalTransfers = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, GoldPortalListQuery>(req);
  const page = await goldPortalService.transfers(portalCompany(req), query);
  ok(res, page.items, meta(query, page.totalItems));
};

export const goldPortalKeys = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, GoldPortalListQuery>(req);
  const page = await goldPortalService.keys(portalCompany(req), query);
  ok(res, page.items, meta(query, page.totalItems));
};

export const goldPortalRepresentatives = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, GoldPortalListQuery>(req);
  const page = await goldPortalService.representatives(portalCompany(req), query);
  ok(res, page.items, meta(query, page.totalItems));
};

export const goldPortalMovement = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, GoldPortalMovementQuery>(req);
  ok(res, await goldPortalService.movement(portalCompany(req), query));
};

export const goldPortalClosing = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, GoldPortalClosingQuery>(req);
  ok(res, await goldPortalService.closing(portalCompany(req), query));
};
