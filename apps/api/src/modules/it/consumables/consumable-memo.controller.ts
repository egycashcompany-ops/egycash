// Thin HTTP mapping only (ADR-003) for a memo — the line acknowledgment's controller for the paper
// an issue writes, with the same multipart intake for its signed copy, so the screen files every
// IT paper the same way. Every call is scoped by the read grant, as the custody papers' are.
import { type Request, type Response } from 'express';
import { ok, validated } from '../../../platform/web';
import { authContext } from '../../../platform/auth';
import { ValidationError } from '../../../shared/errors';
import { scopeSelector } from '../../../shared/types';
import { toItConsumableMemoDto } from '../it.mappers';
import { itConsumableMemoService } from './consumable-memo.service';

type IdParam = { id: string };

const custodyScope = (req: Request) => scopeSelector(authContext(req), 'itAsset.view');

export const getItConsumableMemo = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, IdParam>(req);
  ok(res, toItConsumableMemoDto(await itConsumableMemoService.get(params.id, custodyScope(req))));
};

/** Print again — the same paper, under the same number. */
export const printItConsumableMemo = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, IdParam>(req);
  ok(res, toItConsumableMemoDto(await itConsumableMemoService.print(params.id, custodyScope(req))));
};

export const uploadItConsumableMemoSignedCopy = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const { params } = validated<never, never, IdParam>(req);
  const uploaded = req.file;
  if (uploaded === undefined) {
    throw new ValidationError([
      { field: 'file', code: 'REQUIRED', message: 'a file part named "file" is required' },
    ]);
  }
  const memo = await itConsumableMemoService.setSignedCopy(
    authContext(req),
    params.id,
    {
      originalName: uploaded.originalname,
      mime: uploaded.mimetype,
      size: uploaded.size,
      buffer: uploaded.buffer,
    },
    custodyScope(req),
  );
  ok(res, toItConsumableMemoDto(memo));
};

export const getItConsumableMemoSignedCopy = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, IdParam>(req);
  const copy = await itConsumableMemoService.readSignedCopy(
    authContext(req),
    params.id,
    custodyScope(req),
  );
  res.setHeader('Content-Type', copy.mime);
  res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(copy.fileName)}"`);
  res.setHeader('Cache-Control', 'private, no-store');
  res.send(copy.buffer);
};

export const deleteItConsumableMemoSignedCopy = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const { params } = validated<never, never, IdParam>(req);
  const memo = await itConsumableMemoService.deleteSignedCopy(
    authContext(req),
    params.id,
    custodyScope(req),
  );
  ok(res, toItConsumableMemoDto(memo));
};
