import { type Request, type Response } from 'express';
import {
  type CreateItLicense,
  type ListItLicensesQuery,
  type ListItSoftwareInstallationsQuery,
  type UpdateItLicense,
} from '@ecms/contracts';
import { created, ok, okPage, validated } from '../../../platform/web';
import { authContext } from '../../../platform/auth';
import { scopeSelector } from '../../../shared/types';
import { toItLicenseDto, toItSoftwareInstallationDto } from '../it.mappers';
import { itLicenseService } from './license.service';
import { itSoftwareInstallationService } from '../software/installation.service';

type IdParam = { id: string };

export const listItLicenses = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, ListItLicensesQuery>(req);
  okPage(res, await itLicenseService.list(query), toItLicenseDto);
};

export const getItLicense = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, IdParam>(req);
  ok(res, toItLicenseDto(await itLicenseService.getById(params.id)));
};

export const createItLicense = async (req: Request, res: Response): Promise<void> => {
  const { body } = validated<CreateItLicense>(req);
  created(res, toItLicenseDto(await itLicenseService.create(body, authContext(req))));
};

export const updateItLicense = async (req: Request, res: Response): Promise<void> => {
  const { body, params } = validated<UpdateItLicense, never, IdParam>(req);
  ok(res, toItLicenseDto(await itLicenseService.update(params.id, body, authContext(req))));
};

/**
 * Who is consuming this licence's seats.
 *
 * `seatsUsed` is a number; this is the list behind it, and without it an over-seats warning names
 * a problem nobody can act on. Scoped like any installation read, so the count stays a company
 * fact while the ROWS a caller sees stay within their branch.
 */
export const listItLicenseInstallations = async (req: Request, res: Response): Promise<void> => {
  const { query, params } = validated<never, ListItSoftwareInstallationsQuery, IdParam>(req);
  const page = await itSoftwareInstallationService.list(
    { ...query, licenseId: params.id },
    scopeSelector(authContext(req), 'itSoftware.view'),
  );
  okPage(res, page, toItSoftwareInstallationDto);
};
