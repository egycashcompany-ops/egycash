// A folder, made or changed by the responsible person: its name, the picture on its front, and who
// in the company sees it — «يسمى الفولدرات دي ويغير تسميتهم ويقدر يرفع الصورة اللى على كل فولدر
// بنفسه أو يغيرها ويحدد مين من الشركة ليه الأحقية أنه يشوف الفولدر دا».
//
// One dialog for the three, saved as up to three calls in turn: the folder's name and list, then
// its picture (set or taken off). Each call answers the folder's new version, which the next one
// carries, so the three never race one another. A refusal stops the chain where it happened and is
// said in the alert box; what was saved before it stays saved.
import { useEffect, useMemo, useState } from 'react';
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
import { PhotoPickButton } from '../../../shared/ui/PhotoPick';
import { Field, Input } from '../../../shared/ui/form';
import { FolderIcon, ImageIcon, TrashIcon, UploadIcon } from '../../../shared/ui/icons';
import { getFolder } from '../api/compliance-api';
import { useRequiredFields } from '../../../shared/ui/required-fields';
import { toast } from '../../../shared/ui/toast/toast-store';
import {
  useCreateFolder,
  useRemoveFolderCover,
  useSetFolderCover,
  useUpdateFolder,
} from '../api/compliance-queries';
import { COMPLIANCE_NAME_MAX, carryFolderEdits, folderChanges } from '../lib/folder-form';
import { ComplianceDialogFrame } from './ComplianceDialogFrame';
import { FolderCover } from './file-bits';
import { FolderShell } from './folder-shell';
import { PeoplePicker } from './PeoplePicker';

const isStale = (error: unknown): boolean =>
  error instanceof ApiError && error.code === ErrorCodes.STALE_DOCUMENT;

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
  /**
   * The folder as the server last answered it — what the next save writes against. It starts as
   * the folder opened (null for a new one), and moves with every step that lands: so a retry after
   * a step was refused continues from what was saved (a new folder created before its picture was
   * refused is not created twice), and a save refused because someone saved the folder meanwhile
   * (`STALE_DOCUMENT`) is rebased on the folder as it now is, keeping what was typed — the way
   * Administrative Affairs' dialogs rebase.
   */
  const [base, setBase] = useState<ComplianceFolderDto | null>(folder);

  useEffect(() => {
    if (!open) return;
    setBase(folder);
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

  const pick = (file: File): void => {
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

  const hasPicture = cover.kind === 'new' || (cover.kind === 'keep' && base?.hasCover === true);

  const save = async (): Promise<void> => {
    setFailure(null);
    // The folder the person's edits are measured against: what the form showed before this save.
    const opened = base;
    try {
      const ids = viewers.map((person) => person.userId);
      let saved: ComplianceFolderDto;
      if (base === null) {
        saved = await create.mutateAsync({ name: name.trim(), viewerUserIds: ids });
      } else {
        const changes = folderChanges(base, name, ids);
        saved =
          changes === null
            ? base
            : await update.mutateAsync({
                id: base.id,
                body: { ...changes, version: base.version },
              });
      }
      setBase(saved);
      if (cover.kind === 'new') {
        saved = await setPicture.mutateAsync({
          id: saved.id,
          file: cover.file,
          version: saved.version,
        });
        setBase(saved);
        setCover({ kind: 'keep' });
      } else if (cover.kind === 'none' && saved.hasCover) {
        saved = await takeOff.mutateAsync({ id: saved.id, version: saved.version });
        setBase(saved);
        setCover({ kind: 'keep' });
      }
      toast.success(
        t(folder === null ? 'compliance.folderForm.created' : 'compliance.folderForm.updated'),
      );
      onSaved?.(saved);
      onClose();
    } catch (error) {
      setFailure(error);
      if (isStale(error) && opened !== null) {
        const fresh = await getFolder(opened.id).catch(() => null);
        if (fresh !== null) {
          // Someone saved the folder meanwhile. Keep only what THIS person changed, on top of the
          // folder as it now is — so the next Save never quietly undoes their change, nor gives
          // back access they took away.
          const carried = carryFolderEdits(opened, { name, viewers }, fresh);
          setName(carried.name);
          setViewers(carried.viewers);
          setBase(fresh);
        }
      }
    }
  };

  const preview = useMemo(() => {
    const fallback = <FolderIcon className="h-7 w-7 text-white/80" />;
    if (cover.kind === 'new') {
      return <img src={cover.url} alt="" className="h-full w-full object-cover" />;
    }
    if (cover.kind === 'keep' && base !== null && base.hasCover) {
      return (
        <FolderCover folderId={base.id} version={base.coverVersion} alt="" fallback={fallback} />
      );
    }
    return fallback;
  }, [cover, base]);

  return (
    <ComplianceDialogFrame
      open={open}
      onClose={onClose}
      size="lg"
      tall
      title={t(
        base === null ? 'compliance.folderForm.addTitle' : 'compliance.folderForm.editTitle',
      )}
      {...(base === null ? {} : { description: base.name })}
      required={required}
      onSave={save}
      busy={busy}
      error={failure === null ? null : errorMessage(failure, locale)}
    >
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_170px]">
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

        <Field
          label={t('compliance.folderForm.cover')}
          hint={t('compliance.folderForm.coverHint', { size: COMPLIANCE_COVER_MAX_MB })}
          error={coverProblem ?? undefined}
        >
          <div className="flex flex-col items-center gap-2">
            <FolderShell
              size="sm"
              face={
                <span className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-full bg-white/15 ring-2 ring-white/70">
                  {preview}
                </span>
              }
            />
            <PhotoPickButton
              accept={COMPLIANCE_COVER_MIMES.join(',')}
              onFile={pick}
              disabled={busy}
              label={t(
                hasPicture ? 'compliance.folderForm.coverChange' : 'compliance.folderForm.coverAdd',
              )}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
            >
              {hasPicture ? <ImageIcon className="h-4 w-4" /> : <UploadIcon className="h-4 w-4" />}
              {t(
                hasPicture ? 'compliance.folderForm.coverChange' : 'compliance.folderForm.coverAdd',
              )}
            </PhotoPickButton>
            {hasPicture && (
              <Button size="sm" variant="ghost-danger" onClick={() => setCover({ kind: 'none' })}>
                <TrashIcon className="h-4 w-4" />
                {t('compliance.folderForm.coverRemove')}
              </Button>
            )}
          </div>
        </Field>
      </div>
    </ComplianceDialogFrame>
  );
};
