// A folder, made or changed by the responsible person: its name, the picture on its front, and who
// in the company sees it — «يسمى الفولدرات دي ويغير تسميتهم ويقدر يرفع الصورة اللى على كل فولدر
// بنفسه أو يغيرها ويحدد مين من الشركة ليه الأحقية أنه يشوف الفولدر دا».
//
// One dialog for the three, saved as up to three calls in turn: the folder's name and list, then
// its picture (set or taken off). Each call answers the folder's new version, which the next one
// carries, so the three never race one another. A refusal stops the chain where it happened and is
// said in the alert box; what was saved before it stays saved.
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  COMPLIANCE_COVER_MAX_MB,
  COMPLIANCE_COVER_MIMES,
  ErrorCodes,
  type ComplianceFolderDto,
  type CompliancePersonDto,
  type Locale,
} from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useAppSelector } from '../../../store';
import { ApiError } from '../../../shared/lib/api-client';
import { errorMessage } from '../../../shared/lib/errors';
import { Button } from '../../../shared/ui/Button';
import { Field, Input } from '../../../shared/ui/form';
import { FolderIcon, ImageIcon, TrashIcon, UploadIcon } from '../../../shared/ui/icons';
import { useRequiredFields } from '../../../shared/ui/required-fields';
import { toast } from '../../../shared/ui/toast/toast-store';
import {
  useCreateFolder,
  useRemoveFolderCover,
  useSetFolderCover,
  useUpdateFolder,
} from '../api/compliance-queries';
import { COMPLIANCE_NAME_MAX, folderChanges } from '../lib/folder-form';
import { ComplianceDialogFrame } from './ComplianceDialogFrame';
import { FolderCover } from './file-bits';
import { FolderShell } from './folder-shell';
import { PeoplePicker } from './PeoplePicker';

/** What the picture box holds: the folder's own, a new file, or nothing (taken off). */
type CoverChoice = { kind: 'keep' } | { kind: 'new'; file: File; url: string } | { kind: 'none' };

export const FolderFormDialog = ({
  open,
  onClose,
  folder,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  /** null → a new folder. */
  folder: ComplianceFolderDto | null;
  onSaved?: (folder: ComplianceFolderDto) => void;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const [name, setName] = useState('');
  const [viewers, setViewers] = useState<CompliancePersonDto[]>([]);
  const [cover, setCover] = useState<CoverChoice>({ kind: 'keep' });
  const [failure, setFailure] = useState<unknown>(null);
  const [coverProblem, setCoverProblem] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setName(folder?.name ?? '');
    setViewers(folder?.viewers ?? []);
    setCover({ kind: 'keep' });
    setFailure(null);
    setCoverProblem(null);
  }, [open, folder]);
  // A picked picture's preview is an object URL; released when it is replaced or the dialog goes.
  useEffect(
    () => () => {
      if (cover.kind === 'new') URL.revokeObjectURL(cover.url);
    },
    [cover],
  );

  const create = useCreateFolder();
  const update = useUpdateFolder();
  const setPicture = useSetFolderCover();
  const takeOff = useRemoveFolderCover();
  const busy = create.isPending || update.isPending || setPicture.isPending || takeOff.isPending;

  const required = useRequiredFields(
    [{ key: 'name', label: t('compliance.folderForm.name'), ok: name.trim() !== '' }],
    open,
  );
  const nameTaken =
    failure instanceof ApiError && failure.code === ErrorCodes.COMPLIANCE_FOLDER_NAME_TAKEN;

  const pick = (file: File | undefined): void => {
    if (input.current !== null) input.current.value = '';
    if (file === undefined) return;
    if (!(COMPLIANCE_COVER_MIMES as readonly string[]).includes(file.type)) {
      setCoverProblem(t('compliance.folderForm.coverWrongType'));
      return;
    }
    if (file.size > COMPLIANCE_COVER_MAX_MB * 1024 * 1024) {
      setCoverProblem(t('compliance.folderForm.coverTooLarge', { size: COMPLIANCE_COVER_MAX_MB }));
      return;
    }
    setCoverProblem(null);
    setCover({ kind: 'new', file, url: URL.createObjectURL(file) });
  };

  const hasPicture = cover.kind === 'new' || (cover.kind === 'keep' && folder?.hasCover === true);

  const save = async (): Promise<void> => {
    setFailure(null);
    try {
      const ids = viewers.map((person) => person.userId);
      let saved: ComplianceFolderDto;
      if (folder === null) {
        saved = await create.mutateAsync({ name: name.trim(), viewerUserIds: ids });
      } else {
        const changes = folderChanges(folder, name, ids);
        saved =
          changes === null
            ? folder
            : await update.mutateAsync({
                id: folder.id,
                body: { ...changes, version: folder.version },
              });
      }
      if (cover.kind === 'new') {
        saved = await setPicture.mutateAsync({
          id: saved.id,
          file: cover.file,
          version: saved.version,
        });
      } else if (cover.kind === 'none' && saved.hasCover) {
        saved = await takeOff.mutateAsync({ id: saved.id, version: saved.version });
      }
      toast.success(
        t(folder === null ? 'compliance.folderForm.created' : 'compliance.folderForm.updated'),
      );
      onSaved?.(saved);
      onClose();
    } catch (error) {
      setFailure(error);
    }
  };

  const preview = useMemo(() => {
    const fallback = <FolderIcon className="h-7 w-7 text-white/80" />;
    if (cover.kind === 'new') {
      return <img src={cover.url} alt="" className="h-full w-full object-cover" />;
    }
    if (cover.kind === 'keep' && folder !== null && folder.hasCover) {
      return (
        <FolderCover
          folderId={folder.id}
          version={folder.coverVersion}
          alt=""
          fallback={fallback}
        />
      );
    }
    return fallback;
  }, [cover, folder]);

  return (
    <ComplianceDialogFrame
      open={open}
      onClose={onClose}
      size="lg"
      tall
      title={t(
        folder === null ? 'compliance.folderForm.addTitle' : 'compliance.folderForm.editTitle',
      )}
      {...(folder === null ? {} : { description: folder.name })}
      required={required}
      onSave={save}
      busy={busy}
      error={failure === null ? null : errorMessage(failure, locale)}
    >
      <div className="grid gap-5 sm:grid-cols-[minmax(0,1fr)_170px]">
        <div className="space-y-4">
          <Field
            label={t('compliance.folderForm.name')}
            required
            missing={required.isMissing('name')}
            error={nameTaken ? t('compliance.folderForm.nameTaken') : undefined}
          >
            <Input
              value={name}
              maxLength={COMPLIANCE_NAME_MAX}
              onChange={(event) => setName(event.target.value)}
              placeholder={t('compliance.folderForm.namePlaceholder')}
            />
          </Field>
          <Field
            label={t('compliance.folderForm.viewers')}
            hint={t('compliance.folderForm.viewersHint')}
          >
            <PeoplePicker value={viewers} onChange={setViewers} />
          </Field>
        </div>

        <Field label={t('compliance.folderForm.cover')} error={coverProblem ?? undefined}>
          <div className="flex flex-col items-center gap-2">
            <FolderShell
              size="sm"
              face={
                <span className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-full bg-white/15 ring-2 ring-white/70">
                  {preview}
                </span>
              }
            />
            <input
              ref={input}
              type="file"
              accept={COMPLIANCE_COVER_MIMES.join(',')}
              className="hidden"
              onChange={(event) => pick(event.target.files?.[0])}
            />
            <Button size="sm" variant="secondary" onClick={() => input.current?.click()}>
              {hasPicture ? <ImageIcon className="h-4 w-4" /> : <UploadIcon className="h-4 w-4" />}
              {t(
                hasPicture ? 'compliance.folderForm.coverChange' : 'compliance.folderForm.coverAdd',
              )}
            </Button>
            {hasPicture && (
              <Button size="sm" variant="ghost-danger" onClick={() => setCover({ kind: 'none' })}>
                <TrashIcon className="h-4 w-4" />
                {t('compliance.folderForm.coverRemove')}
              </Button>
            )}
            <p className="text-center text-xs text-slate-500 dark:text-slate-400">
              {t('compliance.folderForm.coverHint', { size: COMPLIANCE_COVER_MAX_MB })}
            </p>
          </div>
        </Field>
      </div>
    </ComplianceDialogFrame>
  );
};
