// Thin HTTP mapping only (ADR-003).
import { type Request, type Response } from 'express';
import {
  type CreateItLocation,
  type ItLocationOptionsQuery,
  type ListItLocationsQuery,
  type UpdateItLocation,
} from '@ecms/contracts';
import { created, ok, okPage, validated } from '../../../platform/web';
import { authContext } from '../../../platform/auth';
import { toItLocationDto, toItLocationOptionDto } from '../it.mappers';
import { heldOf, itLocationService } from './location.service';

type IdParam = { id: string };

export const listItLocations = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, ListItLocationsQuery>(req);
  const { page, held } = await itLocationService.list(query, authContext(req));
  okPage(res, page, (doc) => toItLocationDto(doc, heldOf(held, doc)));
};

export const listItLocationOptions = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, ItLocationOptionsQuery>(req);
  ok(res, (await itLocationService.options(query)).map(toItLocationOptionDto));
};

export const listItLocationBranchTargets = async (req: Request, res: Response): Promise<void> => {
  ok(res, await itLocationService.branchTargets(authContext(req)));
};

export const createItLocation = async (req: Request, res: Response): Promise<void> => {
  const { body } = validated<CreateItLocation>(req);
  const ctx = authContext(req);
  const doc = await itLocationService.create(body, ctx);
  created(res, toItLocationDto(doc, heldOf(await itLocationService.heldCounts([doc], ctx), doc)));
};

export const updateItLocation = async (req: Request, res: Response): Promise<void> => {
  const { body, params } = validated<UpdateItLocation, never, IdParam>(req);
  const ctx = authContext(req);
  const doc = await itLocationService.update(params.id, body, ctx);
  ok(res, toItLocationDto(doc, heldOf(await itLocationService.heldCounts([doc], ctx), doc)));
};
