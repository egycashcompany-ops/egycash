import { type Request, type Response } from 'express';
import {
  type CreateItSoftwareInstallation,
  type ListItSoftwareInstallationsQuery,
  type RemoveItSoftwareInstallation,
  type UpdateItSoftwareInstallation,
} from '@ecms/contracts';
import { created, ok, okPage, validated } from '../../../platform/web';
import { authContext } from '../../../platform/auth';
import { scopeSelector } from '../../../shared/types';
import { toItSoftwareInstallationDto } from '../it.mappers';
import { itSoftwareInstallationService } from './installation.service';

type IdParam = { id: string };

/** Reads ride the software grant's own scope, filtered by the asset's branch (§7). */
const readScope = (req: Request) => scopeSelector(authContext(req), 'itSoftware.view');

export const listItSoftwareInstallations = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, ListItSoftwareInstallationsQuery>(req);
  okPage(
    res,
    await itSoftwareInstallationService.list(query, readScope(req)),
    toItSoftwareInstallationDto,
  );
};

export const getItSoftwareInstallation = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, IdParam>(req);
  const doc = await itSoftwareInstallationService.getById(params.id, readScope(req));
  ok(res, toItSoftwareInstallationDto(doc));
};

export const createItSoftwareInstallation = async (req: Request, res: Response): Promise<void> => {
  const { body } = validated<CreateItSoftwareInstallation>(req);
  const doc = await itSoftwareInstallationService.create(body, authContext(req));
  created(res, toItSoftwareInstallationDto(doc));
};

export const updateItSoftwareInstallation = async (req: Request, res: Response): Promise<void> => {
  const { body, params } = validated<UpdateItSoftwareInstallation, never, IdParam>(req);
  const doc = await itSoftwareInstallationService.update(params.id, body, authContext(req));
  ok(res, toItSoftwareInstallationDto(doc));
};

export const removeItSoftwareInstallation = async (req: Request, res: Response): Promise<void> => {
  const { body, params } = validated<RemoveItSoftwareInstallation, never, IdParam>(req);
  const doc = await itSoftwareInstallationService.remove(params.id, body, authContext(req));
  ok(res, toItSoftwareInstallationDto(doc));
};
