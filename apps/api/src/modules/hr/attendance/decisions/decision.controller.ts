// Thin HTTP mapping only (ADR-003). The caller's capabilities are computed HERE from the session's
// effective permissions and handed to the service — the Leave idiom, so the service authorizes
// without reaching into the request.
import { type Request, type Response } from 'express';
import {
  type AttendanceDecisionDto,
  type CreateAttendanceDecision,
  type DecideAttendanceDecision,
  type ListAttendanceDecisionsQuery,
  type RevokeAttendanceDecision,
  type AttendanceDecisionSignalsQuery,
  type ExportAttendanceDecisionsQuery,
} from '@ecms/contracts';
import { created, ok, okPage, validated } from '../../../../platform/web';
import { authContext } from '../../../../platform/auth';
import { scopeSelector } from '../../../../shared/types';
import { employeeLabelMap, labelFields } from '../../shared/employee-labels';
import { decisionService, toDecisionDto, type DecisionCallerFlags } from './decision.service';
import { streamDecisionExport } from './decision-export';
import { directoryProfileService } from '../../../../platform/directory/directory-profile.service';

type IdParam = { id: string };

const flagsOf = (req: Request): DecisionCallerFlags => {
  const ctx = authContext(req);
  return {
    canDecide: 'attendance.decide' in ctx.permissions,
    canApprove: 'attendance.decideApprove' in ctx.permissions,
  };
};

export const listDecisions = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { query } = validated<never, ListAttendanceDecisionsQuery, never>(req);
  const page = await decisionService.list(query, scopeSelector(ctx, 'attendance.decide'));
  const labels = await employeeLabelMap(page.items.map((doc) => String(doc.employeeId)));
  // The people, by name. A decision is answerable to somebody, and a screen showing an opaque id
  // cannot be used to hold anybody to it — so the deciders are resolved on the read exactly as the
  // employees are, batched once per page rather than per row.
  const actorIds = [
    ...new Set(
      page.items
        .flatMap((doc) => [doc.decidedBy, doc.hrDecidedBy])
        .filter((id): id is NonNullable<typeof id> => id !== null)
        .map((id) => String(id)),
    ),
  ];
  const actors = await directoryProfileService.resolve(actorIds);
  /** Spread-friendly, and the key is only present when a name was actually found. */
  const named = <K extends 'decidedByName' | 'hrDecidedByName'>(
    key: K,
    id: unknown,
  ): Partial<Pick<AttendanceDecisionDto, K>> => {
    if (id === null || id === undefined) return {};
    const profile = actors.get(String(id));
    return profile === undefined ? {} : ({ [key]: profile.displayName } as Pick<AttendanceDecisionDto, K>);
  };
  okPage(
    res,
    page,
    (doc): AttendanceDecisionDto => ({
      ...toDecisionDto(doc),
      ...labelFields(labels, String(doc.employeeId)),
      ...named('decidedByName', doc.decidedBy),
      ...named('hrDecidedByName', doc.hrDecidedBy),
    }),
  );
};

/** Who has been deciding days, and how often against the devices (§4). */
export const decisionSignals = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { query } = validated<never, AttendanceDecisionSignalsQuery, never>(req);
  ok(res, await decisionService.signals(query, scopeSelector(ctx, 'attendance.decide')));
};

/** The CSV. Its own permission and its own audit row, exactly like the attendance export. */
export const exportDecisions = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { query } = validated<never, ExportAttendanceDecisionsQuery, never>(req);
  await streamDecisionExport(res, ctx, query, scopeSelector(ctx, 'attendance.export'));
};

export const createDecision = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body } = validated<CreateAttendanceDecision, never, never>(req);
  const doc = await decisionService.create(ctx, flagsOf(req), body);
  created(res, toDecisionDto(doc));
};

export const decideDecision = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body, params } = validated<DecideAttendanceDecision, never, IdParam>(req);
  const doc = await decisionService.decide(ctx, flagsOf(req), params.id, body);
  ok(res, toDecisionDto(doc));
};

export const revokeDecision = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body, params } = validated<RevokeAttendanceDecision, never, IdParam>(req);
  const doc = await decisionService.revoke(ctx, flagsOf(req), params.id, body);
  ok(res, toDecisionDto(doc));
};
