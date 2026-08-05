import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type RecruitmentFormDto, type UpdateRecruitmentForm } from '@ecms/contracts';
import * as api from './recruitment-form-api';

/** Exported because the form's `links` list is derived from the applicant-source catalog: adding
 *  or disabling a source changes what this query returns, and the screen that does so has to say
 *  so. Sharing the key beats re-declaring the same array somewhere else. */
export const RECRUITMENT_FORM_KEY = ['hr', 'recruitment-form'] as const;
const KEY = RECRUITMENT_FORM_KEY;

export const useRecruitmentForm = () =>
  useQuery({ queryKey: KEY, queryFn: api.getRecruitmentForm });

/** Every write answers with the whole form, so the cache is replaced rather than invalidated. */
const useFormWrite = <TInput>(fn: (input: TInput) => Promise<RecruitmentFormDto>) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (form) => qc.setQueryData(KEY, form),
  });
};

export const useUpdateRecruitmentForm = () =>
  useFormWrite<UpdateRecruitmentForm>(api.updateRecruitmentForm);
export const useGenerateFormLink = () => useFormWrite<string>(api.generateRecruitmentFormLink);
export const useRevokeFormLink = () => useFormWrite<string>(api.revokeRecruitmentFormLink);
