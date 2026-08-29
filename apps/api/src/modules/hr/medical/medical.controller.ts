// Thin HTTP mapping only (ADR-003): parse, delegate, respond.
import { type Request, type Response } from 'express';
import {
  type EndInsuranceCard,
  type IssueInsuranceCard,
  type ListInsuranceCardsQuery,
  type ListMedicalEventsQuery,
  type ListMedicalProfilesQuery,
  type RecordMedicalEvent,
  type UpdateInsuranceCard,
  type UpsertMedicalProfile,
} from '@ecms/contracts';
import { created, ok, okPage } from '../../../platform/web';
import { validated } from '../../../infrastructure/http/validate';
import { authContext } from '../../../platform/auth';
import { scopeSelector } from '../../../shared/types';
import { medicalProfileService } from './profiles/medical-profile.service';
import { medicalEventService } from './events/medical-event.service';
import { insuranceCardService } from './insurance/insurance-card.service';
import { type UploadedBinary } from '../../../platform/files';
import { toInsuranceCardDto, toMedicalEventDto, toMedicalProfileDto } from './medical.mapper';

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

// ── Events ──────────────────────────────────────────────────────────────────

const eventScope = (req: Request) => scopeSelector(authContext(req), 'medicalRecord.view');

/**
 * The list, with each row's document resolved.
 *
 * One lookup per row, which is fine at this page size and honest: the row holds no file link
 * (D9), so there is nothing to denormalize. A page of 25 medical events is not a hot path.
 */
export const listMedicalEvents = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { query } = validated<never, ListMedicalEventsQuery>(req);
  const scope = eventScope(req);
  const page = await medicalEventService.list(query, scope, ctx);
  const rows = await Promise.all(
    page.items.map(async (doc) => {
      const document = await medicalEventService.documentOf(ctx, String(doc._id), scope);
      return toMedicalEventDto(doc, document);
    }),
  );
  ok(res, { items: rows, meta: page.meta });
};

/**
 * Recording one — multipart, because the certificate arrives with the event rather than after it.
 *
 * The event can never be written again (D9), so there is no «attach a document later» endpoint:
 * the paper and the fact are filed in the same request or the paper is filed against a new event.
 */
export const recordMedicalEvent = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body } = validated<RecordMedicalEvent>(req);
  const upload = (req as Request & { file?: UploadedBinary }).file ?? null;
  const doc = await medicalEventService.record(ctx, body, upload);
  const document = await medicalEventService.documentOf(ctx, String(doc._id), eventScope(req));
  created(res, toMedicalEventDto(doc, document), `/api/v1/hr/medical/events/${String(doc._id)}`);
};

// THERE IS NO UPDATE HANDLER AND NO DELETE HANDLER (D9), and their absence is the statement. A
// handler that threw «this is immutable» for a route nobody declared would be theatre: the
// enforcement is the repository's write seam, which refuses the write itself, and the absent route
// is what a reader of this file should find.

// ── Insurance ───────────────────────────────────────────────────────────────

type CardIdParam = { id: string };

/**
 * The card's scope selector DOES narrow, unlike the clinical ones (D4).
 *
 * Its repository declares both axes, so a branch-scoped HR officer sees their branch's cards —
 * which is the point: benefits administration is delegable and clinical reading is not.
 */
const cardScope = (req: Request) => scopeSelector(authContext(req), 'medicalInsurance.view');

export const listInsuranceCards = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, ListInsuranceCardsQuery>(req);
  okPage(res, await insuranceCardService.list(query, cardScope(req)), toInsuranceCardDto);
};

export const issueInsuranceCard = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body } = validated<IssueInsuranceCard>(req);
  const doc = await insuranceCardService.issue(ctx, body);
  created(res, toInsuranceCardDto(doc), `/api/v1/hr/medical/insurance/${String(doc._id)}`);
};

export const updateInsuranceCard = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body, params } = validated<UpdateInsuranceCard, never, CardIdParam>(req);
  const doc = await insuranceCardService.update(ctx, params.id, body, cardScope(req));
  ok(res, toInsuranceCardDto(doc));
};

export const endInsuranceCard = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body, params } = validated<EndInsuranceCard, never, CardIdParam>(req);
  const doc = await insuranceCardService.end(ctx, params.id, body, cardScope(req));
  ok(res, toInsuranceCardDto(doc));
};
