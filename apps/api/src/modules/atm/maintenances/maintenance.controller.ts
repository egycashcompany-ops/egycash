// Thin HTTP mapping only (ADR-003).
import { type Request, type Response } from 'express';
import { z } from 'zod';
import {
  listQuery,
  type AtmOperationIds,
  type BulkUpdateAtmMaintenances,
  type CloseAtmMaintenances,
  type ListAtmDoneOperationsQuery,
  type ListAtmOpenOperationsQuery,
  type OpenAtmMaintenances,
  type UpdateAtmMaintenance,
} from '@ecms/contracts';
import { ok, okPage, validated } from '../../../platform/web';
import { authContext } from '../../../platform/auth';
import { toAtmMaintenanceDto } from '../atm.mappers';
import { atmMaintenanceService } from './maintenance.service';

type IdParam = { id: string };

export const MaintFacetsQuerySchema = z.object({ banks: listQuery(z.string().min(1)) }).strict();
type MaintFacetsQuery = z.infer<typeof MaintFacetsQuerySchema>;

export const MaintReopenBodySchema = z.object({ version: z.number().int().min(0) }).strict();
type MaintReopenBody = z.infer<typeof MaintReopenBodySchema>;

export const listOpenMaintenances = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, ListAtmOpenOperationsQuery>(req);
  okPage(res, await atmMaintenanceService.listOpen(query, authContext(req)), toAtmMaintenanceDto);
};

export const maintenanceFacets = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, MaintFacetsQuery>(req);
  ok(res, await atmMaintenanceService.facets(authContext(req), query.banks ?? []));
};

export const listDoneMaintenances = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, ListAtmDoneOperationsQuery>(req);
  okPage(res, await atmMaintenanceService.listDone(query, authContext(req)), toAtmMaintenanceDto);
};

export const maintenanceLeaderOptions = async (_req: Request, res: Response): Promise<void> => {
  ok(res, await atmMaintenanceService.leaderOptions());
};

export const openMaintenances = async (req: Request, res: Response): Promise<void> => {
  const { body } = validated<OpenAtmMaintenances>(req);
  const result = await atmMaintenanceService.open(body, authContext(req));
  ok(res, { opened: result.opened.map(toAtmMaintenanceDto), unknownCodes: result.unknownCodes });
};

export const closeMaintenances = async (req: Request, res: Response): Promise<void> => {
  const { body } = validated<CloseAtmMaintenances>(req);
  const rows = await atmMaintenanceService.close(body, authContext(req));
  ok(res, rows.map(toAtmMaintenanceDto));
};

export const reopenMaintenance = async (req: Request, res: Response): Promise<void> => {
  const { body, params } = validated<MaintReopenBody, never, IdParam>(req);
  ok(
    res,
    toAtmMaintenanceDto(
      await atmMaintenanceService.reopen(params.id, body.version, authContext(req)),
    ),
  );
};

export const updateMaintenance = async (req: Request, res: Response): Promise<void> => {
  const { body, params } = validated<UpdateAtmMaintenance, never, IdParam>(req);
  ok(
    res,
    toAtmMaintenanceDto(await atmMaintenanceService.update(params.id, body, authContext(req))),
  );
};

export const bulkUpdateMaintenances = async (req: Request, res: Response): Promise<void> => {
  const { body } = validated<BulkUpdateAtmMaintenances>(req);
  const rows = await atmMaintenanceService.bulkUpdate(body, authContext(req));
  ok(res, rows.map(toAtmMaintenanceDto));
};

export const deleteMaintenances = async (req: Request, res: Response): Promise<void> => {
  const { body } = validated<AtmOperationIds>(req);
  ok(res, { removed: await atmMaintenanceService.remove(body.ids, authContext(req)) });
};
