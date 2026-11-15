// The intake form's endpoints. The public pair carry no credentials and must NOT go through the
// authenticated client's refresh/retry machinery — a candidate has no session to refresh.
import {
  type PublicNationalIdCardUploadDto,
  type PublicRecruitmentFormDto,
  type RecruitmentFormDto,
  type RecruitmentFormSubmissionDto,
  type SubmitRecruitmentForm,
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

// Same fallback as the authenticated client (`shared/lib/api-client.ts`): every deployment sets
// VITE_API_BASE_URL; without it (local dev) the API is on its own port, not behind Vite.
const API_BASE =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? 'http://localhost:3000/api/v1';

const publicCall = async <T>(path: string, init?: RequestInit): Promise<T> => {
  // A multipart body sets its own content type (with the boundary); everything else is JSON.
  const json = !(init?.body instanceof FormData);
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { ...(json ? { 'content-type': 'application/json' } : {}), ...(init?.headers ?? {}) },
  });
  const body = (await res.json()) as
    | { success: true; data: T }
    | {
        success: false;
        error: { message: string; details?: { field?: string; code?: string; message: string }[] };
      };
  if (!body.success) {
    const error = new Error(body.error.message) as Error & {
      details?: { field?: string; code?: string; message: string }[];
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
  nationalIdCard?: { frontFileId: string; backFileId: string },
  extras: Pick<SubmitRecruitmentForm, 'heardFrom' | 'documents' | 'cvFileId'> = {},
): Promise<RecruitmentFormSubmissionDto> =>
  publicCall<RecruitmentFormSubmissionDto>(`/hr/public/apply/${token}`, {
    method: 'POST',
    body: JSON.stringify({ answers, ...(nationalIdCard === undefined ? {} : { nationalIdCard }), ...extras }),
  });

/** The CV (PDF, Word or a photo), uploaded the moment it is picked. */
export const uploadPublicCv = async (token: string, file: File): Promise<string> => {
  const form = new FormData();
  form.append('file', file);
  const res = await publicCall<PublicNationalIdCardUploadDto>(`/hr/public/apply/${token}/cv`, {
    method: 'POST',
    body: form,
  });
  return res.fileId;
};

/** One card photo, uploaded the moment it is picked. */
export const uploadPublicCardPhoto = async (token: string, file: File): Promise<string> => {
  const form = new FormData();
  form.append('file', file);
  const res = await publicCall<PublicNationalIdCardUploadDto>(
    `/hr/public/apply/${token}/national-id-card`,
    { method: 'POST', body: form },
  );
  return res.fileId;
};
