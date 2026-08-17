// Operations api/ surface (ADR-013): one typed function per backend endpoint, matching the
// Operations module's routes exactly — no mock data, no client-side fallbacks, and above all no
// business rules. Every page reads and writes through here.
//
// THE CLIENT IS NOT AUTHORITATIVE. The legacy screens carried their rules in browser JavaScript
// (crew double-booking, role detection, requirement filters — discovery §8.3, §8.2, §9). Those
// rules now live in the Operations domain, and this file only carries them across the wire. If a
// screen appears to need a rule the API does not expose, the rule belongs in the API.
//
// OP-B1 lands the reference-data surface (the legacy `/data_edit` screen — banks, branches,
// currencies). Later B slices add their endpoints beside these, never a second client.
import {
  type CreateOperationsBank,
  type CreateOperationsBankBranch,
  type CreateOperationsCurrency,
  type OperationsBankBranchDto,
  type OperationsBankDto,
  type OperationsCurrencyDto,
  type Paginated,
  type UpdateOperationsBank,
  type UpdateOperationsBankBranch,
  type UpdateOperationsCurrency,
} from '@ecms/contracts';
import { buildQuery, getPage, patch, post, type QueryParams } from '../../../shared/lib/api-client';

export type OperationsListParams = QueryParams;

// ── Banks (legacy `banks`, the operational name only — discovery §11.3) ─────
export const listBanks = (params: OperationsListParams): Promise<Paginated<OperationsBankDto>> =>
  getPage<OperationsBankDto>(`/operations/banks${buildQuery(params)}`);
export const createBank = (body: CreateOperationsBank): Promise<OperationsBankDto> =>
  post<OperationsBankDto>('/operations/banks', body);
export const updateBank = (
  id: string,
  body: UpdateOperationsBank,
): Promise<OperationsBankDto> => patch<OperationsBankDto>(`/operations/banks/${id}`, body);

// ── Bank branches (the legacy "location" model — discovery §11.1) ───────────
export const listBankBranches = (
  params: OperationsListParams,
): Promise<Paginated<OperationsBankBranchDto>> =>
  getPage<OperationsBankBranchDto>(`/operations/bank-branches${buildQuery(params)}`);
export const createBankBranch = (
  body: CreateOperationsBankBranch,
): Promise<OperationsBankBranchDto> =>
  post<OperationsBankBranchDto>('/operations/bank-branches', body);
export const updateBankBranch = (
  id: string,
  body: UpdateOperationsBankBranch,
): Promise<OperationsBankBranchDto> =>
  patch<OperationsBankBranchDto>(`/operations/bank-branches/${id}`, body);

// ── Currencies (legacy: a string array on a singleton doc — quirk Q33) ──────
export const listCurrencies = (
  params: OperationsListParams,
): Promise<Paginated<OperationsCurrencyDto>> =>
  getPage<OperationsCurrencyDto>(`/operations/currencies${buildQuery(params)}`);
export const createCurrency = (body: CreateOperationsCurrency): Promise<OperationsCurrencyDto> =>
  post<OperationsCurrencyDto>('/operations/currencies', body);
export const updateCurrency = (
  id: string,
  body: UpdateOperationsCurrency,
): Promise<OperationsCurrencyDto> =>
  patch<OperationsCurrencyDto>(`/operations/currencies/${id}`, body);

/** Every branch of one bank, for the cascading pickers the shipment screens use. */
export const branchesOfBank = (bankId: string): Promise<Paginated<OperationsBankBranchDto>> =>
  getPage<OperationsBankBranchDto>(
    `/operations/bank-branches${buildQuery({ bankId, pageSize: 200, sortBy: 'name', sortDir: 'asc' })}`,
  );
