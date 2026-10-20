// «إعداد المذكرات» — the names the custody's seven papers are signed with, set once.
//
// «إعداد النماذج» of the licence memos, for the custody's papers: pick a paper (the four memos —
// كاوتش، وقود، صيانة، غسيل — and the three letters), write each signer's office and name exactly as
// it prints, tick who prints on it, and see the paper beside the form drawn by the very renderer
// the print uses. Every NEW memo or letter is saved with these names (the server copies them when
// it is created); one already saved keeps the names it was saved with, so a reprint never changes.
//
// All seven papers are held at once — switching papers keeps what was typed and not saved — and
// one «حفظ الإعداد» writes them all, with the version the page read: a set-up saved elsewhere
// meanwhile is shown, never overwritten. The inputs keep every space typed: his names carry double
// spaces («مدير إدارة␣␣الحركة») that the papers print.
//
// The preview is the latest saved memo (or letter) of that paper with the names written here — or,
// when there is none yet, the empty paper dated today. Never invented rows.
import { useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  FLEET_CUSTODY_LETTERS,
  FLEET_CUSTODY_PAPERS,
  FLEET_CUSTODY_SOURCES,
  isFleetCustodyMemoPaper,
  type FleetCustodyMemoDto,
  type FleetCustodyOperationDto,
  type FleetCustodyPaper,
  type FleetCustodyPaperSet,
  type FleetCustodyPaperSettingsDto,
  type FleetCustodyPaperSignatures,
  type FleetCustodySignBlock,
  type FleetCustodySignRole,
  type Locale,
  type SaveFleetCustodyPaperSettings,
} from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useAppSelector } from '../../../store';
import { Input } from '../../../shared/ui/form';
import { CheckIcon } from '../../../shared/ui/icons';
import { toast } from '../../../shared/ui/toast/toast-store';
import { ErrorState } from '../../../shared/ui/states/ErrorState';
import { LoadingState } from '../../../shared/ui/states/LoadingState';
import { ApiError } from '../../../shared/lib/api-client';
import { cn } from '../../../shared/lib/cn';
import { errorMessage } from '../../../shared/lib/errors';
import {
  custodyPaperSettingsKey,
  useCustodyLedger,
  useCustodyMemo,
  useCustodyMemos,
  useCustodyOperation,
  useCustodyPaperSettings,
  useSaveCustodyPaperSettings,
} from '../api/fleet-queries';
import {
  DESIGN_BACK,
  DESIGN_COLUMN,
  DESIGN_HINT,
  DESIGN_TILE,
  DesignPageHeader,
  SWITCH_TRAY,
  switchOption,
  today,
} from '../components/LicenseExpensePaidGroup';
import { DesignSave, DesignSection } from '../components/DesignDialog';
import { DesignField, LOOK, boxTone } from '../components/FuelCardDialog';
import { NUM, PATH } from '../components/FuelCardBoard';
import { FILTER_ICON } from '../components/FilterWithIcon';
import { PaperTray, usePaperFonts } from '../components/CustodyPaperSheets';
import {
  letterPaperOf,
  letterSheets,
  memoPaperOf,
  memoSheets,
  type LetterPaperInput,
} from '../lib/custody-papers';

/** The design's text box, from the forms' `add` look. */
const BOX = boxTone(LOOK.add);

const MEMO_PAPERS: readonly FleetCustodyPaper[] =
  FLEET_CUSTODY_PAPERS.filter(isFleetCustodyMemoPaper);
const LETTER_PAPERS: readonly FleetCustodyPaper[] = FLEET_CUSTODY_LETTERS;

/** The paper in the address — `tyres` when there is none, or it is not one of the seven. */
export const setupPaperOf = (value: string | undefined): FleetCustodyPaper =>
  (FLEET_CUSTODY_PAPERS as readonly string[]).includes(value ?? '')
    ? (value as FleetCustodyPaper)
    : 'tyres';

/** Where a paper's set-up lives — switching papers replaces it, so «رجوع» leaves the page. */
export const setupPathOf = (paper: FleetCustodyPaper): string =>
  `/fleet/custody/memos/setup/${paper}`;

/**
 * A tick that cannot be cleared: a memo's preparer and director ARE the memo — his memos always
 * print them (the server refuses a memo paper without them).
 */
export const tickLocked = (paper: FleetCustodyPaper, role: FleetCustodySignRole): boolean =>
  isFleetCustodyMemoPaper(paper) && (role === 'preparer' || role === 'director');

/**
 * The tyres, maintenance and washing endorser is one line under the underlined review line («سطر
 * التصديق»); the fuel paper's has an office line of its own and no review line; the letters' have
 * an office and a name.
 */
export const isReviewEndorser = (paper: FleetCustodyPaper, role: FleetCustodySignRole): boolean =>
  isFleetCustodyMemoPaper(paper) && paper !== 'fuel' && role === 'endorser';

/** One block of one paper changed; the other six papers, typed and not saved, stay as they are. */
export const withBlock = (
  all: FleetCustodyPaperSet,
  paper: FleetCustodyPaper,
  index: number,
  patch: Partial<Omit<FleetCustodySignBlock, 'role'>>,
): FleetCustodyPaperSet => ({
  ...all,
  [paper]: {
    ...all[paper],
    blocks: all[paper].blocks.map((block, i) => (i === index ? { ...block, ...patch } : block)),
  },
});

/** One paper's review line changed. */
export const withNote = (
  all: FleetCustodyPaperSet,
  paper: FleetCustodyPaper,
  note: string,
): FleetCustodyPaperSet => ({ ...all, [paper]: { ...all[paper], note } });

/**
 * «حفظ الإعداد» as ONE write: all seven papers, exactly as typed (inner spaces kept — the server
 * trims the ends only), with the version the page was read at. Before the first save there is no
 * version, and the write goes through as the first one.
 */
export const setupBody = (
  all: FleetCustodyPaperSet,
  version: number | null,
): SaveFleetCustodyPaperSettings => ({
  papers: all,
  ...(version === null ? {} : { version }),
});

/**
 * Whether the set-up was saved somewhere else since the page read it — another tab, another user —
 * as realtime brings it into the cache. Checked before every save.
 */
export const savedElsewhere = (
  version: number | null,
  cached: FleetCustodyPaperSettingsDto | undefined,
): boolean => cached !== undefined && cached.version !== version;

/** The empty letter of a kind, dated `day` — the preview when none was recorded yet. */
const emptyLetter = (
  kind: (typeof FLEET_CUSTODY_LETTERS)[number],
  day: string,
  signatures: FleetCustodyPaperSignatures,
): LetterPaperInput =>
  kind === 'charge'
    ? { kind, date: day, amount: 0, reason: '', signatures }
    : kind === 'replenish'
      ? { kind, date: day, from: null, to: null, amount: 0, custody: 0, rows: [], signatures }
      : { kind, date: day, from: null, to: null, amount: 0, custody: 0, rows: [], signatures };

/**
 * The preview's sheets: the latest saved memo or letter of the paper, with the names being typed —
 * or the empty paper dated `day`. A memo or letter of another paper (the list's previous answer,
 * kept while the next one loads) is never drawn under this one's names.
 */
export const setupPreviewSheets = (
  paper: FleetCustodyPaper,
  signatures: FleetCustodyPaperSignatures,
  latest: { memo?: FleetCustodyMemoDto | undefined; op?: FleetCustodyOperationDto | undefined },
  day: string,
): string[] => {
  if (isFleetCustodyMemoPaper(paper)) {
    const memo = latest.memo?.kind === paper ? latest.memo : undefined;
    return memoSheets(
      memo === undefined
        ? { kind: paper, lines: [], signatures }
        : { ...memoPaperOf(memo), signatures },
    );
  }
  const op = latest.op?.kind === paper ? latest.op : undefined;
  return letterSheets(
    op === undefined ? emptyLetter(paper, day, signatures) : { ...letterPaperOf(op), signatures },
  );
};

export const CustodyPapersSetupPage = (): JSX.Element => {
  const settings = useCustodyPaperSettings();
  // Bumped when a save finds the set-up saved elsewhere: the form starts again from the cache.
  const [round, setRound] = useState(0);
  // A cached copy may be old: the page waits for the read its opening starts, so its boxes never
  // start from — nor save over — a set-up that has moved on.
  if (settings.data !== undefined && (settings.isFetchedAfterMount || !settings.isStale)) {
    return (
      <CustodyPapersSetup
        key={round}
        saved={settings.data}
        onReread={() => setRound((held) => held + 1)}
      />
    );
  }
  return settings.isError ? (
    <ErrorState error={settings.error} onRetry={() => void settings.refetch()} />
  ) : (
    <LoadingState />
  );
};

/** LicensingPage's round tick — «علامة صح» — for whether a name prints on this paper. */
const PrintedTick = ({
  on,
  onToggle,
  label,
  title,
  disabled,
  role,
}: {
  on: boolean;
  onToggle: () => void;
  label: string;
  title?: string | undefined;
  disabled: boolean;
  role: FleetCustodySignRole;
}): JSX.Element => (
  <button
    type="button"
    aria-pressed={on}
    aria-label={label}
    title={title}
    disabled={disabled}
    onClick={onToggle}
    data-memos-setup-printed={role}
    className="group inline-flex items-center gap-2 text-[13px] font-bold text-slate-700 disabled:cursor-not-allowed dark:text-slate-200"
  >
    <span
      className={cn(
        'flex h-7 w-7 items-center justify-center rounded-full transition active:scale-90',
        on
          ? 'bg-emerald-500 text-white shadow-md shadow-emerald-700/30 group-hover:bg-emerald-400'
          : 'border-2 border-dashed border-slate-300 text-transparent group-hover:border-emerald-500 group-hover:text-emerald-500 dark:border-slate-600',
        disabled && 'opacity-60',
      )}
    >
      <CheckIcon className="h-4 w-4 stroke-[3]" />
    </span>
    {label}
  </button>
);

const ROLE_TONE: Record<FleetCustodySignRole, string> = {
  preparer: 'bg-indigo-500/15 text-indigo-700 dark:text-[#a5a0ff]',
  director: 'bg-sky-500/15 text-sky-700 dark:text-sky-300',
  finance: 'bg-amber-500/15 text-amber-800 dark:text-amber-300',
  endorser: 'bg-emerald-500/15 text-emerald-800 dark:text-emerald-300',
};

/** Mounted once the set-up is read, so every box starts from it — on the first render. */
const CustodyPapersSetup = ({
  saved,
  onReread,
}: {
  saved: FleetCustodyPaperSettingsDto;
  onReread: () => void;
}): JSX.Element => {
  const t = useT();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const save = useSaveCustodyPaperSettings();
  const paper = setupPaperOf(useParams().paper);
  const memoPaper = isFleetCustodyMemoPaper(paper);

  // EVERY paper's names held at once: switching to another paper and back keeps what was typed.
  const [all, setAll] = useState<FleetCustodyPaperSet>(() => structuredClone(saved.papers));
  const [version, setVersion] = useState(saved.version);
  const signs = all[paper];

  // The preview's paper: the latest saved memo of the kind, or the latest letter of the kind.
  const memoKind = memoPaper ? paper : FLEET_CUSTODY_SOURCES[0];
  const memos = useCustodyMemos(
    { kind: memoKind, page: 1, pageSize: 1, sort: 'no:desc' },
    memoPaper,
  );
  const memoRow = memos.data?.items[0];
  const latestMemo = useCustodyMemo(memoPaper && memoRow?.kind === paper ? memoRow.id : '');
  const ledger = useCustodyLedger(
    { op: paper, page: 1, pageSize: 1, sort: 'date:desc' },
    !memoPaper,
  );
  const opRow = ledger.data?.items[0];
  const latestOp = useCustodyOperation(!memoPaper && opRow?.op === paper ? opRow.id : '');
  const latest = memoPaper ? latestMemo.data : latestOp.data;
  const shown = latest !== undefined && latest.kind === paper;

  const fonts = usePaperFonts();
  const day = useMemo(() => today(), []);
  const sheets = useMemo(
    () => setupPreviewSheets(paper, signs, { memo: latestMemo.data, op: latestOp.data }, day),
    // `fonts`: drawn again once the faces can measure the shrink-to-fit.
    [paper, signs, latestMemo.data, latestOp.data, day, fonts],
  );

  const pick = (other: FleetCustodyPaper): void => {
    if (other !== paper) void navigate(setupPathOf(other), { replace: true });
  };
  const setBlock = (index: number, patch: Partial<Omit<FleetCustodySignBlock, 'role'>>): void =>
    setAll((held) => withBlock(held, paper, index, patch));
  const setNote = (note: string): void => setAll((held) => withNote(held, paper, note));

  /** Saved elsewhere meanwhile: overwrite nothing — show theirs, read afresh. */
  const rereadSaved = async (): Promise<void> => {
    toast.warning(t('fleet.custody.papers.setup.staleToast'));
    await qc.refetchQueries({ queryKey: custodyPaperSettingsKey, exact: true });
    onReread();
  };
  // Held across renders: a second press before the first save returns writes nothing twice.
  const saving = useRef(false);
  const onSave = async (): Promise<void> => {
    if (saving.current) return;
    const cached = qc.getQueryData<FleetCustodyPaperSettingsDto>(custodyPaperSettingsKey);
    if (savedElsewhere(version, cached)) {
      await rereadSaved();
      return;
    }
    saving.current = true;
    try {
      // The hook writes the saved set-up into the cache: a paper drawn next prints with it.
      const result = await save.mutateAsync(setupBody(all, version));
      setVersion(result.version);
      toast.success(t('fleet.custody.papers.setup.savedToast'));
    } catch (failure) {
      if (failure instanceof ApiError && failure.code === 'STALE_DOCUMENT') await rereadSaved();
      else toast.error(errorMessage(failure, locale));
    } finally {
      saving.current = false;
    }
  };

  const paperName = t(`fleet.custody.papers.name.${paper}`);

  const tray = (papers: readonly FleetCustodyPaper[]): JSX.Element => (
    <div className={cn(SWITCH_TRAY, 'flex-wrap')}>
      {papers.map((other) => (
        <button
          key={other}
          type="button"
          aria-pressed={other === paper}
          data-memos-setup-paper={other}
          onClick={() => pick(other)}
          className={switchOption(other === paper)}
        >
          {other === paper ? '✓ ' : ''}
          {t(`fleet.custody.papers.short.${other}`)}
        </button>
      ))}
    </div>
  );

  const field = (
    label: string,
    value: string,
    onChange: (value: string) => void,
    mark: string,
    hint?: string,
  ): JSX.Element => (
    <DesignField label={label} hint={hint}>
      <Input
        aria-label={label}
        value={value}
        // Exactly as typed: his double spaces print.
        onChange={(e) => onChange(e.target.value)}
        tone={BOX}
        data-memos-setup-field={mark}
      />
    </DesignField>
  );

  return (
    <div className="flex h-full min-h-0 flex-col" data-memos-setup={paper}>
      <DesignPageHeader
        icon={PATH.box}
        title={t('fleet.custody.papers.setup.title')}
        subtitle={t('fleet.custody.papers.setup.subtitle')}
      >
        <Link to="/fleet/custody" className={DESIGN_BACK} data-memos-setup-back="true">
          {t('fleet.custody.papers.setup.back')}
        </Link>
        <DesignSave
          onClick={() => void onSave()}
          busy={save.isPending}
          label={t('fleet.custody.papers.setup.save')}
          data-memos-setup-save="true"
        />
      </DesignPageHeader>

      <div className="flex min-h-0 flex-1 flex-col gap-4 p-4 lg:flex-row">
        <section className={DESIGN_COLUMN}>
          <DesignSection title={t('fleet.custody.papers.setup.paperSection')} icon={PATH.card}>
            <p className={DESIGN_HINT}>{t('fleet.custody.papers.setup.paperHint')}</p>
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-3" data-memos-setup-tray="memos">
                <span className="w-20 shrink-0 text-[13px] font-bold text-slate-700 dark:text-slate-300">
                  {t('fleet.custody.papers.setup.memos')}
                </span>
                {tray(MEMO_PAPERS)}
              </div>
              <div className="flex flex-wrap items-center gap-3" data-memos-setup-tray="letters">
                <span className="w-20 shrink-0 text-[13px] font-bold text-slate-700 dark:text-slate-300">
                  {t('fleet.custody.papers.setup.letters')}
                </span>
                {tray(LETTER_PAPERS)}
              </div>
            </div>
          </DesignSection>

          <DesignSection
            title={t('fleet.custody.papers.setup.signatures', { paper: paperName })}
            icon={FILTER_ICON.person}
          >
            <p className={DESIGN_HINT}>{t('fleet.custody.papers.setup.signaturesHint')}</p>
            {/* Cairo's dots under «ي» fall below a 20px line and were cut off («علي» read «على»):
                the same 44px box, with a 28px line. */}
            <ol
              className="space-y-4 [&_input]:!py-2 [&_input]:!leading-7 [&_input]:[font-family:'Cairo',sans-serif]"
              data-memos-setup-blocks={paper}
            >
              {signs.blocks.map((block, index) => {
                const locked = tickLocked(paper, block.role);
                return (
                  <li
                    key={block.role}
                    data-memos-setup-block={block.role}
                    className={cn(
                      DESIGN_TILE,
                      'space-y-4 p-4 transition-opacity',
                      !block.on && 'opacity-60',
                    )}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <span
                        className={cn(
                          'inline-flex items-center gap-2 rounded-lg px-2.5 py-1 text-[13px] font-bold',
                          ROLE_TONE[block.role],
                        )}
                      >
                        <span className={NUM}>{index + 1}</span>
                        {t(`fleet.custody.papers.roles.${block.role}`)}
                      </span>
                      <PrintedTick
                        on={block.on}
                        role={block.role}
                        label={t('fleet.custody.papers.setup.printed')}
                        title={locked ? t('fleet.custody.papers.setup.printedLocked') : undefined}
                        disabled={locked}
                        onToggle={() => setBlock(index, { on: !block.on })}
                      />
                    </div>
                    {isReviewEndorser(paper, block.role) ? (
                      <div className="space-y-4">
                        {field(
                          t('fleet.custody.papers.setup.reviewLine'),
                          signs.note,
                          setNote,
                          'note',
                          t('fleet.custody.papers.setup.reviewHint'),
                        )}
                        {field(
                          t('fleet.custody.papers.setup.nameAndTitle'),
                          block.name,
                          (name) => setBlock(index, { name }),
                          `${block.role}:name`,
                        )}
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 items-start gap-4 sm:grid-cols-2">
                        {field(
                          t('fleet.custody.papers.setup.office'),
                          block.office,
                          (office) => setBlock(index, { office }),
                          `${block.role}:office`,
                        )}
                        {field(
                          t('fleet.custody.papers.setup.name'),
                          block.name,
                          (name) => setBlock(index, { name }),
                          `${block.role}:name`,
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ol>
          </DesignSection>
        </section>

        <section
          className="min-h-0 flex-1 space-y-4 overflow-auto rounded-xl bg-slate-200 p-4 dark:bg-slate-800"
          data-memos-setup-preview={paper}
        >
          <div className="mx-auto max-w-[640px] space-y-1">
            <p className="text-sm font-semibold text-slate-600 dark:text-slate-300">
              {t('fleet.custody.papers.setup.preview', { paper: paperName })}
            </p>
            <p
              className="text-[13px] text-slate-500 dark:text-slate-400"
              data-memos-setup-preview-of={shown ? 'latest' : 'empty'}
            >
              {t(
                shown
                  ? 'fleet.custody.papers.setup.previewLatest'
                  : 'fleet.custody.papers.setup.previewEmpty',
              )}
            </p>
          </div>
          <PaperTray sheets={sheets} name={`setup-${paper}`} bare />
        </section>
      </div>
    </div>
  );
};
