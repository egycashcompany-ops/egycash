// /it/assets/import — «رفع جماعي» for the asset register (the owner, 2026-11-16):
//
// «في الأصول عايز زرار Bulk Upload للأصول بنفس شكل عهدة الأفرع ويكون فى Preview الأول للى هيتضاف ويوضح لو
// فى تكرار أو تضارب مع بيانات موجوده وهكذا».
//
// Three steps on one page, under `itAsset.create`:
//   1. the template («تحميل النموذج» — the custody sheets' header row and nothing else), the file,
//      the branch and «معاينة». «الفرع بيتختار من الشاشة»: the file has no branch column; the first
//      preview may go without one, and the sheet's name («عهدة فرع X») suggests it. The select
//      offers only the branches the server says `itAsset.create` reaches.
//   2. the preview: every line decided against the live register by the server — new, filled,
//      moved from another branch («يتنقل لفرع الملف»), held elsewhere and left, out of the reader's
//      reach, repeated, ambiguous … — ticked or not, and the kinds' categories. Changing a category
//      or the branch previews the SAME file again; the reviewer's ticks survive where a line still
//      means the same (`carrySelection`).
//   3. «تأكيد (n)»: the same file again with the lines kept and the preview's two hashes. A 409
//      means the register moved underneath — the preview is read again and the reader confirms
//      what they now see; nothing is ever written that was not on the screen.
//
// THE SAME `File` IS POSTED EVERY TIME and nothing is held on the server in between: the hashes
// are what prove the apply is the plan that was looked at.
import { useMemo, useState } from 'react';
import {
  IT_ASSET_IMPORT_MAX_MB,
  IT_ASSET_IMPORT_MAX_ROWS,
  type ItAssetImportDecision,
  type ItAssetImportPreviewDto,
  type ItAssetImportResultDto,
  type Locale,
} from '@ecms/contracts';
import { useAppSelector } from '../../../store';
import { useT } from '../../../platform/localization/useT';
import { PageContainer, PageHeader } from '../../../platform/layout/PageContainer';
import { Card, CardBody } from '../../../shared/ui/Card';
import { Button } from '../../../shared/ui/Button';
import { FileUpload } from '../../../shared/ui/FileUpload';
import { Field, Select } from '../../../shared/ui/form';
import { Spinner } from '../../../shared/ui/Spinner';
import { toast } from '../../../shared/ui/toast/toast-store';
import { DownloadIcon } from '../../../shared/ui/icons';
import { saveBlob } from '../../../shared/lib/api-client';
import { errorMessage } from '../../../shared/lib/errors';
import { buildXlsxBook } from '../../../shared/lib/xlsx-writer';
import { formatNumber, localized } from '../../../shared/lib/format';
import {
  useApplyItAssetImport,
  useItAssetImportBranches,
  useItBranchOptions,
  usePreviewItAssetImport,
} from '../api/it-queries';
import { AssetImportPreview } from '../components/AssetImportPreview';
import { AssetImportResult } from '../components/AssetImportResult';
import { branchMoveTargets } from '../lib/branch-move-targets';
import {
  assetImportTemplate,
  branchChangeRequest,
  carrySelection,
  importErrorText,
  isRegisterChanged,
  keptRows,
  resultEntries,
  templateFileName,
  templateSheetName,
  withKindCategory,
} from '../lib/asset-import';

const XLSX = '.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const LIMITS = { maxRows: IT_ASSET_IMPORT_MAX_ROWS, maxMb: IT_ASSET_IMPORT_MAX_MB };

export const AssetsImportPage = (): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const branches = useItBranchOptions();
  const reach = useItAssetImportBranches();
  const previewRun = usePreviewItAssetImport();
  const applyRun = useApplyItAssetImport();
  const busy = previewRun.isPending || applyRun.isPending;

  const [file, setFile] = useState<File | null>(null);
  // A new key remounts the picker, so «رفع ملف آخر» empties its list too.
  const [uploadKey, setUploadKey] = useState(0);
  const [branchId, setBranchId] = useState('');
  // Picked on the screen, or only suggested by a sheet's name — a suggestion gives way to the
  // next file's own, a pick stays.
  const [branchPicked, setBranchPicked] = useState(false);
  // The kinds the reviewer filed by hand; the server matches the others itself.
  const [kindCategories, setKindCategories] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<ItAssetImportPreviewDto | null>(null);
  // What the preview on screen was planned with — the apply sends exactly this back.
  const [planned, setPlanned] = useState<Record<string, string>>({});
  const [selection, setSelection] = useState<ReadonlySet<number>>(new Set());
  const [filter, setFilter] = useState<ItAssetImportDecision | null>(null);
  const [result, setResult] = useState<ItAssetImportResultDto | null>(null);
  const [failure, setFailure] = useState<{ text: string; detail: string | null } | null>(null);

  const branchNames = useMemo(() => {
    const map = new Map<string, { label: string; ar: string }>();
    for (const branch of branches.data ?? []) {
      map.set(branch.id, { label: localized(branch.name, locale), ar: branch.name.ar });
    }
    return map;
  }, [branches.data, locale]);
  const branchName = (id: string): string | undefined => branchNames.get(id)?.label;

  // The select offers only the branches the server says `itAsset.create` reaches — the upload
  // answers 403 for any other, and `me` carries the reach of all the account's grants, not of this
  // one. The move dialogs' rule, nothing left out: null while either list is on its way, so the
  // select waits rather than say for a moment that there is nowhere to register.
  const targets = branchMoveTargets(branches.data, reach.data?.branchIds, null);
  const noBranch = targets !== null && targets.length === 0;
  const unread = targets === null ? (reach.error ?? branches.error) : null;
  const loadingBranches = targets === null && unread === null;

  /** A new file: every decision about the last one goes with it. */
  const pick = (files: File[]): void => {
    setFile(files[0] ?? null);
    setPreview(null);
    setPlanned({});
    setKindCategories({});
    setSelection(new Set());
    setFilter(null);
    setResult(null);
    setFailure(null);
    if (!branchPicked) setBranchId('');
    previewRun.reset();
    applyRun.reset();
  };

  /**
   * Preview `input.file` — again, when `carry`: the ticks the reviewer gave lines that still mean
   * the same are kept. A refused re-run puts the selects back to what the preview on screen was
   * planned with, so they never show a plan nobody has seen.
   */
  const runPreview = (
    input: { file: File; branchId: string | null; kindCategories: Record<string, string> },
    carry: boolean,
  ): void => {
    setFailure(null);
    const before = carry && preview !== null ? { rows: preview.rows, selection } : null;
    previewRun.mutate(
      {
        file: input.file,
        request: {
          branchId: input.branchId === '' ? null : input.branchId,
          kindCategories: input.kindCategories,
        },
      },
      {
        onSuccess: (next) => {
          setSelection(carrySelection(before, next.rows));
          setPreview(next);
          setPlanned(input.kindCategories);
          setBranchId(next.branchId);
          setFilter((current) => (current !== null && next.counts[current] > 0 ? current : null));
        },
        onError: (error) => {
          const view = importErrorText(error, t, locale, LIMITS);
          setFailure(view);
          if (preview !== null) {
            // The box sits above, out of view of the select that was changed.
            toast.error(view.text);
            setBranchId(preview.branchId);
            setKindCategories(planned);
          }
        },
      },
    );
  };

  /**
   * Once a preview is on the screen, the select asks for a plan: another branch's, or — on «من
   * اسم الورقة» — the one the sheet's name suggests, previewed again WITHOUT a branch. The select
   * never rests on a choice the plan on screen is not for: «تأكيد» writes to `preview.branchId`.
   */
  const chooseBranch = (id: string): void => {
    setBranchId(id);
    setBranchPicked(id !== '');
    const request = branchChangeRequest(
      id,
      preview === null ? null : { branchId: preview.branchId, kindCategories: planned },
    );
    if (file !== null && request !== null) runPreview({ file, ...request }, true);
  };

  const chooseCategory = (kind: string, categoryId: string): void => {
    if (file === null || preview === null) return;
    const next = withKindCategory(planned, kind, categoryId);
    setKindCategories(next);
    runPreview({ file, branchId: preview.branchId, kindCategories: next }, true);
  };

  const confirm = (): void => {
    if (file === null || preview === null) return;
    const rows = keptRows(selection, preview.rows);
    if (rows.length === 0) return;
    setFailure(null);
    applyRun.mutate(
      {
        file,
        request: {
          branchId: preview.branchId,
          kindCategories: planned,
          apply: { fileSha256: preview.fileSha256, planHash: preview.planHash, rows },
        },
      },
      {
        onSuccess: (done) => {
          setResult(done);
          toast.success(
            t('it.assets.import.done.toast', {
              summary: resultEntries(done)
                .map(
                  ({ key, count }) =>
                    `${t(`it.assets.import.result.${key}`)}: ${formatNumber(count, locale)}`,
                )
                .join(t('it.assets.import.listJoin')),
            }),
          );
        },
        onError: (error) => {
          // «the register changed since the preview»: read it again, and let the reader confirm
          // what it now says — never write the old plan over the new register.
          if (isRegisterChanged(error)) {
            toast.error(t('it.assets.import.changed'));
            runPreview({ file, branchId: preview.branchId, kindCategories: planned }, true);
            return;
          }
          const view = importErrorText(error, t, locale, LIMITS);
          setFailure(view);
          toast.error(view.text);
        },
      },
    );
  };

  const again = (): void => {
    pick([]);
    setUploadKey((key) => key + 1);
  };

  /**
   * «تحميل النموذج» — named «عهدة فرع X» after the branch chosen (its Arabic name, which is what
   * the sheets are named by), so the file comes back with that branch suggested.
   */
  const downloadTemplate = (): void => {
    const sheet = templateSheetName(
      branchId === '' ? null : (branchNames.get(branchId)?.ar ?? null),
    );
    saveBlob(
      buildXlsxBook([assetImportTemplate(sheet)]),
      templateFileName(t('it.assets.import.templateFile')),
    );
  };

  return (
    <PageContainer>
      <PageHeader
        title={t('it.assets.import.title')}
        breadcrumbs={[
          { label: t('it.module.title'), to: '/it' },
          { label: t('it.nav.assets'), to: '/it/assets' },
          { label: t('it.assets.import.action') },
        ]}
      />

      <div className="space-y-4">
        <Card>
          <CardBody className="space-y-4">
            <p className="text-sm text-slate-600 dark:text-slate-300">
              {t('it.assets.import.intro')}
            </p>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <Button
                size="sm"
                variant="secondary"
                leftIcon={<DownloadIcon className="h-4 w-4" />}
                onClick={downloadTemplate}
                data-import-template
              >
                {t('it.assets.import.template')}
              </Button>
              <span className="text-xs text-slate-500 dark:text-slate-400">
                {t('it.assets.import.limits', {
                  rows: formatNumber(IT_ASSET_IMPORT_MAX_ROWS, locale),
                  mb: formatNumber(IT_ASSET_IMPORT_MAX_MB, locale),
                })}
              </span>
            </div>
            <FileUpload
              key={uploadKey}
              accept={XLSX}
              maxSizeMb={IT_ASSET_IMPORT_MAX_MB}
              onFiles={pick}
              disabled={busy}
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label={t('it.assets.import.branch')}
                hint={t('it.assets.import.branchHint')}
                error={
                  noBranch
                    ? t('it.assets.import.noBranch')
                    : unread !== null
                      ? errorMessage(unread, locale)
                      : undefined
                }
              >
                <Select
                  aria-label={t('it.assets.import.branch')}
                  value={branchId}
                  onChange={(e) => chooseBranch(e.target.value)}
                  disabled={busy || result !== null || targets === null || noBranch}
                  data-import-branch
                >
                  <option value="">
                    {loadingBranches ? t('common.loading') : t('it.assets.import.branchFromSheet')}
                  </option>
                  {(targets ?? []).map((branch) => (
                    <option key={branch.id} value={branch.id}>
                      {localized(branch.name, locale)}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            {failure !== null && (
              <div
                role="alert"
                className="rounded-lg border border-rose-300 bg-rose-50 p-3 text-sm text-rose-800 dark:border-rose-800 dark:bg-rose-950 dark:text-rose-200"
              >
                <p>{failure.text}</p>
                {failure.detail !== null && (
                  <p className="mt-1 text-xs" dir="auto">
                    {failure.detail}
                  </p>
                )}
              </div>
            )}
            <div className="flex flex-wrap items-center justify-end gap-2">
              {previewRun.isPending && (
                <span className="inline-flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
                  <Spinner className="h-4 w-4" />
                  {t('it.assets.import.reading')}
                </span>
              )}
              {/* Held while the branches are on their way, and where there is none to register in:
                  the upload would refuse it. */}
              <Button
                disabled={file === null || busy || result !== null || loadingBranches || noBranch}
                onClick={() => {
                  if (file !== null) {
                    runPreview({ file, branchId, kindCategories }, preview !== null);
                  }
                }}
                data-import-preview
              >
                {t('it.assets.import.preview')}
              </Button>
            </div>
          </CardBody>
        </Card>

        {result !== null ? (
          <AssetImportResult result={result} onAgain={again} />
        ) : (
          preview !== null && (
            <AssetImportPreview
              preview={preview}
              selection={selection}
              onSelectionChange={setSelection}
              filter={filter}
              onFilterChange={setFilter}
              categoryOf={(kind) => kindCategories[kind.kind] ?? kind.categoryId ?? ''}
              onCategoryChange={chooseCategory}
              branchName={branchName}
              busy={busy}
              confirming={applyRun.isPending}
              onConfirm={confirm}
            />
          )
        )}
      </div>
    </PageContainer>
  );
};
