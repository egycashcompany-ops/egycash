// Thin HTTP mapping only (ADR-003): parse, delegate, respond.
import { type Request, type Response } from 'express';
import { type ListMedicalProfilesQuery, type UpsertMedicalProfile } from '@ecms/contracts';
import { ok, okPage } from '../../../platform/web';
import { validated } from '../../../infrastructure/http/validate';
import { authContext } from '../../../platform/auth';
import { scopeSelector } from '../../../shared/types';
import { medicalProfileService } from './profiles/medical-profile.service';
import { toMedicalProfileDto } from './medical.mapper';

type EmployeeIdParam = { employeeId: string };

/**
 * The scope selector still runs, and its result is still passed — but on a repository that
 * declares NO axes, so it can only ever be the organization-wide filter (D4). It is threaded
 * anyway rather than skipped, so that the day somebody adds an axis the call site does not have to
 * be found and changed: it would start narrowing, visibly, and the guard would fail first.
 */
const profileScope = (req: Request) => scopeSelector(authContext(req), 'medicalRecord.view');

export const listMedicalProfiles = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, ListMedicalProfilesQuery>(req);
  okPage(res, await medicalProfileService.list(query, profileScope(req)), toMedicalProfileDto);
};

/** Null is an ordinary answer — an employee nobody has recorded anything about (see the service). */
export const getMedicalProfile = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { params } = validated<never, never, EmployeeIdParam>(req);
  const doc = await medicalProfileService.getByEmployee(ctx, params.employeeId);
  ok(res, doc === null ? null : toMedicalProfileDto(doc));
};

/** D5 — the employee's own record, in full, with no permission key. */
export const getMyMedicalProfile = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const doc = await medicalProfileService.getMine(ctx);
  ok(res, doc === null ? null : toMedicalProfileDto(doc));
};

export const upsertMedicalProfile = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body, params } = validated<UpsertMedicalProfile, never, EmployeeIdParam>(req);
  const doc = await medicalProfileService.upsert(ctx, params.employeeId, body);
  ok(res, toMedicalProfileDto(doc));
};
