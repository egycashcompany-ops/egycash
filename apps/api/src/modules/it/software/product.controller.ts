import { type Request, type Response } from 'express';
import {
  type CreateItSoftwareProduct,
  type ListItSoftwareProductsQuery,
  type UpdateItSoftwareProduct,
} from '@ecms/contracts';
import { created, ok, okPage, validated } from '../../../platform/web';
import { authContext } from '../../../platform/auth';
import { toItSoftwareProductDto } from '../it.mappers';
import { itSoftwareProductService } from './product.service';

type IdParam = { id: string };

export const listItSoftwareProducts = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, ListItSoftwareProductsQuery>(req);
  okPage(res, await itSoftwareProductService.list(query), toItSoftwareProductDto);
};

export const getItSoftwareProduct = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, IdParam>(req);
  ok(res, toItSoftwareProductDto(await itSoftwareProductService.getById(params.id)));
};

export const createItSoftwareProduct = async (req: Request, res: Response): Promise<void> => {
  const { body } = validated<CreateItSoftwareProduct>(req);
  created(res, toItSoftwareProductDto(await itSoftwareProductService.create(body, authContext(req))));
};

export const updateItSoftwareProduct = async (req: Request, res: Response): Promise<void> => {
  const { body, params } = validated<UpdateItSoftwareProduct, never, IdParam>(req);
  const doc = await itSoftwareProductService.update(params.id, body, authContext(req));
  ok(res, toItSoftwareProductDto(doc));
};
