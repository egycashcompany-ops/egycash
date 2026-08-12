// The organize board: one module's sections and the pages inside them, arranged by dragging.
//
// WHY THERE IS NO ORDER FIELD. Ordering used to be a number an administrator typed into a form,
// which meant knowing what every sibling's number was and leaving gaps for the future. Here the
// only thing anybody edits is POSITION: drop a row where it should read, and the server renumbers
// the bucket from the list it receives. Nothing renumbers by hand, and sending the same list twice
// is the same result twice.
//
// DRAG IS NOT THE ONLY WAY. Every row also has Up/Down buttons and a section picker. A drag is a
// pointer gesture with no keyboard equivalent, so on its own it would put reordering out of reach
// for anyone not using a mouse — the buttons are the same two writes through an accessible door.
import { useMemo, useState } from 'react';
import { type ApplicationDto, type ApplicationSectionDto, type Locale } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { useAppSelector } from '../../../../store';
import { Can } from '../../../../platform/rbac/Can';
import { PageContainer, PageHeader } from '../../../../platform/layout/PageContainer';
import { Button, EmptyState } from '../../../../shared/ui';
import { Dialog } from '../../../../shared/ui/Dialog';
import { Field, Input, Select } from '../../../../shared/ui/form';
import { LoadingState } from '../../../../shared/ui/states/LoadingState';
import { toast } from '../../../../shared/ui/toast/toast-store';
import { localized } from '../../../../shared/lib/format';
import { useApplicationCategoryOptions } from '../../application-categories/application-category-queries';
import { useApplications } from '../../applications/application-queries';
import {
  useApplicationSections,
  useCreateApplicationSection,
  useDeleteApplicationSection,
  useReorderApplications,
  useReorderApplicationSections,
  useUpdateApplicationSection,
} from '../application-section-queries';
import { bucketKey, dropInto, dropSection, moveBy, moveSection, type BucketId } from '../organize-board';

/** What the pointer is carrying, and where it came from. */
interface Drag {
  kind: 'section' | 'application';
  id: string;
  bucket: BucketId;
}

const RowShell = ({
  children,
  onDragStart,
  onDragOver,
  onDrop,
  label,
}: {
  children: React.ReactNode;
  onDragStart: () => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: () => void;
  label: string;
}): JSX.Element => (
  <div
    draggable
    onDragStart={onDragStart}
    onDragOver={onDragOver}
    onDrop={onDrop}
    aria-label={label}
    className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
  >
    <span aria-hidden className="cursor-grab select-none text-slate-400">
      ↕
    </span>
    {children}
  </div>
);

export const OrganizeApplicationsPage = (): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const categories = useApplicationCategoryOptions();
  const [categoryId, setCategoryId] = useState('');
  const [drag, setDrag] = useState<Drag | null>(null);
  const [renaming, setRenaming] = useState<ApplicationSectionDto | null>(null);
  const [adding, setAdding] = useState(false);

  // The first category is the default view, so the screen opens on something rather than on a
  // prompt to choose. `??` rather than a truthiness check: an id is never an empty string here.
  const activeCategoryId = categoryId === '' ? (categories.data?.[0]?.id ?? '') : categoryId;

  const sections = useApplicationSections({ categoryId: activeCategoryId, pageSize: 200 });
  const applications = useApplications({ categoryId: activeCategoryId, pageSize: 500 });
  const reorderSections = useReorderApplicationSections();
  const reorderApps = useReorderApplications();
  const createSection = useCreateApplicationSection();
  const updateSection = useUpdateApplicationSection();
  const deleteSection = useDeleteApplicationSection();

  const sectionRows = useMemo(
    () => [...(sections.data?.items ?? [])].sort((a, b) => a.sortOrder - b.sortOrder),
    [sections.data],
  );
  const appRows = useMemo(
    () => [...(applications.data?.items ?? [])].sort((a, b) => a.sortOrder - b.sortOrder),
    [applications.data],
  );

  const board = useMemo(() => {
    const buckets: Record<string, string[]> = { '': [] };
    for (const section of sectionRows) buckets[section.id] = [];
    for (const app of appRows) {
      const key = bucketKey(app.sectionId);
      (buckets[key] ??= []).push(app.id);
    }
    return { buckets };
  }, [sectionRows, appRows]);

  const appById = useMemo(
    () => new Map(appRows.map((a): [string, ApplicationDto] => [a.id, a])),
    [appRows],
  );

  const sendSectionOrder = (sectionIds: string[]): void => {
    reorderSections.mutate(
      { categoryId: activeCategoryId, sectionIds },
      { onSuccess: () => toast.success(t('organization.sections.saved')) },
    );
  };

  const sendBucket = (bucket: BucketId, applicationIds: string[]): void => {
    reorderApps.mutate(
      { categoryId: activeCategoryId, sectionId: bucket, applicationIds },
      { onSuccess: () => toast.success(t('organization.sections.saved')) },
    );
  };

  /** A drop resolves to one write per affected bucket — two when the row crossed a boundary. */
  const applyDrop = (target: BucketId, index: number | null): void => {
    if (drag === null || drag.kind !== 'application') return;
    const result = dropInto(board, drag.id, drag.bucket, target, index);
    setDrag(null);
    if (bucketKey(result.source) === bucketKey(result.target)) {
      sendBucket(result.target, result.targetIds);
      return;
    }
    sendBucket(result.source, result.sourceIds);
    sendBucket(result.target, result.targetIds);
  };

  const nudgeApp = (bucket: BucketId, id: string, delta: -1 | 1): void => {
    sendBucket(bucket, moveBy(board.buckets[bucketKey(bucket)] ?? [], id, delta));
  };

  const moveToSection = (app: ApplicationDto, target: BucketId): void => {
    const result = dropInto(board, app.id, app.sectionId, target, null);
    sendBucket(result.source, result.sourceIds);
    sendBucket(result.target, result.targetIds);
  };

  const renderApps = (bucket: BucketId): JSX.Element => {
    const ids = board.buckets[bucketKey(bucket)] ?? [];
    return (
      <ul
        className="mt-2 space-y-1 ps-6"
        onDragOver={(e) => e.preventDefault()}
        onDrop={() => applyDrop(bucket, null)}
      >
        {ids.length === 0 && (
          <li className="rounded-lg border border-dashed border-slate-300 px-3 py-2 text-xs text-slate-400 dark:border-slate-700">
            {t('organization.sections.dropHere')}
          </li>
        )}
        {ids.map((id, index) => {
          const app = appById.get(id);
          if (app === undefined) return null;
          return (
            <li key={id}>
              <RowShell
                label={localized(app.name, locale)}
                onDragStart={() => setDrag({ kind: 'application', id, bucket })}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => applyDrop(bucket, index)}
              >
                <span className="flex-1 truncate">{localized(app.name, locale)}</span>
                <span className="font-mono text-xs text-slate-400" dir="ltr">
                  {app.route}
                </span>
                <Can permission="application.edit">
                  <span className="flex items-center gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={t('organization.sections.moveUp')}
                      onClick={() => nudgeApp(bucket, id, -1)}
                    >
                      ↑
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={t('organization.sections.moveDown')}
                      onClick={() => nudgeApp(bucket, id, 1)}
                    >
                      ↓
                    </Button>
                    <Select
                      aria-label={t('organization.sections.moveTo')}
                      value={app.sectionId ?? ''}
                      onChange={(e) => moveToSection(app, e.target.value === '' ? null : e.target.value)}
                    >
                      <option value="">{t('organization.sections.noSection')}</option>
                      {sectionRows.map((section) => (
                        <option key={section.id} value={section.id}>
                          {localized(section.name, locale)}
                        </option>
                      ))}
                    </Select>
                  </span>
                </Can>
              </RowShell>
            </li>
          );
        })}
      </ul>
    );
  };

  if (categories.isLoading) return <LoadingState />;

  return (
    <PageContainer>
      <PageHeader
        title={t('organization.sections.title')}
        description={t('organization.sections.subtitle')}
        breadcrumbs={[
          { label: t('organization.module.title'), to: '/organization' },
          { label: t('organization.sections.title') },
        ]}
        actions={
          <Can permission="applicationCategory.create">
            <Button size="sm" onClick={() => setAdding(true)}>
              {t('organization.sections.add')}
            </Button>
          </Can>
        }
      />

      <div className="mb-4 max-w-xs">
        <Field label={t('organization.sections.module')}>
          <Select
            value={activeCategoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            aria-label={t('organization.sections.module')}
          >
            {(categories.data ?? []).map((category) => (
              <option key={category.id} value={category.id}>
                {localized(category.name, locale)}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      {sections.isLoading || applications.isLoading ? (
        <LoadingState />
      ) : (
        <div className="space-y-6">
          {/* The unsectioned bucket is FIRST and always present — it is where a page lives when
              nobody has grouped it, and it must be a visible drop target, not a hidden state. */}
          <section>
            <h3 className="text-sm font-semibold text-slate-500 dark:text-slate-400">
              {t('organization.sections.ungrouped')}
            </h3>
            {renderApps(null)}
          </section>

          {sectionRows.length === 0 ? (
            <EmptyState title={t('organization.sections.empty')} />
          ) : (
            sectionRows.map((section, index) => (
              <section key={section.id}>
                <RowShell
                  label={localized(section.name, locale)}
                  onDragStart={() => setDrag({ kind: 'section', id: section.id, bucket: null })}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => {
                    if (drag?.kind !== 'section') return;
                    const ids = dropSection(
                      sectionRows.map((s) => s.id),
                      drag.id,
                      index,
                    );
                    setDrag(null);
                    sendSectionOrder(ids);
                  }}
                >
                  <span className="flex-1 truncate font-semibold">
                    {localized(section.name, locale)}
                  </span>
                  <Can permission="applicationCategory.edit">
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={t('organization.sections.moveUp')}
                      onClick={() =>
                        sendSectionOrder(moveSection(sectionRows.map((s) => s.id), section.id, -1))
                      }
                    >
                      ↑
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={t('organization.sections.moveDown')}
                      onClick={() =>
                        sendSectionOrder(moveSection(sectionRows.map((s) => s.id), section.id, 1))
                      }
                    >
                      ↓
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => setRenaming(section)}>
                      {t('organization.sections.rename')}
                    </Button>
                  </Can>
                  <Can permission="applicationCategory.delete">
                    <Button
                      size="sm"
                      variant="ghost"
                      loading={deleteSection.isPending}
                      onClick={() =>
                        deleteSection.mutate(section.id, {
                          onSuccess: () => toast.success(t('organization.sections.deleted')),
                        })
                      }
                    >
                      {t('common.delete')}
                    </Button>
                  </Can>
                </RowShell>
                {renderApps(section.id)}
              </section>
            ))
          )}
        </div>
      )}

      {(adding || renaming !== null) && (
        <SectionDialog
          section={renaming}
          categoryId={activeCategoryId}
          onClose={() => {
            setAdding(false);
            setRenaming(null);
          }}
          onCreate={(name) =>
            createSection.mutate(
              { name, categoryId: activeCategoryId },
              {
                onSuccess: () => {
                  toast.success(t('organization.sections.created'));
                  setAdding(false);
                },
              },
            )
          }
          onRename={(id, name, version) =>
            updateSection.mutate(
              { id, body: { name, version } },
              {
                onSuccess: () => {
                  toast.success(t('organization.sections.renamed'));
                  setRenaming(null);
                },
              },
            )
          }
          pending={createSection.isPending || updateSection.isPending}
        />
      )}
    </PageContainer>
  );
};

/** Create or rename — both are the same two bilingual fields, so they are the same dialog. */
const SectionDialog = ({
  section,
  onClose,
  onCreate,
  onRename,
  pending,
}: {
  section: ApplicationSectionDto | null;
  categoryId: string;
  onClose: () => void;
  onCreate: (name: { ar: string; en: string }) => void;
  onRename: (id: string, name: { ar: string; en: string }, version: number) => void;
  pending: boolean;
}): JSX.Element => {
  const t = useT();
  const [ar, setAr] = useState(section?.name.ar ?? '');
  const [en, setEn] = useState(section?.name.en ?? '');
  const invalid = ar.trim() === '' || en.trim() === '';

  const submit = (): void => {
    if (invalid) return;
    const name = { ar: ar.trim(), en: en.trim() };
    if (section === null) onCreate(name);
    else onRename(section.id, name, section.version);
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={section === null ? t('organization.sections.add') : t('organization.sections.rename')}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button onClick={submit} loading={pending} disabled={invalid}>
            {t('common.save')}
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        <Field label={t('organization.sections.nameAr')}>
          <Input value={ar} onChange={(e) => setAr(e.target.value)} aria-label={t('organization.sections.nameAr')} />
        </Field>
        <Field label={t('organization.sections.nameEn')}>
          <Input value={en} onChange={(e) => setEn(e.target.value)} aria-label={t('organization.sections.nameEn')} />
        </Field>
      </div>
    </Dialog>
  );
};
