// Add or edit a platform.
//
// `key` is settable only at creation: it is what code and seeds refer to a source by, and what
// already-registered applicants were filed under. Renaming the display name is free; renaming the
// key would silently detach history from the platform it belongs to.
import { useEffect, useState } from 'react';
import {
  APPLICANT_SOURCE_KINDS,
  type ApplicantSourceDto,
  type ApplicantSourceKind,
  type Locale,
} from '@ecms/contracts';
import { useT } from '../../../../../platform/localization/useT';
import { useAppSelector } from '../../../../../store';
import { Button } from '../../../../../shared/ui/Button';
import { Dialog } from '../../../../../shared/ui/Dialog';
import { Checkbox, Field, Input, Select } from '../../../../../shared/ui/form';
import { FileUpload } from '../../../../../shared/ui/FileUpload';
import { toast } from '../../../../../shared/ui/toast/toast-store';
import {
  useCreateApplicantSource,
  useUpdateApplicantSource,
  useUploadSourceIcon,
} from '../api/applicant-source-queries';
import { SourceIcon } from './SourceIcon';

export type Editing = { mode: 'create' } | { mode: 'edit'; source: ApplicantSourceDto };

export const SourceDialog = ({
  editing,
  onClose,
}: {
  editing: Editing;
  onClose: () => void;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const create = useCreateApplicantSource();
  const update = useUpdateApplicantSource();
  const uploadIcon = useUploadSourceIcon();
  const source = editing.mode === 'edit' ? editing.source : null;
  const [icon, setIcon] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  // A picked file has no URL until one is minted for it, and a minted URL holds the blob alive
  // until it is revoked — so the object URL is created and released with the selection.
  useEffect(() => {
    if (icon === null) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(icon);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [icon]);

  const [key, setKey] = useState(source?.key ?? '');
  const [nameAr, setNameAr] = useState(source?.name.ar ?? '');
  const [nameEn, setNameEn] = useState(source?.name.en ?? '');
  const [kind, setKind] = useState<ApplicantSourceKind>(source?.kind ?? 'publicForm');
  const [requiresDetail, setRequiresDetail] = useState(source?.requiresDetail ?? false);
  const pending = create.isPending || update.isPending || uploadIcon.isPending;

  // The key format the server enforces; checked here so the dialog says so before the round trip.
  const keyOk = /^[a-z][a-zA-Z0-9.]{1,49}$/.test(key);
  const valid = nameAr.trim() !== '' && nameEn.trim() !== '' && (source !== null || keyOk);

  const submit = async (): Promise<void> => {
    try {
      // The icon is uploaded AFTER the source exists, because the file is filed against that
      // source's id in the Files service. On create there is no id until the first call returns,
      // so the order is not a preference — it is the only order that can work.
      const saved =
        source === null
          ? await create.mutateAsync({
              key,
              name: { ar: nameAr.trim(), en: nameEn.trim() },
              kind,
              requiresDetail,
            })
          : await update.mutateAsync({
              id: source.id,
              body: {
                name: { ar: nameAr.trim(), en: nameEn.trim() },
                kind,
                requiresDetail,
                version: source.version,
              },
            });
      if (icon !== null) await uploadIcon.mutateAsync({ source: saved, file: icon });
      toast.success(t(source === null ? 'sources.created' : 'sources.updated'));
      onClose();
    } catch {
      // surfaced globally
    }
  };

  const clearIcon = async (): Promise<void> => {
    if (source === null) return;
    try {
      await update.mutateAsync({ id: source.id, body: { iconFileId: null, version: source.version } });
      toast.success(t('sources.icon.cleared'));
      onClose();
    } catch {
      // surfaced globally
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={t(source === null ? 'sources.add' : 'sources.edit')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button>
          <Button loading={pending} disabled={!valid} onClick={() => void submit()}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {source === null && (
          <Field label={t('sources.key')} hint={t('sources.keyHint')} required>
            <Input value={key} onChange={(e) => setKey(e.target.value)} dir="ltr" maxLength={50} />
          </Field>
        )}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label={`${t('sources.name')} (ع)`} required>
            <Input value={nameAr} onChange={(e) => setNameAr(e.target.value)} maxLength={100} />
          </Field>
          <Field label={`${t('sources.name')} (EN)`} required>
            <Input value={nameEn} onChange={(e) => setNameEn(e.target.value)} dir="ltr" maxLength={100} />
          </Field>
        </div>
        <Field label={t('sources.kind')} hint={t('sources.kindHint')}>
          <Select value={kind} onChange={(e) => setKind(e.target.value as ApplicantSourceKind)}>
            {APPLICANT_SOURCE_KINDS.map((k) => (
              <option key={k} value={k}>{t(`sources.kind.${k}`)}</option>
            ))}
          </Select>
        </Field>
        <Checkbox
          label={t('sources.requiresDetail')}
          checked={requiresDetail}
          onChange={(e) => setRequiresDetail(e.target.checked)}
        />
        <Field label={t('sources.icon')} hint={t('sources.iconHint')}>
          <div className="space-y-3">
            {/* The preview answers "what will this look like" BEFORE saving: the picked file if
                there is one, the stored icon otherwise, and the default mark when there is
                neither — so the empty state is shown as what it is rather than as a blank box. */}
            <div className="flex items-center gap-3">
              <span className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800">
                {preview !== null ? (
                  <img src={preview} alt={t('sources.icon.preview')} className="h-full w-full object-contain" />
                ) : source !== null ? (
                  <SourceIcon source={source} locale={locale} size="lg" />
                ) : (
                  <SourceIcon source={{ iconFileId: null, name: { ar: '', en: '' } }} locale={locale} size="lg" />
                )}
              </span>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {t(
                  preview !== null
                    ? 'sources.icon.pending'
                    : source?.iconFileId != null
                      ? 'sources.icon.current'
                      : 'sources.icon.default',
                )}
              </p>
              {icon !== null && (
                <Button size="sm" variant="ghost" onClick={() => setIcon(null)}>
                  {t('common.cancel')}
                </Button>
              )}
              {source !== null && source.iconFileId !== null && icon === null && (
                <Button size="sm" variant="ghost" loading={pending} onClick={() => void clearIcon()}>
                  {t('sources.icon.remove')}
                </Button>
              )}
            </div>
            {/* The shared picker — same drag-and-drop, same size guard, same look as every other
                upload in ECMS. */}
            <FileUpload
              accept="image/png,image/svg+xml"
              maxSizeMb={2}
              onFiles={(files) => setIcon(files[0] ?? null)}
            />
          </div>
        </Field>
      </div>
    </Dialog>
  );
};
