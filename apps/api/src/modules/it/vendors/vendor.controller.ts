// Thin HTTP mapping only (ADR-003).
import { type Request, type Response } from 'express';
import {
  type CreateItVendor,
  type ListItVendorsQuery,
  type UpdateItVendor,
} from '@ecms/contracts';
import { created, ok, okPage, validated } from '../../../platform/web';
import { authContext } from '../../../platform/auth';
import { toItVendorDto } from '../it.mappers';
import { itVendorService } from './vendor.service';

type IdParam = { id: string };

export const listItVendors = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, ListItVendorsQuery>(req);
  okPage(res, await itVendorService.list(query), toItVendorDto);
};

export const createItVendor = async (req: Request, res: Response): Promise<void> => {
  const { body } = validated<CreateItVendor>(req);
  const doc = await itVendorService.create(body, authContext(req).userId);
  created(res, toItVendorDto(doc));
};

export const updateItVendor = async (req: Request, res: Response): Promise<void> => {
  const { body, params } = validated<UpdateItVendor, never, IdParam>(req);
  const doc = await itVendorService.update(params.id, body, authContext(req).userId);
  ok(res, toItVendorDto(doc));
};
