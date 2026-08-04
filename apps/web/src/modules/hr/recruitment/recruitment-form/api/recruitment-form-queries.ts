import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type RecruitmentFormDto, type UpdateRecruitmentForm } from '@ecms/contracts';
import * as api from './recruitment-form-api';

const KEY = ['hr', 'recruitment-form'] as const;

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
