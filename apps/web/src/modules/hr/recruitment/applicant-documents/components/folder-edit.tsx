// HR fixing a folder from inside it: a clearer copy of a card side or a paper, a missing paper
// uploaded, a paper taken out. The folder tiles ask this context what they may offer; outside a
// folder dialog (or without the permission) there is no context and the tiles stay read-only.
import { createContext, useContext, useRef, useState, type ReactNode } from 'react';
import { useT } from '../../../../../platform/localization/useT';
import { useCan } from '../../../../../platform/rbac/Can';
import { Button } from '../../../../../shared/ui/Button';
import { Dialog } from '../../../../../shared/ui/Dialog';
import { toast } from '../../../../../shared/ui/toast/toast-store';
import { PlusIcon, TrashIcon, UploadIcon } from '../../../../../shared/ui/icons';
import { Field, Input, Select } from '../../../../../shared/ui/form';
import { useQueryClient } from '@tanstack/react-query';
import { useAppSelector } from '../../../../../store';
import { localized } from '../../../../../shared/lib/format';
import {
  useAddApplicantAttachment,
  useFileCategories,
  useRemoveApplicantAttachment,
} from '../../applicants/api/applicant-queries';
import {
  useApplicantDocumentSet,
  useStaffPutDocument,
  useStaffRemoveDocument,
  useStaffReplaceCard,
} from '../api/applicant-document-queries';

const ACCEPT = 'image/jpeg,image/png,image/webp,application/pdf';

interface FolderEdit {
  /** The paper slot a filed document belongs to, by file id. */
  typeIdOf: (fileId: string) => string | undefined;
  missing: { typeId: string; name: { ar: string; en: string }; required: boolean }[];
  canEdit: boolean;
  canRemove: boolean;
  putCard: (side: 'front' | 'back' | 'portrait', file: File) => Promise<void>;
  putDoc: (typeId: string, file: File) => Promise<void>;
  askRemove: (typeId: string, name: string) => void;
  /** HR's own attachments: anything else worth keeping in the file. */
  canAttach: boolean;
  addAttachment: (title: string, categoryId: string, file: File) => Promise<boolean>;
  askRemoveAttachment: (fileId: string, name: string) => void;
}

const Ctx = createContext<FolderEdit | null>(null);
export const useFolderEdit = (): FolderEdit | null => useContext(Ctx);

export const FolderEditProvider = ({ applicantId, children }: { applicantId: string; children: ReactNode }): JSX.Element => {
  const t = useT();
  const can = useCan();
  const { data: set } = useApplicantDocumentSet(applicantId);
  const card = useStaffReplaceCard();
  const doc = useStaffPutDocument();
  const remove = useStaffRemoveDocument();
  const [removing, setRemoving] = useState<{ typeId?: string; fileId?: string; name: string } | null>(null);
  const qc = useQueryClient();
  const attach = useAddApplicantAttachment(applicantId);
  const unattach = useRemoveApplicantAttachment(applicantId);
  // The same folder the Applicant documents page shows: refresh it after every change here.
  const refreshFolder = (): void => {
    void qc.invalidateQueries({ queryKey: ['hr', 'applicantFolders'] });
  };

  const done = (job: Promise<unknown>): Promise<void> =>
    job.then(
      () => {
        toast.success(t('applicantFile.saved'));
      },
      () => undefined,
    );

  const value: FolderEdit = {
    typeIdOf: (fileId) => set?.documents.find((d) => d.fileId === fileId)?.typeId,
    missing: (set?.missing ?? []).map((m) => ({ typeId: m.typeId, name: m.typeName, required: m.required })),
    canEdit: can('applicantDocument.review'),
    canRemove: can('applicantDocument.delete'),
    putCard: (side, file) => done(card.mutateAsync({ applicantId, side, file })),
    putDoc: (typeId, file) => done(doc.mutateAsync({ applicantId, typeId, file })),
    askRemove: (typeId, name) => setRemoving({ typeId, name }),
    canAttach: can('applicant.edit'),
    addAttachment: async (title, categoryId, file) => {
      const form = new FormData();
      form.append('file', file);
      form.append('title', title);
      form.append('categoryId', categoryId);
      try {
        await attach.mutateAsync(form);
        refreshFolder();
        toast.success(t('applicantFile.saved'));
        return true;
      } catch {
        return false;
      }
    },
    askRemoveAttachment: (fileId, name) => setRemoving({ fileId, name }),
  };
  const confirmRemove = (): Promise<unknown> =>
    removing?.fileId !== undefined
      ? unattach.mutateAsync(removing.fileId).then(refreshFolder)
      : remove.mutateAsync({ applicantId, typeId: removing?.typeId ?? '' });

  return (
    <Ctx.Provider value={value}>
      {children}
      {removing !== null && (
        <Dialog
          open
          size="sm"
          onClose={() => setRemoving(null)}
          title={t('applicantFile.removeTitle', { name: removing.name })}
          description={t('applicantFile.removeBody')}
          footer={
            <>
              <Button variant="secondary" onClick={() => setRemoving(null)}>
                {t('applicantFile.keep')}
              </Button>
              <Button
                variant="danger"
                loading={remove.isPending || unattach.isPending}
                onClick={() =>
                  void confirmRemove()
                    .then(() => {
                      toast.success(t('applicantFile.removed'));
                      setRemoving(null);
                    })
                    .catch(() => undefined)
                }
              >
                {t('applicantFile.remove')}
              </Button>
            </>
          }
        >
          <span />
        </Dialog>
      )}
    </Ctx.Provider>
  );
};

/** A small button that opens the file picker and hands the chosen file on. */
export const PickFileButton = ({
  label,
  onPick,
  primary = false,
}: {
  label: string;
  onPick: (file: File) => Promise<void>;
  primary?: boolean;
}): JSX.Element => {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <Button
        size="sm"
        variant={primary ? 'primary' : 'secondary'}
        loading={busy}
        leftIcon={<UploadIcon className="h-4 w-4" />}
        onClick={() => input.current?.click()}
      >
        {label}
      </Button>
      <input
        ref={input}
        type="file"
        accept={ACCEPT}
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file === undefined) return;
          setBusy(true);
          void onPick(file).finally(() => setBusy(false));
        }}
      />
    </>
  );
};

export const RemoveButton = ({ onClick }: { onClick: () => void }): JSX.Element => {
  const t = useT();
  return (
    <Button size="sm" variant="ghost-danger" leftIcon={<TrashIcon className="h-4 w-4" />} onClick={onClick}>
      {t('applicantFile.remove')}
    </Button>
  );
};

/** «إضافة ملف»: anything else HR wants kept in the applicant's file (a title, a kind, the file). */
export const AddAttachmentButton = (): JSX.Element | null => {
  const t = useT();
  const edit = useFolderEdit();
  const locale = useAppSelector((state) => state.locale.locale);
  const { data: categories = [] } = useFileCategories();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  if (edit === null || !edit.canAttach) return null;
  const close = (): void => {
    setOpen(false);
    setTitle('');
    setCategoryId('');
    setFile(null);
  };
  return (
    <>
      <Button size="sm" leftIcon={<PlusIcon className="h-4 w-4" />} onClick={() => setOpen(true)}>
        {t('applicantFile.addFile')}
      </Button>
      {open && (
        <Dialog
          open
          size="sm"
          onClose={close}
          title={t('applicantFile.addFile')}
          footer={
            <>
              <Button variant="secondary" onClick={close}>{t('applicantFile.keep')}</Button>
              <Button
                loading={busy}
                disabled={file === null || title.trim() === '' || categoryId === ''}
                onClick={() => {
                  if (file === null) return;
                  setBusy(true);
                  void edit
                    .addAttachment(title.trim(), categoryId, file)
                    .then((ok) => {
                      if (ok) close();
                    })
                    .finally(() => setBusy(false));
                }}
              >
                {t('applicantFile.upload')}
              </Button>
            </>
          }
        >
          <div className="space-y-3">
            <Field label={t('applicants.attachments.docTitle')} htmlFor="folder-add-title" required>
              <Input id="folder-add-title" value={title} onChange={(e) => setTitle(e.target.value)} />
            </Field>
            <Field label={t('applicants.attachments.category')} htmlFor="folder-add-cat" required>
              <Select id="folder-add-cat" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                <option value="">—</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>{localized(c.name, locale)}</option>
                ))}
              </Select>
            </Field>
            <input type="file" accept={ACCEPT} onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="block w-full text-sm" />
          </div>
        </Dialog>
      )}
    </>
  );
};
