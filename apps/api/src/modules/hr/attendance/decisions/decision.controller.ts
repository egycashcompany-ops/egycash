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
} from '@ecms/contracts';
import { created, ok, okPage, validated } from '../../../../platform/web';
import { authContext } from '../../../../platform/auth';
import { scopeSelector } from '../../../../shared/types';
import { employeeLabelMap, labelFields } from '../../shared/employee-labels';
import { decisionService, toDecisionDto, type DecisionCallerFlags } from './decision.service';

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
  okPage(
    res,
    page,
    (doc): AttendanceDecisionDto => ({
      ...toDecisionDto(doc),
      ...labelFields(labels, String(doc.employeeId)),
    }),
  );
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
