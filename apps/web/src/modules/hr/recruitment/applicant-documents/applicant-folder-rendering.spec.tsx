// What an applicant's folder DRAWS, at each of its two levels, and who is offered the bin.
//
// The web suite has no DOM: markup comes from `renderToStaticMarkup` and nothing clicks. So the
// navigation is asserted by mounting the body at a chosen level — which is why `ApplicantFolderBody`
// takes `sub` as a prop and keeps no state of its own — and the grouping itself is proved next door
// in `applicant-folder-groups.spec.ts`, where it is a function and not a picture.
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  type ApplicantFolderDeleteBlock,
  type ApplicantFolderDetailDto,
  type ApplicantFolderDto,
  type ApplicantFolderFileDto,
  type ApplicantFolderFileKind,
  type FileDto,
  type Locale,
  type MeDto,
} from '@ecms/contracts';
import { localeSlice } from '../../../../store/localeSlice';
import { authSlice } from '../../../../store/authSlice';
import { translate } from '../../../../platform/localization/i18n';
import { listKey } from '../../../../shared/lib/query-keys';
import { type ApplicantSubFolderId } from './components/applicant-folder-groups';

// The folder dialog portals to `document.body`, which does not exist under `environment: 'node'`.
(globalThis as Record<string, unknown>).document ??= { body: {} };
vi.mock('react-dom', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('react-dom');
  return { ...actual, createPortal: (node: unknown) => node };
});

const { ApplicantFolderBody } = await import('./components/ApplicantFolderDialog');
const { ApplicantFolders } = await import('./components/ApplicantFolders');
const { DeleteFoldersDialog } = await import('./components/DeleteFoldersDialog');
const { APPLICANT_WITHDRAW_REASONS, withdrawReasonKey } = await import(
  './components/applicant-withdraw-reasons'
);

const PAGE_SIZE = 24;
const t = (key: string, params?: Record<string, string | number>): string =>
  translate('ar', key, params);

const file = (id: string): FileDto =>
  ({
    id,
    originalName: `${id}.jpg`,
    displayName: id,
    mime: 'image/jpeg',
    extension: '.jpg',
    size: 4096,
  }) as unknown as FileDto;

const item = (
  kind: ApplicantFolderFileKind,
  id: string,
  documentType: { ar: string; en: string } | null = null,
): ApplicantFolderFileDto => ({ kind, file: file(id), documentType });

const summary = (over: Partial<ApplicantFolderDto> = {}): ApplicantFolderDto => ({
  applicantId: 'a1',
  applicantCode: 'APP-0001',
  applicantName: 'محمد أحمد عبد الله',
  fileCount: 4,
  hasCard: true,
  portraitFileId: null,
  registeredAt: '2026-03-01T09:00:00.000Z',
  deleteBlock: null,
  ...over,
});

const detail = (files: ApplicantFolderFileDto[]): ApplicantFolderDetailDto => ({
  ...summary({ fileCount: files.length }),
  files,
});

const store = (permissions: string[]) =>
  configureStore({
    reducer: { locale: localeSlice.reducer, auth: authSlice.reducer },
    preloadedState: {
      locale: { locale: 'ar' as Locale, dir: 'rtl' as const },
      auth: {
        me: {
          id: 'u1',
          permissions: Object.fromEntries(permissions.map((k) => [k, 'organization'])),
        } as unknown as MeDto,
        status: 'signedIn' as const,
      },
    },
  });

const client = (): QueryClient =>
  new QueryClient({ defaultOptions: { queries: { retry: false } } });

const renderBody = (folder: ApplicantFolderDetailDto, sub: ApplicantSubFolderId | null): string =>
  renderToStaticMarkup(
    <Provider store={store(['applicantDocument.view'])}>
      <QueryClientProvider client={client()}>
        <ApplicantFolderBody folder={folder} sub={sub} onNavigate={() => undefined} />
      </QueryClientProvider>
    </Provider>,
  );

/** The shelf, with one page of folders already in the cache. */
const renderShelf = (folders: ApplicantFolderDto[], permissions: string[]): string => {
  const qc = client();
  qc.setQueryData(listKey('hr', 'applicantFolders', { page: 1, pageSize: PAGE_SIZE }), {
    items: folders,
    meta: { page: 1, pageSize: PAGE_SIZE, totalItems: folders.length, totalPages: 1 },
  });
  return renderToStaticMarkup(
    <Provider store={store(permissions)}>
      <QueryClientProvider client={qc}>
        <ApplicantFolders />
      </QueryClientProvider>
    </Provider>,
  );
};

const FULL = [
  item('cardFront', 'front'),
  item('cardBack', 'back'),
  item('portrait', 'face'),
  item('document', 'birth', { ar: 'شهادة الميلاد', en: 'Birth certificate' }),
  item('attachment', 'cv'),
];

describe('a folder opens onto its sub-folders', () => {
  const markup = renderBody(detail(FULL), null);

  it('names all three, and none of their contents', () => {
    expect(markup).toContain(t('hr.applicantFolders.sub.card'));
    expect(markup).toContain(t('hr.applicantFolders.sub.documents'));
    expect(markup).toContain(t('hr.applicantFolders.sub.attachments'));
    // The drawers are shut: a file name belongs to the level below.
    expect(markup).not.toContain('birth');
    expect(markup).not.toContain('cv');
  });

  it('counts what is in each', () => {
    expect(markup).toContain(t('hr.applicantFolders.files', { n: 3 }));
    expect(markup).toContain(t('hr.applicantFolders.files', { n: 1 }));
  });

  it('shows an empty drawer, dimmed and saying so, rather than hiding it', () => {
    const empty = renderBody(detail([item('attachment', 'cv')]), null);
    expect(empty).toContain(t('hr.applicantFolders.sub.documents'));
    expect(empty).toContain(t('hr.applicantFolders.subEmpty'));
    // Dimmed, not recoloured — `FolderShell`'s one concession to an empty drawer.
    expect(empty).toContain('opacity-50');
  });
});

describe('inside one sub-folder', () => {
  it('heads the card drawer with its three tiles and names the missing side', () => {
    const markup = renderBody(detail([item('cardFront', 'front')]), 'card');
    expect(markup).toContain(t('hr.applicantFolders.kind.cardFront'));
    expect(markup).toContain(t('hr.applicantFolders.kind.cardBack'));
    expect(markup).toContain(t('hr.applicantFolders.kind.portrait'));
    expect(markup).toContain(t('hr.applicantFolders.notOnFile'));
  });

  it('heads each handed-in document with the type it was handed in for', () => {
    const markup = renderBody(detail(FULL), 'documents');
    expect(markup).toContain('شهادة الميلاد');
    expect(markup).toContain('birth');
    // The other drawers' files are not here.
    expect(markup).not.toContain('cv');
  });

  it('says so when a drawer the candidate never filled is opened', () => {
    const markup = renderBody(detail([item('attachment', 'cv')]), 'documents');
    expect(markup).toContain(t('hr.applicantFolders.subNone.documents'));
  });

  /** «اسم المتقدم › بطاقة الرقم القومي», and the name is a real control. */
  it('draws a breadcrumb whose first step is the way back', () => {
    const markup = renderBody(detail(FULL), 'card');
    expect(markup).toContain(t('hr.applicantFolders.breadcrumb'));
    expect(markup).toContain('محمد أحمد عبد الله');
    expect(markup).toContain(t('hr.applicantFolders.sub.card'));
    // The applicant's name is a <button>, not a styled span — tabbable and announced.
    expect(markup).toMatch(/<button[^>]*>(?:(?!<\/button>).)*محمد أحمد عبد الله/su);
    expect(markup).toContain('aria-current="page"');
  });
});

describe('who is offered the bin', () => {
  it('offers it to a holder of the delete key', () => {
    const markup = renderShelf([summary()], ['applicantDocument.view', 'applicantDocument.delete']);
    expect(markup).toContain(t('hr.applicantFolders.deleteFolder'));
    expect(markup).toContain(t('hr.applicantFolders.select'));
  });

  /** Not «no screen» — a reader may still read. It is the DELETE that is not theirs. */
  it('offers it to nobody else, while still showing the folder', () => {
    const markup = renderShelf([summary()], ['applicantDocument.view']);
    expect(markup).toContain('محمد أحمد عبد الله');
    expect(markup).toContain('APP-0001');
    expect(markup).not.toContain(t('hr.applicantFolders.deleteFolder'));
    expect(markup).not.toContain(t('hr.applicantFolders.select'));
  });

  it.each<ApplicantFolderDeleteBlock>(['hired', 'employed', 'acceptedOffer'])(
    'disables it for a kept record and says why — %s',
    (deleteBlock) => {
      const markup = renderShelf(
        [summary({ deleteBlock })],
        ['applicantDocument.view', 'applicantDocument.delete'],
      );
      // The control stays, so «why can I not delete this one» has an answer on the tile.
      expect(markup).toContain(t('hr.applicantFolders.deleteFolder'));
      expect(markup).toContain('disabled');
      expect(markup).toContain(t(`hr.applicantFolders.blocked.${deleteBlock}`));
    },
  );
});

describe('the confirmation, and the second act it offers', () => {
  const renderConfirm = (folders: ApplicantFolderDto[], permissions: string[]): string =>
    renderToStaticMarkup(
      <Provider store={store(permissions)}>
        <QueryClientProvider client={client()}>
          <DeleteFoldersDialog
            folders={folders}
            onClose={() => undefined}
            onConfirm={async () => undefined}
          />
        </QueryClientProvider>
      </Provider>,
    );

  const BOTH = ['applicantDocument.view', 'applicantDocument.delete', 'applicant.edit'];
  const FOLDER_ONLY = ['applicantDocument.view', 'applicantDocument.delete'];

  it('offers the withdrawal ticked, with every reason to choose from', () => {
    const markup = renderConfirm([summary()], BOTH);
    expect(markup).toContain(t('hr.applicantFolders.alsoWithdraw'));
    expect(markup).toContain('checked');
    expect(markup).toContain(t('hr.applicantFolders.withdrawReasonLabel'));
    for (const reason of APPLICANT_WITHDRAW_REASONS) {
      expect(markup, reason).toContain(t(withdrawReasonKey(reason)));
    }
  });

  /**
   * Withdrawing is the applicants module's act and needs its key. The API refuses a request that
   * asks for one the caller may not perform, so this is the courtesy half — but it has to be here,
   * or the operator ticks a box that turns their delete into an error.
   */
  it('does not offer it to a caller who may empty folders but not edit applicants', () => {
    const markup = renderConfirm([summary()], FOLDER_ONLY);
    expect(markup).toContain(t('common.delete'));
    expect(markup).not.toContain(t('hr.applicantFolders.alsoWithdraw'));
    expect(markup).not.toContain(t('hr.applicantFolders.withdrawReasonLabel'));
  });

  /**
   * The note may not promise a restore this system does not have. There is no recovery screen —
   * the files are kept and an administrator gets them back on request — and the sentence has to
   * say that rather than implying a button somewhere.
   */
  it('promises recovery by the administrator, not a screen the product lacks', () => {
    const markup = renderConfirm([summary()], BOTH);
    expect(markup).toContain(t('hr.applicantFolders.deleteSoftNote'));
    expect(t('hr.applicantFolders.deleteSoftNote')).toContain('مدير النظام');
    expect(translate('en', 'hr.applicantFolders.deleteSoftNote')).toContain(
      'system administrator on request',
    );
  });

  /** A selection may hold folders the API will keep. They are not withdrawn either, and it says so. */
  it('warns that a kept folder is not withdrawn either', () => {
    const markup = renderConfirm(
      [summary(), summary({ applicantId: 'a2', deleteBlock: 'hired' })],
      BOTH,
    );
    expect(markup).toContain(t('hr.applicantFolders.withdrawSkipsKept', { n: 1 }));
  });

  it('says nothing about kept folders when the selection holds none', () => {
    const markup = renderConfirm([summary(), summary({ applicantId: 'a2' })], BOTH);
    expect(markup).not.toContain(t('hr.applicantFolders.withdrawSkipsKept', { n: 1 }));
  });
});
