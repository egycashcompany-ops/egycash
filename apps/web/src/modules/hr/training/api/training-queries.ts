// TanStack Query hooks for the training catalogue and its sessions (ADR-013 — P-HR-TRN, T2).
//
// TWO INVALIDATION KEYS, NOT ONE, because the two collections change for different reasons. A
// session transition does not touch the catalogue, and retiring a course does not move anybody's
// seat — invalidating both on every write would refetch a catalogue that had not changed on every
// «start session» click, which is the sort of thing that looks free until a company has a hundred
// courses and forty people running sessions.
//
// A SESSION WRITE DOES INVALIDATE THE COURSES, in one direction only: creating a session is the
// thing that makes a course undeletable, and the catalogue screen shows that. So the session
// mutations refresh sessions, and the COURSE mutations refresh only courses.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  type CancelTrainingEnrollment,
  type CreateTrainingCourse,
  type CreateTrainingNomination,
  type CreateTrainingSession,
  type DecideTrainingNomination,
  type EnrollInTrainingSession,
  type TransitionTrainingSession,
  type UpdateTrainingCourse,
  type UpdateTrainingSession,
  type WithdrawTrainingNomination,
} from '@ecms/contracts';
import { detailKey, listKey } from '../../../../shared/lib/query-keys';
import * as api from './training-api';

const MODULE = 'hr';
const COURSES = 'trainingCourses';
const SESSIONS = 'trainingSessions';
const NOMINATIONS = 'trainingNominations';
const ENROLLMENTS = 'trainingEnrollments';

// ── Courses ─────────────────────────────────────────────────────────────────

export const useTrainingCourses = (params: Record<string, string | number | undefined>) =>
  useQuery({
    queryKey: listKey(MODULE, COURSES, params),
    queryFn: () => api.listTrainingCourses(params),
    placeholderData: (prev) => prev,
  });

/**
 * The picker's read: active courses only, one page, long-cached.
 *
 * Its own key rather than a filtered reuse of the list above, because the two are asked by
 * different screens for different reasons — the catalogue screen pages and filters, and this one
 * never does. Sharing a key would make every catalogue filter change refetch the picker.
 */
export const useActiveTrainingCourses = () =>
  useQuery({
    queryKey: listKey(MODULE, COURSES, { active: true, pageSize: 200 }),
    queryFn: () => api.listTrainingCourses({ active: true, pageSize: 200, sortBy: 'order' }),
    staleTime: 5 * 60_000,
    select: (page) => page.items,
  });

const useCourseMutation = <TVars>(fn: (vars: TVars) => Promise<unknown>) => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: [MODULE, COURSES] });
    },
  });
};

export const useCreateTrainingCourse = () =>
  useCourseMutation((body: CreateTrainingCourse) => api.createTrainingCourse(body));

export const useUpdateTrainingCourse = () =>
  useCourseMutation(({ id, body }: { id: string; body: UpdateTrainingCourse }) =>
    api.updateTrainingCourse(id, body),
  );

// ── Sessions ────────────────────────────────────────────────────────────────

export const useTrainingSessions = (params: Record<string, string | number | undefined>) =>
  useQuery({
    queryKey: listKey(MODULE, SESSIONS, params),
    queryFn: () => api.listTrainingSessions(params),
    placeholderData: (prev) => prev,
  });

export const useTrainingSession = (id: string) =>
  useQuery({
    queryKey: detailKey(MODULE, SESSIONS, id),
    queryFn: () => api.getTrainingSession(id),
    enabled: id !== '',
  });

const useSessionMutation = <TVars>(fn: (vars: TVars) => Promise<unknown>) => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: [MODULE, SESSIONS] });
    },
  });
};

export const useCreateTrainingSession = () =>
  useSessionMutation((body: CreateTrainingSession) => api.createTrainingSession(body));

export const useUpdateTrainingSession = () =>
  useSessionMutation(({ id, body }: { id: string; body: UpdateTrainingSession }) =>
    api.updateTrainingSession(id, body),
  );

export const useTransitionTrainingSession = () =>
  useSessionMutation(({ id, body }: { id: string; body: TransitionTrainingSession }) =>
    api.transitionTrainingSession(id, body),
  );

// ── Nominations and seats ───────────────────────────────────────────────────

export const useTrainingNominations = (params: Record<string, string | number | undefined>) =>
  useQuery({
    queryKey: listKey(MODULE, NOMINATIONS, params),
    queryFn: () => api.listTrainingNominations(params),
    placeholderData: (prev) => prev,
  });

export const useTrainingEnrollments = (params: Record<string, string | number | undefined>) =>
  useQuery({
    queryKey: listKey(MODULE, ENROLLMENTS, params),
    queryFn: () => api.listTrainingEnrollments(params),
    placeholderData: (prev) => prev,
  });

/**
 * A decision moves THREE things, so it refreshes all three.
 *
 * Approving a nomination creates a seat, and a seat changes what the session's roster and its
 * remaining capacity say. Refreshing only the nominations would leave a screen showing a session
 * with room in it that the approval just filled — which is the number somebody uses to decide
 * whether to approve the next one.
 */
const useNominationMutation = <TVars>(fn: (vars: TVars) => Promise<unknown>) => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: [MODULE, NOMINATIONS] });
      void client.invalidateQueries({ queryKey: [MODULE, ENROLLMENTS] });
      void client.invalidateQueries({ queryKey: [MODULE, SESSIONS] });
    },
  });
};

export const useCreateTrainingNomination = () =>
  useNominationMutation((body: CreateTrainingNomination) => api.createTrainingNomination(body));

export const useDecideTrainingNomination = () =>
  useNominationMutation(({ id, body }: { id: string; body: DecideTrainingNomination }) =>
    api.decideTrainingNomination(id, body),
  );

export const useWithdrawTrainingNomination = () =>
  useNominationMutation(({ id, body }: { id: string; body: WithdrawTrainingNomination }) =>
    api.withdrawTrainingNomination(id, body),
  );

export const useEnrollInTrainingSession = () =>
  useNominationMutation((body: EnrollInTrainingSession) => api.enrollInTrainingSession(body));

export const useCancelTrainingEnrollment = () =>
  useNominationMutation(({ id, body }: { id: string; body: CancelTrainingEnrollment }) =>
    api.cancelTrainingEnrollment(id, body),
  );
