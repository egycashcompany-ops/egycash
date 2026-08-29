// TanStack Query hooks for the health profile (ADR-013 — P-HR-MED, M2).
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type RecordMedicalEvent, type UpsertMedicalProfile } from '@ecms/contracts';
import { detailKey, listKey } from '../../../../shared/lib/query-keys';
import * as api from './medical-api';

const MODULE = 'hr';
const PROFILES = 'medicalProfiles';
const EVENTS = 'medicalEvents';

export const useMedicalProfiles = (params: Record<string, string | number | undefined>) =>
  useQuery({
    queryKey: listKey(MODULE, PROFILES, params),
    queryFn: () => api.listMedicalProfiles(params),
    placeholderData: (prev) => prev,
  });

/**
 * One person's record.
 *
 * `staleTime: 0` and no `placeholderData`, unlike every other detail read in this codebase. Serving
 * a cached clinical record to a later render is how one person's health data appears on a screen
 * opened for somebody else — and every fetch is audited (D14), so a refetch is also the honest
 * thing: it says somebody looked again.
 */
export const useMedicalProfile = (employeeId: string | undefined) =>
  useQuery({
    queryKey: detailKey(MODULE, PROFILES, employeeId ?? ''),
    queryFn: () => api.getMedicalProfile(employeeId ?? ''),
    enabled: employeeId !== undefined && employeeId !== '',
    staleTime: 0,
    gcTime: 0,
  });

/** D5 — the caller's own record. Same no-cache stance, for the same reason. */
export const useMyMedicalProfile = () =>
  useQuery({
    queryKey: [MODULE, PROFILES, 'me'],
    queryFn: () => api.getMyMedicalProfile(),
    staleTime: 0,
    gcTime: 0,
  });

export const useUpsertMedicalProfile = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ employeeId, body }: { employeeId: string; body: UpsertMedicalProfile }) =>
      api.upsertMedicalProfile(employeeId, body),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: [MODULE, PROFILES] });
    },
  });
};

/**
 * One person's medical history.
 *
 * Same no-cache stance as the profile: reading somebody's history is a read of their clinical
 * record and the server audits it (D14), so serving a cached page would be a read the log never
 * saw — and it would be the read that most often happens on a screen opened for somebody else.
 */
export const useMedicalEvents = (params: Record<string, string | number | undefined>) =>
  useQuery({
    queryKey: listKey(MODULE, EVENTS, params),
    queryFn: () => api.listMedicalEvents(params),
    staleTime: 0,
    gcTime: 0,
  });

export const useRecordMedicalEvent = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ body, file }: { body: RecordMedicalEvent; file: File | null }) =>
      api.recordMedicalEvent(body, file),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: [MODULE, EVENTS] });
    },
  });
};
