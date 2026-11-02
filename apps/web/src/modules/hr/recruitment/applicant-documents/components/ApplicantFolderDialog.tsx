// Inside one applicant's folder: three drawers, and one of them open at a time.
//
// WHY DRAWERS AND NOT ONE LIST. The folder used to open onto the three card tiles followed by
// «ملفات أخرى» — every other file in one list. Three unrelated things were in that list: identity
// evidence, what the candidate handed in through the portal, and what HR attached on their page.
// Nobody looking for one of them wants to read past the other two, and the list only grows.
//
// ONE LEVEL, NOT A SECOND DIALOG. The drawer opens inside the same dialog, so closing the drawer
// and closing the folder are different acts with different keys — Escape backs out one level while
// a drawer is open, and only closes the folder from the top. A nested dialog would have stacked
// two modals and two scroll containers to express a step that is not a different place.
import { useEffect, useMemo, useState } from 'react';
import {
  type ApplicantFolderDetailDto,
  type ApplicantFolderDto,
  type ApplicantFolderFileDto,
  type LocalizedString,
} from '@ecms/contracts';
import { useT } from '../../../../../platform/localization/useT';
import { useAppSelector } from '../../../../../store';
import { cn } from '../../../../../shared/lib/cn';
import { formatDate, localized } from '../../../../../shared/lib/format';
import { Button } from '../../../../../shared/ui/Button';
import { Dialog } from '../../../../../shared/ui/Dialog';
import { LoadingState } from '../../../../../shared/ui';
import { ErrorState } from '../../../../../shared/ui/states/ErrorState';
import { toast } from '../../../../../shared/ui/toast/toast-store';
import {
  ChevronEndIcon,
  ChevronStartIcon,
  DownloadIcon,
  FileIcon,
  FolderIcon,
  ImageIcon,
  TrashIcon,
} from '../../../../../shared/ui/icons';
import { useApplicantFolder } from '../api/applicant-document-queries';
import {
  CARD_TILE_KINDS,
  cardExtras,
  cardTileFile,
  splitIntoSubFolders,
  type ApplicantSubFolderId,
} from './applicant-folder-groups';
import { CardTile, FileRow, downloadName, save } from './folder-file-bits';
import { FolderShell } from './folder-shell';

/** The glyph on each drawer's front panel. The card drawer holds pictures; the others hold files. */
const FACE: Record<ApplicantSubFolderId, (props: { className: string }) => JSX.Element> = {
  card: ImageIcon,
  documents: FileIcon,
  attachments: FolderIcon,
};

// ── One drawer on the shelf inside the folder ─────────────────────────────

const SubFolderTile = ({
  id,
  count,
  onOpen,
}: {
  id: ApplicantSubFolderId;
  count: number;
  onOpen: () => void;
}): JSX.Element => {
  const t = useT();
  const Face = FACE[id];
  const empty = count === 0;
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={t(`hr.applicantFolders.sub.${id}`)}
      className="group flex flex-col items-center gap-2 rounded-2xl p-2 text-center outline-none transition-colors hover:bg-white focus-visible:ring-2 focus-visible:ring-brand-500 dark:hover:bg-slate-900/70"
    >
      {/* No count badge on the drawer's front: the caption below carries the count, and saying it
          twice on a 6rem folder crowds the glyph it sits beside. */}
      <FolderShell size="sm" dimmed={empty} face={<Face className="h-7 w-7 text-white/85" />} />
      <span className="w-full min-w-0">
        <span className="block text-sm font-bold text-slate-900 dark:text-slate-100">
          {t(`hr.applicantFolders.sub.${id}`)}
        </span>
        <span
          className={cn(
            'block text-xs',
            empty ? 'text-slate-400 dark:text-slate-500' : 'text-slate-500 dark:text-slate-400',
          )}
        >
          {empty ? t('hr.applicantFolders.subEmpty') : t('hr.applicantFolders.files', { n: count })}
        </span>
      </span>
    </button>
  );
};

// ── What is inside one drawer ─────────────────────────────────────────────

/**
 * The portal documents, under the heading of the document type each was handed in for.
 *
 * The type comes off the API (`documentType`), not off the file's display name: the display name a
 * portal upload is stored under is the type's ARABIC name, and heading an English screen with it
 * would be a translation bug that only shows up for an English reader. A file whose set row has
 * gone — the catalogue entry was retired, say — is still shown, under «غير مُصنَّف», because a
 * document nobody can name is still a document the candidate handed in.
 */
const DocumentsDrawer = ({
  files,
  code,
}: {
  files: ApplicantFolderFileDto[];
  code: string;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state) => state.locale.locale);
  const groups = useMemo(() => {
    const byType = new Map<string, { label: string; files: ApplicantFolderFileDto[] }>();
    for (const item of files) {
      const type: LocalizedString | null = item.documentType ?? null;
      const key = type === null ? '' : `${type.en}\u0000${type.ar}`;
      const label =
        type === null ? t('hr.applicantFolders.untypedDocuments') : localized(type, locale);
      const bucket = byType.get(key) ?? { label, files: [] };
      bucket.files.push(item);
      byType.set(key, bucket);
    }
    // Named types first, in the order they appear; the unnamed remainder last.
    return [...byType.entries()]
      .sort(([a], [b]) => (a === '' ? 1 : b === '' ? -1 : 0))
      .map(([, group]) => group);
  }, [files, locale, t]);

  return (
    <div className="space-y-4">
      {groups.map((group) => (
        <section key={group.label} className="space-y-2">
          <h5 className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            {group.label}
          </h5>
          <ul className="grid grid-cols-1 gap-2">
            {group.files.map((item) => (
              <FileRow key={item.file.id} item={item} code={code} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
};

const CardDrawer = ({
  files,
  code,
}: {
  files: ApplicantFolderFileDto[];
  code: string;
}): JSX.Element => {
  const t = useT();
  const extras = cardExtras(files);
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_1fr_minmax(0,150px)]">
        {CARD_TILE_KINDS.map((kind) => (
          <CardTile key={kind} kind={kind} item={cardTileFile(files, kind)} code={code} />
        ))}
      </div>
      {extras.length > 0 && (
        <section className="space-y-2">
          <h5 className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            {t('hr.applicantFolders.moreCardImages', { n: extras.length })}
          </h5>
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {extras.map((item) => (
              <FileRow key={item.file.id} item={item} code={code} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
};

const Drawer = ({
  id,
  files,
  code,
}: {
  id: ApplicantSubFolderId;
  files: ApplicantFolderFileDto[];
  code: string;
}): JSX.Element => {
  const t = useT();
  if (id === 'card') return <CardDrawer files={files} code={code} />;
  if (files.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
        {t(`hr.applicantFolders.subNone.${id}`)}
      </p>
    );
  }
  if (id === 'documents') return <DocumentsDrawer files={files} code={code} />;
  return (
    <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      {files.map((item) => (
        <FileRow key={item.file.id} item={item} code={code} />
      ))}
    </ul>
  );
};

// ── The breadcrumb ────────────────────────────────────────────────────────

/**
 * «اسم المتقدم › بطاقة الرقم القومي» — and the applicant's name is the way back.
 *
 * A real button, not a styled span, so it is in the tab order and announces itself; the chevron
 * flips with the reading direction because `ChevronEndIcon` does.
 */
const Breadcrumb = ({
  applicantName,
  sub,
  onBack,
}: {
  applicantName: string;
  sub: ApplicantSubFolderId;
  onBack: () => void;
}): JSX.Element => {
  const t = useT();
  return (
    <nav
      aria-label={t('hr.applicantFolders.breadcrumb')}
      className="flex flex-wrap items-center gap-1 text-sm"
    >
      <button
        type="button"
        onClick={onBack}
        className="inline-flex min-h-[34px] items-center gap-1 rounded-lg px-2 font-semibold text-brand-700 outline-none transition-colors hover:bg-brand-50 focus-visible:ring-2 focus-visible:ring-brand-500 dark:text-brand-300 dark:hover:bg-brand-950/40"
      >
        <ChevronStartIcon className="h-4 w-4 rtl:-scale-x-100" />
        {applicantName}
      </button>
      <ChevronEndIcon className="h-3.5 w-3.5 shrink-0 text-slate-400 rtl:-scale-x-100" />
      <span className="px-1 font-bold text-slate-900 dark:text-slate-100" aria-current="page">
        {t(`hr.applicantFolders.sub.${sub}`)}
      </span>
    </nav>
  );
};

// ── The body, at whichever level ─────────────────────────────────────────

/**
 * What the folder shows: the drawers, or inside one of them.
 *
 * Exported and STATELESS — `sub` comes in and navigation goes out — because the web suite renders
 * without a DOM and cannot click: a test can mount this at a chosen level and read what it drew,
 * which is the only way to assert that the breadcrumb names the right drawer and offers the way
 * back. The state itself lives one component up, where it belongs.
 */
export const ApplicantFolderBody = ({
  folder,
  sub,
  onNavigate,
}: {
  folder: ApplicantFolderDetailDto;
  sub: ApplicantSubFolderId | null;
  onNavigate: (sub: ApplicantSubFolderId | null) => void;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state) => state.locale.locale);
  const drawers = splitIntoSubFolders(folder.files);
  const open = sub === null ? undefined : drawers.find((drawer) => drawer.id === sub);

  if (sub === null || open === undefined) {
    return (
      <div className="space-y-5">
        <p className="text-xs text-slate-500 dark:text-slate-400">
          {t('hr.applicantFolders.registered', { date: formatDate(folder.registeredAt, locale) })}
        </p>
        <div className="mx-auto grid max-w-xl grid-cols-2 gap-3 sm:grid-cols-3">
          {drawers.map((drawer) => (
            <SubFolderTile
              key={drawer.id}
              id={drawer.id}
              count={drawer.files.length}
              onOpen={() => onNavigate(drawer.id)}
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <Breadcrumb applicantName={folder.applicantName} sub={sub} onBack={() => onNavigate(null)} />
      <Drawer id={sub} files={open.files} code={folder.applicantCode} />
    </div>
  );
};

// ── The dialog ────────────────────────────────────────────────────────────

export const ApplicantFolderDialog = ({
  folder,
  onClose,
  onDelete,
}: {
  folder: ApplicantFolderDto | null;
  onClose: () => void;
  /** Offered only to a caller that holds the delete permission; absent otherwise. */
  onDelete?: ((folder: ApplicantFolderDto) => void) | undefined;
}): JSX.Element => {
  const t = useT();
  const detail = useApplicantFolder(folder?.applicantId ?? '');
  const [sub, setSub] = useState<ApplicantSubFolderId | null>(null);
  const [saving, setSaving] = useState(false);

  // A different applicant opens at the top of their folder, never inside the drawer the last one
  // was left in.
  useEffect(() => setSub(null), [folder?.applicantId]);

  /**
   * Escape backs out of the DRAWER, not out of the folder.
   *
   * `Dialog` listens for Escape on `document` in the bubble phase and closes. Listening in the
   * CAPTURE phase on the same node runs first, and stopping propagation there keeps the dialog's
   * own handler from also firing — so one press is one level. At the top level this effect is not
   * mounted at all and Escape closes the folder, exactly as it always did.
   */
  useEffect(() => {
    if (sub === null) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      setSub(null);
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [sub]);

  const drawers = splitIntoSubFolders(detail.data?.files ?? []);
  /** What «تنزيل الكل» means where you are standing: the whole folder, or the open drawer. */
  const downloadable =
    sub === null
      ? (detail.data?.files ?? [])
      : (drawers.find((drawer) => drawer.id === sub)?.files ?? []);
  const blocked =
    folder?.deleteBlock == null
      ? undefined
      : t(`hr.applicantFolders.blocked.${folder.deleteBlock}`);

  /** Every file in turn (a browser asks once before saving several). */
  const downloadMany = async (files: ApplicantFolderFileDto[], code: string): Promise<void> => {
    setSaving(true);
    let failed = 0;
    for (const item of files) {
      if (!(await save(item.file.id, downloadName(code, item)))) failed += 1;
      await new Promise((resolve) => window.setTimeout(resolve, 350));
    }
    setSaving(false);
    if (failed > 0) toast.error(t('hr.applicantFolders.downloadFailed'));
  };

  return (
    <Dialog
      open={folder !== null}
      onClose={onClose}
      title={folder?.applicantName ?? ''}
      description={
        folder === null
          ? ''
          : `${folder.applicantCode} · ${t('hr.applicantFolders.files', { n: folder.fileCount })}`
      }
      size="xl"
      footer={
        <>
          {sub !== null && (
            <Button variant="secondary" onClick={() => setSub(null)}>
              <ChevronStartIcon className="h-4 w-4" />
              {t('hr.applicantFolders.back')}
            </Button>
          )}
          <Button variant="secondary" onClick={onClose}>
            {t('hr.applicantFolders.close')}
          </Button>
          {onDelete !== undefined && folder !== null && (
            <Button
              variant="ghost-danger"
              disabled={blocked !== undefined}
              title={blocked}
              onClick={() => onDelete(folder)}
            >
              <TrashIcon className="h-4 w-4" />
              {t('hr.applicantFolders.deleteFolder')}
            </Button>
          )}
          <Button
            loading={saving}
            disabled={downloadable.length === 0}
            onClick={() => {
              if (detail.data !== undefined)
                void downloadMany(downloadable, detail.data.applicantCode);
            }}
          >
            <DownloadIcon className="h-4 w-4" />
            {t(
              sub === null
                ? 'hr.applicantFolders.downloadAll'
                : 'hr.applicantFolders.downloadDrawer',
            )}
          </Button>
        </>
      }
    >
      {detail.isPending ? (
        <LoadingState />
      ) : detail.isError || detail.data === undefined ? (
        <ErrorState error={detail.error} onRetry={() => void detail.refetch()} />
      ) : (
        <ApplicantFolderBody folder={detail.data} sub={sub} onNavigate={setSub} />
      )}
    </Dialog>
  );
};
