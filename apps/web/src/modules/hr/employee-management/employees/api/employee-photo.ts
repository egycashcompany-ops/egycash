// The employee's photo: read it, set it, remove it.
//
// «عايز تضيف فى بروفايل كل شخص صورة شخصية ليه .. ويقدر الـ HR يضيفهاله». The picture is private —
// it reaches an `<img>` through `useAuthedImage` — and writing it takes `employee.editPersonal`,
// the permission that already edits the rest of the person's own data.
//
// Every write answers with the whole employee, so the profile updates from the response; the
// person's own welcome page and top bar refresh too, when the face changed is the signed-in one's.
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  EMPLOYEE_PHOTO_MAX_MB,
  EMPLOYEE_PHOTO_MIME_TYPES,
  type EmployeeDto,
} from '@ecms/contracts';
import { api, upload } from '../../../../../shared/lib/api-client';
import { useAuthedImage } from '../../../../../shared/lib/authed-image';
import { detailKey } from '../../../../../shared/lib/query-keys';
import { MY_SUMMARY_KEY, myPhotoKey } from '../../../../../platform/home/home-api';

const MODULE = 'hr';
const FEATURE = 'employees';

/** Keyed on the file id: a new photo is a new key, so no stale picture survives a change. */
export const employeePhotoKey = (id: string, photoFileId: string | null): readonly unknown[] => [
  MODULE,
  FEATURE,
  id,
  'photo',
  photoFileId,
];

/** What a photo upload accepts — the server's own rule, checked here before an upload it would refuse. */
export const EMPLOYEE_PHOTO_ACCEPT = EMPLOYEE_PHOTO_MIME_TYPES.join(',');
export { EMPLOYEE_PHOTO_MAX_MB };

export const useEmployeePhotoUrl = (
  id: string,
  photoFileId: string | null,
): { url: string | null; loading: boolean } =>
  useAuthedImage(
    photoFileId === null ? null : `/hr/employees/${id}/photo`,
    employeePhotoKey(id, photoFileId),
  );

const useAfterPhotoWrite = (id: string) => {
  const qc = useQueryClient();
  return (updated: EmployeeDto): void => {
    qc.setQueryData(detailKey(MODULE, FEATURE, id), updated);
    void qc.invalidateQueries({ queryKey: [MODULE, FEATURE, 'timeline', id] });
    void qc.invalidateQueries({ queryKey: MY_SUMMARY_KEY });
    // The signed-in person's own face, should it be theirs that changed — keyed by person, not file.
    void qc.invalidateQueries({ queryKey: myPhotoKey(null).slice(0, 4) });
  };
};

export const useSetEmployeePhoto = (id: string) => {
  const after = useAfterPhotoWrite(id);
  return useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append('file', file);
      return upload<EmployeeDto>(`/hr/employees/${id}/photo`, form);
    },
    onSuccess: after,
  });
};

export const useRemoveEmployeePhoto = (id: string) => {
  const after = useAfterPhotoWrite(id);
  return useMutation({
    mutationFn: () => api<EmployeeDto>(`/hr/employees/${id}/photo`, { method: 'DELETE' }),
    onSuccess: after,
  });
};
