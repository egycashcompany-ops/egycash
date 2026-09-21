// System Administration → Approval chains: the api/ surface (ADR-013).
import {
  type ApprovalRequestTypeDto,
  type ApprovalWorkflowDto,
  type SetApprovalWorkflow,
} from '@ecms/contracts';
import { del, get, put } from '../../../../shared/lib/api-client';

/**
 * Every chain, of every type, in one read — and deliberately not paged.
 *
 * A chain is configuration, not data: there is one row per (type, department, branch) the company
 * actually differs on, which is a handful, and the screen's whole job is to show the DEFAULT beside
 * the exceptions that override it. Paging that apart would hide the relationship the screen exists
 * to make visible.
 */
export const listWorkflows = (): Promise<ApprovalWorkflowDto[]> =>
  get<ApprovalWorkflowDto[]>('/platform/approvals');

export const listRequestTypes = (): Promise<ApprovalRequestTypeDto[]> =>
  get<ApprovalRequestTypeDto[]>('/platform/approvals/request-types');

export const setWorkflow = (body: SetApprovalWorkflow): Promise<ApprovalWorkflowDto> =>
  put<ApprovalWorkflowDto>('/platform/approvals', body);

export const deleteWorkflow = (id: string): Promise<void> =>
  del<void>(`/platform/approvals/${id}`);
