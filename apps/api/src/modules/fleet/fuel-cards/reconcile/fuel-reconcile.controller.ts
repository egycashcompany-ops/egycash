// Thin HTTP mapping only (ADR-003) — «مطابقة أرصدة الكروت».
import { type Request, type Response } from 'express';
import { type DecideFleetFuelReconcile, type UploadFleetFuelSheet } from '@ecms/contracts';
import { authContext } from '../../../../platform/auth';
import { ok, validated } from '../../../../platform/web';
import { ValidationError } from '../../../../shared/errors';
import { uploadFileName } from '../../upload-file-name';
import { fleetFuelReconcileService } from './fuel-reconcile.service';

export const uploadFuelSheet = async (req: Request, res: Response): Promise<void> => {
  const { body } = validated<UploadFleetFuelSheet>(req);
  const uploaded = req.file;
  if (uploaded === undefined) {
    throw new ValidationError([
      { field: 'file', code: 'REQUIRED', message: 'a file part named "file" is required' },
    ]);
  }
  ok(
    res,
    await fleetFuelReconcileService.read(authContext(req), {
      company: body.company,
      // An Arabic file name arrives as latin1-spelled UTF-8 — the name as the person gave it.
      fileName: uploadFileName(uploaded.originalname),
      buffer: uploaded.buffer,
    }),
  );
};

export const decideFuelReconcile = async (req: Request, res: Response): Promise<void> => {
  const { body, params } = validated<DecideFleetFuelReconcile, never, { id: string }>(req);
  ok(res, await fleetFuelReconcileService.decide(authContext(req), params.id, body));
};
