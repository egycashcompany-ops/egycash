import { type Request, type Response } from 'express';
import {
  type CreateItTicketPriority,
  type ListItTicketPrioritiesQuery,
  type UpdateItTicketPriority,
} from '@ecms/contracts';
import { created, ok, okPage, validated } from '../../../platform/web';
import { authContext } from '../../../platform/auth';
import { toItTicketPriorityDto } from '../it.mappers';
import { itTicketPriorityService } from './priority.service';

type IdParam = { id: string };

export const listItTicketPriorities = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, ListItTicketPrioritiesQuery>(req);
  okPage(res, await itTicketPriorityService.list(query), toItTicketPriorityDto);
};

export const createItTicketPriority = async (req: Request, res: Response): Promise<void> => {
  const { body } = validated<CreateItTicketPriority>(req);
  const doc = await itTicketPriorityService.create(body, authContext(req).userId);
  created(res, toItTicketPriorityDto(doc));
};

export const updateItTicketPriority = async (req: Request, res: Response): Promise<void> => {
  const { body, params } = validated<UpdateItTicketPriority, never, IdParam>(req);
  const doc = await itTicketPriorityService.update(params.id, body, authContext(req).userId);
  ok(res, toItTicketPriorityDto(doc));
};
