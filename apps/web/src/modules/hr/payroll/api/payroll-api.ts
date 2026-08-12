// Payroll api/ surface (ADR-013). PY-1 is the pay-item catalog and nothing else.
import {
  type CreatePayItem,
  type Paginated,
  type PayItemDto,
  type UpdatePayItem,
} from '@ecms/contracts';
import { buildQuery, del, patch, post, getPage, type QueryParams } from '../../../../shared/lib/api-client';

export const listPayItems = (params: QueryParams): Promise<Paginated<PayItemDto>> =>
  getPage<PayItemDto>(`/hr/payroll/pay-items${buildQuery(params)}`);

export const createPayItem = (body: CreatePayItem): Promise<PayItemDto> =>
  post<PayItemDto>('/hr/payroll/pay-items', body);

export const updatePayItem = (id: string, body: UpdatePayItem): Promise<PayItemDto> =>
  patch<PayItemDto>(`/hr/payroll/pay-items/${id}`, body);

export const deletePayItem = (id: string): Promise<void> =>
  del<void>(`/hr/payroll/pay-items/${id}`);
