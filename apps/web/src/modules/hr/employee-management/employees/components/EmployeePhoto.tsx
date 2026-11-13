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
import { CameraIcon, TrashIcon } from '../../../../../shared/ui/icons';
import { PHOTO_ASPECT } from '../id-card/card-render';
import { ApiError } from '../../../../../shared/lib/api-client';
import { errorMessage } from '../../../../../shared/lib/errors';
import { useAppSelector } from '../../../../../store';
import { toast } from '../../../../../shared/ui/toast/toast-store';
import {
  EMPLOYEE_PHOTO_ACCEPT,
  EMPLOYEE_PHOTO_MAX_MB,
  useEmployeePhotoUrl,
  useRemoveEmployeePhoto,
  useSetEmployeePhoto,
} from '../api/employee-photo';
import { A4FaceCropDialog } from '../face-crop/A4FaceCropDialog';
import { SHEET_MAX_MB, cropToFile, isPdf, locateFace } from '../face-crop/a4-face';

/** The picker takes a photo, or an A4 sheet (a PDF or a scan) to cut the face from. */
const PICK_ACCEPT = `${EMPLOYEE_PHOTO_ACCEPT},application/pdf`;

/**
 * The face, cut out automatically: the file (a photo, a PDF, a scanned A4) is drawn, the face is
 * found, and the card-shaped head-and-shoulders crop around it comes back as the photo to save.
 * Null when no face is found or the file cannot be read — the caller decides what then.
 */
const autoCrop = async (file: File): Promise<File | null> => {
  try {
    const { sheet, crop } = await locateFace(file);
    return crop === null ? null : await cropToFile(sheet, crop, file.name);
  } catch {
    return null;
  }
};

/**
 * The whole photo, uncropped, with the part the company ID card shows marked on it: the card fills
 * its portrait frame from the photo's centre, so HR sees at once whether the face will fit.
 */
export const PhotoWithCardCrop = ({
  url,
  label,
  action,
}: {
  url: string;
  label: string;
  /** A control on the photo's corner — the delete button. */
  action?: React.ReactNode;
}): JSX.Element => {
  const [crop, setCrop] = useState<{ w: number; h: number } | null>(null);
  return (
    <div className="flex w-full justify-center rounded-xl bg-slate-100 p-3 dark:bg-slate-800/70">
      <div className="relative inline-block overflow-hidden rounded-lg shadow-card">
        <img
          src={url}
          alt=""
          className="block max-h-72 max-w-full"
          onLoad={(e) => {
            const ratio = e.currentTarget.naturalWidth / e.currentTarget.naturalHeight;
            // In percent of the shown photo: the frame's width or height, whichever the photo overflows.
            setCrop(
              ratio > PHOTO_ASPECT
                ? { w: (PHOTO_ASPECT / ratio) * 100, h: 100 }
                : { w: 100, h: (ratio / PHOTO_ASPECT) * 100 },
            );
          }}
        />
        {crop !== null && (crop.w < 99.5 || crop.h < 99.5) && (
          <div
            aria-hidden
            className="pointer-events-none absolute rounded-sm border-2 border-dashed border-white shadow-[0_0_0_9999px_rgba(15,23,42,0.45)]"
            style={{
              width: `${String(crop.w)}%`,
              height: `${String(crop.h)}%`,
              left: `${String((100 - crop.w) / 2)}%`,
              top: `${String((100 - crop.h) / 2)}%`,
            }}
          />
        )}
        {action !== undefined && <div className="absolute end-2 top-2">{action}</div>}
        {/* Said only when there is a frame to point at: an auto-cut photo is the card's shape already. */}
        {crop !== null && (crop.w < 99.5 || crop.h < 99.5) && (
          <span className="pointer-events-none absolute inset-x-0 bottom-0 bg-slate-900/60 px-2 py-1 text-center text-[11px] font-medium text-white">
            {label}
          </span>
        )}
      </div>
    </div>
  );
};

export const PhotoDialog = ({
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
  const locale = useAppSelector((state) => state.locale.locale);
  const save = useSetEmployeePhoto(employee.id);
  const remove = useRemoveEmployeePhoto(employee.id);
  const [picked, setPicked] = useState<File | null>(null);
  const [pickedUrl, setPickedUrl] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  // «حذف الصورة؟» asked on the photo itself before a saved photo is removed.
  const [askRemove, setAskRemove] = useState(false);
  // An A4 sheet (PDF or scan) being cut: the crop dialog is open on it.
  const [sheet, setSheet] = useState<File | null>(null);
  // The file the picked photo was cut from automatically — kept so the crop can still be adjusted.
  const [source, setSource] = useState<File | null>(null);
  const [cropping, setCropping] = useState(false);

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
    setAskRemove(false);
    setSheet(null);
    setSource(null);
    setLocalError(null);
    save.reset();
    remove.reset();
    onClose();
  };

  /** A photo ready to save: checked against the server's own rules first. */
  const take = (file: File): void => {
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
    // A refusal of the PREVIOUS pick does not describe this one.
    save.reset();
    remove.reset();
    setPicked(file);
  };

  /**
   * What was picked: a PDF, or a picture shaped like a page (a scanned A4), opens the face crop;
   * anything else is the photo itself. The sheet is read here only — the crop is what is uploaded.
   */
  const choose = async (file: File): Promise<void> => {
    const pdf = isPdf(file);
    if (!pdf && !EMPLOYEE_PHOTO_ACCEPT.split(',').includes(file.type)) {
      setLocalError(t('employees.photo.wrongType'));
      return;
    }
    if (file.size > SHEET_MAX_MB * 1024 * 1024) {
      setLocalError(t('employees.photo.tooLarge', { mb: SHEET_MAX_MB }));
      return;
    }
    // AUTOMATIC: every photo, PDF or scanned page has its face found and cut out in the card's
    // shape — nobody crops by hand. Only when no face is found does HR place the frame themself.
    setLocalError(null);
    setSource(null);
    setCropping(true);
    const face = await autoCrop(file);
    setCropping(false);
    if (face !== null) {
      take(face);
      setSource(file);
      return;
    }
    if (pdf) {
      setSheet(file);
      return;
    }
    // A photo with no face found is kept as it is (the ordinary rules decide), and can be cropped.
    take(file);
    setSource(file);
  };

  const failure = save.error ?? remove.error;
  // The server's refusals, said in the page's language: its two photo rules by their own words,
  // anything else as the app says every error.
  const detail = failure instanceof ApiError ? failure.details?.[0]?.code : undefined;
  const message =
    localError ??
    (failure === null
      ? null
      : detail === 'UNSUPPORTED_MEDIA_TYPE'
        ? t('employees.photo.wrongType')
        : detail === 'TOO_LARGE'
          ? t('employees.photo.tooLarge', { mb: EMPLOYEE_PHOTO_MAX_MB })
          : errorMessage(failure, locale));
  const pickLabel = t(
    currentUrl === null && picked === null ? 'employees.photo.choose' : 'employees.photo.change',
  );
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
            disabled={picked === null || cropping}
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
        {shown === null ? (
          <Portrait
            url={null}
            name={employee.personal.fullNameAr}
            className="h-40 w-40 text-6xl ring-4 ring-slate-100 dark:ring-slate-800"
          />
        ) : (
          <PhotoWithCardCrop
            url={shown}
            label={t('employees.photo.cardCrop')}
            action={
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  // A photo just picked and not saved is only dropped; a saved one is asked about first.
                  if (picked !== null) {
                    setPicked(null);
                    setLocalError(null);
                    save.reset();
                  } else {
                    setAskRemove(true);
                  }
                }}
                aria-label={t(
                  picked !== null ? 'employees.photo.discard' : 'employees.photo.remove',
                )}
                title={t(picked !== null ? 'employees.photo.discard' : 'employees.photo.remove')}
                className="grid h-9 w-9 place-items-center rounded-full bg-white/95 text-red-600 shadow-md ring-1 ring-black/5 transition hover:scale-105 hover:bg-red-600 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 disabled:opacity-50 dark:bg-slate-900/90 dark:text-red-400"
              >
                <TrashIcon className="h-4 w-4" />
              </button>
            }
          />
        )}
        {askRemove && picked === null && employee.personal.photoFileId !== null && (
          <div
            role="alertdialog"
            className="flex w-full flex-wrap items-center justify-between gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200"
          >
            <span>{t('employees.photo.removeQuestion')}</span>
            <span className="flex gap-2">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setAskRemove(false)}
                disabled={remove.isPending}
              >
                {t('common.cancel')}
              </Button>
              <Button
                size="sm"
                variant="danger"
                loading={remove.isPending}
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
            </span>
          </div>
        )}
        {cropping ? (
          <p
            role="status"
            className="flex items-center gap-2 text-sm font-medium text-brand-700 dark:text-brand-300"
          >
            <span
              className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
              aria-hidden
            />
            {t('employees.photo.a4.auto')}
          </p>
        ) : picked !== null && source !== null && picked !== source ? (
          <p
            role="status"
            className="text-center text-sm font-medium text-emerald-700 dark:text-emerald-300"
          >
            {t('employees.photo.a4.autoDone')}
          </p>
        ) : (
          <p className="text-center text-xs text-slate-500 dark:text-slate-400">
            {t('employees.photo.hint', { mb: EMPLOYEE_PHOTO_MAX_MB })}
          </p>
        )}
        <div className="flex flex-wrap items-center justify-center gap-2">
          <PhotoPickButton
            accept={PICK_ACCEPT}
            camera={false}
            onFile={(file) => void choose(file)}
            disabled={busy || cropping}
            label={pickLabel}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
          >
            <CameraIcon className="h-4 w-4" />
            {pickLabel}
          </PhotoPickButton>
          {picked !== null && source !== null && (
            <Button
              size="sm"
              variant="ghost"
              disabled={busy || cropping}
              onClick={() => setSheet(source)}
            >
              {t('employees.photo.a4.adjust')}
            </Button>
          )}
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
      <A4FaceCropDialog
        file={sheet}
        onClose={() => setSheet(null)}
        onCropped={(photo) => {
          setSheet(null);
          take(photo);
        }}
      />
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
