// The employee's face at the head of their profile, and — for HR — the way to set it.
//
// Everyone who can open the profile sees the photo (or the initial). Holding
// `employee.editPersonal` adds the camera button on its edge, which opens one dialog for every
// change: the current photo large, «اختيار صورة» (the camera or the gallery on a phone, the file
// dialog on a computer), a preview of what was picked before anything is saved, and «إزالة الصورة»
// when there is one to remove.
import { useEffect, useState } from 'react';
import { type EmployeeDto } from '@ecms/contracts';
import { useT } from '../../../../../platform/localization/useT';
import { Can } from '../../../../../platform/rbac/Can';
import { Button } from '../../../../../shared/ui/Button';
import { Dialog } from '../../../../../shared/ui/Dialog';
import { Portrait } from '../../../../../shared/ui/Portrait';
import { PhotoPickButton } from '../../../../../shared/ui/PhotoPick';
import { CameraIcon } from '../../../../../shared/ui/icons';
import { ApiError } from '../../../../../shared/lib/api-client';
import { toast } from '../../../../../shared/ui/toast/toast-store';
import {
  EMPLOYEE_PHOTO_ACCEPT,
  EMPLOYEE_PHOTO_MAX_MB,
  useEmployeePhotoUrl,
  useRemoveEmployeePhoto,
  useSetEmployeePhoto,
} from '../api/employee-photo';

const PhotoDialog = ({
  employee,
  currentUrl,
  open,
  onClose,
}: {
  employee: EmployeeDto;
  currentUrl: string | null;
  open: boolean;
  onClose: () => void;
}): JSX.Element => {
  const t = useT();
  const save = useSetEmployeePhoto(employee.id);
  const remove = useRemoveEmployeePhoto(employee.id);
  const [picked, setPicked] = useState<File | null>(null);
  const [pickedUrl, setPickedUrl] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    if (picked === null) {
      setPickedUrl(null);
      return undefined;
    }
    const url = URL.createObjectURL(picked);
    setPickedUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [picked]);

  const close = (): void => {
    setPicked(null);
    setLocalError(null);
    save.reset();
    remove.reset();
    onClose();
  };

  const choose = (file: File): void => {
    // Said here, before an upload that would only be refused: the server enforces the same.
    if (!EMPLOYEE_PHOTO_ACCEPT.split(',').includes(file.type)) {
      setLocalError(t('employees.photo.wrongType'));
      return;
    }
    if (file.size > EMPLOYEE_PHOTO_MAX_MB * 1024 * 1024) {
      setLocalError(t('employees.photo.tooLarge', { mb: EMPLOYEE_PHOTO_MAX_MB }));
      return;
    }
    setLocalError(null);
    setPicked(file);
  };

  const failure = save.error ?? remove.error;
  const message =
    localError ??
    (failure instanceof ApiError ? failure.message : failure === null ? null : t('common.error'));
  const shown = pickedUrl ?? currentUrl;
  const busy = save.isPending || remove.isPending;

  return (
    <Dialog
      open={open}
      onClose={close}
      title={t('employees.photo.title')}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={close} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button
            disabled={picked === null}
            loading={save.isPending}
            onClick={() => {
              if (picked === null) return;
              save.mutate(picked, {
                onSuccess: () => {
                  toast.success(t('employees.photo.saved'));
                  close();
                },
              });
            }}
          >
            {t('employees.photo.save')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col items-center gap-4 py-2">
        <Portrait
          url={shown}
          name={employee.personal.fullNameAr}
          className="h-40 w-40 text-6xl ring-4 ring-slate-100 dark:ring-slate-800"
        />
        <p className="text-center text-xs text-slate-500 dark:text-slate-400">
          {t('employees.photo.hint', { mb: EMPLOYEE_PHOTO_MAX_MB })}
        </p>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <PhotoPickButton
            accept={EMPLOYEE_PHOTO_ACCEPT}
            onFile={choose}
            disabled={busy}
            label={t('employees.photo.choose')}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
          >
            <CameraIcon className="h-4 w-4" />
            {t(
              currentUrl === null && picked === null
                ? 'employees.photo.choose'
                : 'employees.photo.change',
            )}
          </PhotoPickButton>
          {employee.personal.photoFileId !== null && picked === null && (
            <Button
              size="sm"
              variant="ghost-danger"
              loading={remove.isPending}
              disabled={save.isPending}
              onClick={() =>
                remove.mutate(undefined, {
                  onSuccess: () => {
                    toast.success(t('employees.photo.removed'));
                    close();
                  },
                })
              }
            >
              {t('employees.photo.remove')}
            </Button>
          )}
        </div>
        {message !== null && (
          <p role="alert" className="text-center text-sm text-red-600 dark:text-red-400">
            {message}
          </p>
        )}
      </div>
    </Dialog>
  );
};

export const EmployeePhoto = ({ employee }: { employee: EmployeeDto }): JSX.Element => {
  const t = useT();
  const photo = useEmployeePhotoUrl(employee.id, employee.personal.photoFileId);
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-flex shrink-0">
      <Portrait
        url={photo.url}
        name={employee.personal.fullNameAr}
        size="lg"
        className="ring-2 ring-white shadow-card dark:ring-slate-900"
      />
      <Can permission="employee.editPersonal">
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label={t('employees.photo.title')}
          title={t('employees.photo.title')}
          className="absolute -bottom-1 -end-1 grid h-8 w-8 place-items-center rounded-full border-2 border-white bg-brand-600 text-white shadow hover:bg-brand-700 dark:border-slate-900"
        >
          <CameraIcon className="h-4 w-4" />
        </button>
        <PhotoDialog
          employee={employee}
          currentUrl={photo.url}
          open={open}
          onClose={() => setOpen(false)}
        />
      </Can>
    </span>
  );
};
