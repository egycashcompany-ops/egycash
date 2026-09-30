// Thin HTTP mapping only (ADR-003).
import { type Request, type Response } from 'express';
import {
  type CreateFleetNotice,
  type ListFleetNoticesQuery,
  type UpdateFleetNotice,
} from '@ecms/contracts';
import { created, noContent, ok, okPage, validated } from '../../../platform/web';
import { authContext } from '../../../platform/auth';
import { fleetNoticeService, toNoticeDto } from './notice.service';

type IdParam = { id: string };

export const listNotices = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, ListFleetNoticesQuery>(req);
  okPage(res, await fleetNoticeService.list(query), toNoticeDto);
};

export const getNotice = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, IdParam>(req);
  ok(res, toNoticeDto(await fleetNoticeService.get(params.id)));
};

export const createNotice = async (req: Request, res: Response): Promise<void> => {
  const { body } = validated<CreateFleetNotice>(req);
  created(res, toNoticeDto(await fleetNoticeService.create(body, authContext(req).userId)));
};

export const updateNotice = async (req: Request, res: Response): Promise<void> => {
  const { body, params } = validated<UpdateFleetNotice, never, IdParam>(req);
  ok(res, toNoticeDto(await fleetNoticeService.update(params.id, body, authContext(req).userId)));
};

export const deleteNotice = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, IdParam>(req);
  await fleetNoticeService.remove(params.id, authContext(req).userId);
  noContent(res);
};
