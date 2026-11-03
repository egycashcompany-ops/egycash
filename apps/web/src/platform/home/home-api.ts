// The welcome page's data: the signed-in person's own summary and photo.
//
// Both read through `me` — the id comes from the token, never from the page — and both answer
// "nothing" rather than an error for an account with no employee behind it (an administrator, a
// service account): that account still gets its welcome, without the personal card.
import { useQuery } from '@tanstack/react-query';
import { type MyEmployeeSummaryDto } from '@ecms/contracts';
import { ApiError, api } from '../../shared/lib/api-client';
import { useAuthedImage } from '../../shared/lib/authed-image';
import { useAppSelector } from '../../store';

/** Cache keys, exported so a photo upload can refresh every face on screen. */
export const MY_SUMMARY_KEY = ['hr', 'employees', 'me', 'summary'] as const;
export const myPhotoKey = (version: string | null): readonly unknown[] => [
  'hr',
  'employees',
  'me',
  'photo',
  version,
];

/** An account with an employee behind it — the only kind that has a summary to ask for. */
export const useHasEmployee = (): boolean =>
  useAppSelector((state) => {
    const me = state.auth.me;
    return me !== null && me.employeeId !== null && me.external === null;
  });

export const useMyEmployeeSummary = () => {
  const hasEmployee = useHasEmployee();
  return useQuery({
    queryKey: MY_SUMMARY_KEY,
    queryFn: async (): Promise<MyEmployeeSummaryDto | null> => {
      try {
        return await api<MyEmployeeSummaryDto>('/hr/employees/me/summary');
      } catch (error) {
        // The link was removed after sign-in: the same answer as no link at all.
        if (error instanceof ApiError && error.status === 404) return null;
        throw error;
      }
    },
    enabled: hasEmployee,
    staleTime: 5 * 60_000,
  });
};

/** The signed-in person's photo as an object URL, or null while there is none. */
export const useMyPhotoUrl = (): { url: string | null; loading: boolean } => {
  const summary = useMyEmployeeSummary();
  const has = summary.data?.hasPhoto === true;
  return useAuthedImage(
    has ? '/hr/employees/me/photo' : null,
    myPhotoKey(summary.data?.employeeId ?? null),
  );
};
