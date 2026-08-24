// Thin HTTP mapping only (ADR-003).
import { type Request, type Response } from 'express';
import { z } from 'zod';
import {
  listQuery,
  type AtmOperationIds,
  type BulkUpdateAtmReplenishments,
  type ListAtmDoneOperationsQuery,
  type ListAtmOpenOperationsQuery,
  type OpenAtmReplenishments,
  type UpdateAtmReplenishment,
} from '@ecms/contracts';
import { ok, okPage, validated } from '../../../platform/web';
import { authContext } from '../../../platform/auth';
import { toAtmReplenishmentDto } from '../atm.mappers';
import { atmReplenishmentService } from './replenishment.service';

type IdParam = { id: string };

export const FacetsQuerySchema = z.object({ banks: listQuery(z.string().min(1)) }).strict();
type FacetsQuery = z.infer<typeof FacetsQuerySchema>;

export const ReopenBodySchema = z.object({ version: z.number().int().min(0) }).strict();
type ReopenBody = z.infer<typeof ReopenBodySchema>;

export const listOpenReplenishments = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, ListAtmOpenOperationsQuery>(req);
  okPage(
    res,
    await atmReplenishmentService.listOpen(query, authContext(req)),
    toAtmReplenishmentDto,
  );
};

export const replenishmentFacets = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, FacetsQuery>(req);
  ok(res, await atmReplenishmentService.facets(authContext(req), query.banks ?? []));
};

export const listDoneReplenishments = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, ListAtmDoneOperationsQuery>(req);
  okPage(
    res,
    await atmReplenishmentService.listDone(query, authContext(req)),
    toAtmReplenishmentDto,
  );
};

export const openReplenishments = async (req: Request, res: Response): Promise<void> => {
  const { body } = validated<OpenAtmReplenishments>(req);
  const result = await atmReplenishmentService.open(body, authContext(req));
  ok(res, {
    opened: result.opened.map(toAtmReplenishmentDto),
    unknownCodes: result.unknownCodes,
  });
};

export const closeReplenishments = async (req: Request, res: Response): Promise<void> => {
  const { body } = validated<AtmOperationIds>(req);
  const rows = await atmReplenishmentService.close(body.ids, authContext(req));
  ok(res, rows.map(toAtmReplenishmentDto));
};

export const reopenReplenishment = async (req: Request, res: Response): Promise<void> => {
  const { body, params } = validated<ReopenBody, never, IdParam>(req);
  const doc = await atmReplenishmentService.reopen(params.id, body.version, authContext(req));
  ok(res, toAtmReplenishmentDto(doc));
};

export const updateReplenishment = async (req: Request, res: Response): Promise<void> => {
  const { body, params } = validated<UpdateAtmReplenishment, never, IdParam>(req);
  const doc = await atmReplenishmentService.update(params.id, body, authContext(req));
  ok(res, toAtmReplenishmentDto(doc));
};

export const bulkUpdateReplenishments = async (req: Request, res: Response): Promise<void> => {
  const { body } = validated<BulkUpdateAtmReplenishments>(req);
  const rows = await atmReplenishmentService.bulkUpdate(body, authContext(req));
  ok(res, rows.map(toAtmReplenishmentDto));
};

export const deleteReplenishments = async (req: Request, res: Response): Promise<void> => {
  const { body } = validated<AtmOperationIds>(req);
  ok(res, { removed: await atmReplenishmentService.remove(body.ids, authContext(req)) });
};
