// The intake form's endpoints. The public pair carry no credentials and must NOT go through the
// authenticated client's refresh/retry machinery — a candidate has no session to refresh.
import {
  type PublicRecruitmentFormDto,
  type RecruitmentFormDto,
  type RecruitmentFormSubmissionDto,
  type UpdateRecruitmentForm,
} from '@ecms/contracts';
import { del, get, patch, post } from '../../../../../shared/lib/api-client';

export const getRecruitmentForm = (): Promise<RecruitmentFormDto> =>
  get<RecruitmentFormDto>('/hr/recruitment-form');

export const updateRecruitmentForm = (body: UpdateRecruitmentForm): Promise<RecruitmentFormDto> =>
  patch<RecruitmentFormDto>('/hr/recruitment-form', body);

export const generateRecruitmentFormLink = (sourceId: string): Promise<RecruitmentFormDto> =>
  post<RecruitmentFormDto>('/hr/recruitment-form/links', { sourceId });

export const revokeRecruitmentFormLink = (sourceId: string): Promise<RecruitmentFormDto> =>
  del<RecruitmentFormDto>(`/hr/recruitment-form/links/${sourceId}`);

// ── Public (no session) ─────────────────────────────────────────────────────

const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? '/api/v1';

const publicCall = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
  const body = (await res.json()) as
    | { success: true; data: T }
    | { success: false; error: { message: string; details?: { field?: string; message: string }[] } };
  if (!body.success) {
    const error = new Error(body.error.message) as Error & {
      details?: { field?: string; message: string }[];
      status?: number;
    };
    error.details = body.error.details ?? [];
    error.status = res.status;
    throw error;
  }
  return body.data;
};

export const getPublicApplyForm = (token: string): Promise<PublicRecruitmentFormDto> =>
  publicCall<PublicRecruitmentFormDto>(`/hr/public/apply/${token}`);

export const submitPublicApplyForm = (
  token: string,
  answers: Record<string, string | boolean>,
): Promise<RecruitmentFormSubmissionDto> =>
  publicCall<RecruitmentFormSubmissionDto>(`/hr/public/apply/${token}`, {
    method: 'POST',
    body: JSON.stringify({ answers }),
  });
