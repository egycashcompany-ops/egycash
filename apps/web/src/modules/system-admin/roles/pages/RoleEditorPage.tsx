// Create, edit and duplicate a role. The permission matrix is the form — a role IS its bundle of
// grants.
//
// **A page, not a dialog.** It was a dialog, and the dialog was the problem: three hundred and
// forty-nine permissions in a scroll box inside a modal, with the administrator unable to see what
// he had ticked without scrolling back up, and no room for the tree to breathe. A role is the
// densest object this system has; it deserves the screen. «احسن شاشه دور جديد زى الديزاين اللى
// بعته» — and the design that was approved is this one: the tree on the left with room, and a
// panel on the right that says, at all times, what the role now carries.
//
// **Duplicating is CREATING, deliberately.** `?from=<id>` only pre-fills this form; the submit path
// is `POST /platform/roles`, identical to a hand-built role, so the copy passes through
// `assertKnownPermissionKeys` and `assertKeysHeld` on the server exactly as anything else does. A
// dedicated duplicate endpoint would have had to re-implement both — on the one operation whose
// entire purpose is reproducing a set of authorities in a single click.
import { useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  type CreateRole,
  type Locale,
  type PermissionDto,
  type RoleDto,
  type UpdateRole,
} from '@ecms/contracts';
import { duplicateName, duplicatePayload } from '../lib/role-duplication';
import { useT } from '../../../../platform/localization/useT';
import { useAppSelector } from '../../../../store';
import { PageContainer, PageHeader } from '../../../../platform/layout/PageContainer';
import {
  Badge,
  Button,
  Card,
  CardBody,
  ErrorState,
  LoadingState,
  toast,
} from '../../../../shared/ui';
import { Field, Input, Select, Textarea } from '../../../../shared/ui/form';
import { RolePermissionMatrix } from '../components/RolePermissionMatrix';
import {
  useCreateRole,
  usePermissionCatalog,
  usePermissionPages,
  useRole,
  useRoleGroups,
  useUpdateRole,
} from '../api/role-queries';

/** The marker the group select uses for «name a new one» — no group can be called this. */
const NEW_GROUP = '\u0000new';

export const RoleEditorPage = (): JSX.Element => {
  const t = useT();
  const navigate = useNavigate();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const { id } = useParams<{ id: string }>();
  const [sp] = useSearchParams();
  const duplicateOfId = sp.get('from');

  const editing = id !== undefined;
  const existing = useRole(editing ? id : '');
  const source = useRole(duplicateOfId ?? '');
  const role = editing ? (existing.data ?? null) : null;
  const duplicateOf = duplicateOfId === null ? null : (source.data ?? null);

  // The headings in use, read as distinct NAMES. Reading a page of roles and scraping their groups
  // would be the «bigger page to avoid paging» pattern ADR-019 rule 5 forbids, and would miss a
  // heading the moment the company has more roles than one page.
  const { data: knownGroups = [] } = useRoleGroups();

  const loading = (editing && existing.isLoading) || (duplicateOfId !== null && source.isLoading);
  const failed = (editing && existing.isError) || (duplicateOfId !== null && source.isError);

  return loading ? (
    <PageContainer>
      <LoadingState />
    </PageContainer>
  ) : failed ? (
    <PageContainer>
      <ErrorState onRetry={() => void (editing ? existing.refetch() : source.refetch())} />
    </PageContainer>
  ) : (
    <Editor
      key={role?.id ?? duplicateOf?.id ?? 'new'}
      role={role}
      duplicateOf={duplicateOf}
      knownGroups={knownGroups}
      onDone={(created) => navigate(created === null ? '/system/roles' : `/system/roles/${created.id}`)}
      t={t}
      locale={locale}
    />
  );
};

/**
 * The form itself, mounted only once its data has arrived.
 *
 * Split out so every `useState` initializer runs against the real role rather than against
 * `undefined` on the first render and a fetched role on the second — a form whose fields are
 * seeded from a prop must not mount before that prop is true, or the seeds are lost.
 */
const Editor = ({
  role,
  duplicateOf,
  knownGroups,
  onDone,
  t,
  locale,
}: {
  role: RoleDto | null;
  duplicateOf: RoleDto | null;
  knownGroups: string[];
  onDone: (created: RoleDto | null) => void;
  t: (key: string, params?: Record<string, string | number>) => string;
  locale: Locale;
}): JSX.Element => {
  const isCreate = role === null;
  const isDuplicate = isCreate && duplicateOf !== null;
  const copied = duplicateOf === null ? null : duplicatePayload(duplicateOf);

  // The suffix is a starting point, not a convention: the field stays editable, and a name the
  // administrator types over is never reconstructed from the source.
  const [nameAr, setNameAr] = useState(
    duplicateOf !== null
      ? duplicateName(duplicateOf.name.ar, t('systemAdmin.roles.form.copySuffix'))
      : (role?.name.ar ?? ''),
  );
  const [nameEn, setNameEn] = useState(
    duplicateOf !== null
      ? duplicateName(duplicateOf.name.en, t('systemAdmin.roles.form.copySuffix'))
      : (role?.name.en ?? ''),
  );
  const [description, setDescription] = useState(copied?.description ?? role?.description ?? '');
  // Organizational only: it decides which heading the role sits under in the list and grants
  // nothing. A copy keeps its source's heading, which is almost always what a duplicate wants.
  const [group, setGroup] = useState<string>(duplicateOf?.group ?? role?.group ?? '');
  const [keys, setKeys] = useState<string[]>(copied?.permissionKeys ?? role?.permissionKeys ?? []);

  const create = useCreateRole();
  const update = useUpdateRole(role?.id ?? '');
  // The registry is gated by `permission.view`, which `role.create` does not imply. Without it the
  // matrix would simply be empty and the form would refuse to save with no explanation — so the
  // page says why instead of looking broken.
  const { data: catalog = [], isError: catalogUnavailable } = usePermissionCatalog();
  // Same request as the catalog — `select` splits one response, never a second fetch (P7-A).
  const { data: pages = [] } = usePermissionPages();
  const busy = create.isPending || update.isPending;

  const toggle = (key: string, next: boolean): void => {
    setKeys((previous) =>
      next ? [...new Set([...previous, key])] : previous.filter((k) => k !== key),
    );
  };

  // The matrix's bulk controls hand back the whole next list, already filtered to what this actor
  // may grant. Nothing here re-derives it: the payload is the same `permissionKeys[]` the API has
  // always taken, and the server's guards are still what decide.
  const replaceKeys = (next: string[]): void => setKeys(next);

  /**
   * What the role carries, by screen — the panel that makes a long tree navigable.
   *
   * Grouped by PAGE rather than listed key by key, because that is the unit an administrator
   * reasons about: «الحركة · السيارات — عرض، تعديل» answers «what did I just give him» in one
   * line, where twelve permission keys do not.
   */
  const summary = useMemo(() => {
    const chosen = new Set(keys);
    const byPage = new Map<string, { label: string; actions: string[] }>();
    const pageName = new Map(pages.map((p) => [p.id, p.name[locale]]));
    for (const permission of catalog as PermissionDto[]) {
      if (!chosen.has(permission.key)) continue;
      const pageId = permission.pageId ?? '';
      const label =
        pageId === ''
          ? t('systemAdmin.roles.form.unassignedScreen')
          : (pageName.get(pageId) ?? pageId);
      const row = byPage.get(pageId) ?? { label, actions: [] };
      row.actions.push(permission.name[locale]);
      byPage.set(pageId, row);
    }
    // Keys the registry no longer declares carry no definition, so they never reach the loop
    // above. They are still on the role, and the count below counts them — the panel says «and N
    // more» rather than silently disagreeing with the number beside it.
    const named = [...byPage.values()].reduce((n, r) => n + r.actions.length, 0);
    return { rows: [...byPage.values()].sort((a, b) => a.label.localeCompare(b.label, locale)), unknown: keys.length - named };
  }, [keys, catalog, pages, locale, t]);

  const submit = (): void => {
    const name = { ar: nameAr.trim(), en: nameEn.trim() };
    const trimmedDescription = description.trim();
    if (name.ar === '' || name.en === '') {
      toast.error(t('systemAdmin.roles.form.needName'));
      return;
    }
    if (keys.length === 0) {
      toast.error(t('systemAdmin.roles.form.needPermission'));
      return;
    }
    if (isCreate) {
      const body: CreateRole = {
        name,
        permissionKeys: keys,
        group: group === '' ? null : group,
        ...(trimmedDescription === '' ? {} : { description: trimmedDescription }),
      };
      create.mutate(body, {
        onSuccess: (created) => {
          toast.success(t(isDuplicate ? 'systemAdmin.roles.duplicated' : 'systemAdmin.roles.created'));
          onDone(created);
        },
      });
      return;
    }
    const body: UpdateRole = {
      name,
      description: trimmedDescription === '' ? null : trimmedDescription,
      group: group === '' ? null : group,
      permissionKeys: keys,
      version: role.version,
    };
    update.mutate(body, {
      onSuccess: () => {
        toast.success(t('systemAdmin.roles.updated'));
        onDone(role);
      },
    });
  };

  const title = t(
    isDuplicate
      ? 'systemAdmin.roles.form.duplicateTitle'
      : isCreate
        ? 'systemAdmin.roles.form.createTitle'
        : 'systemAdmin.roles.form.editTitle',
  );

  return (
    <PageContainer>
      <PageHeader
        title={title}
        breadcrumbs={[
          { label: t('systemAdmin.module.title') },
          { label: t('systemAdmin.roles.title'), to: '/system/roles' },
          { label: title },
        ]}
      />

      <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">
        {t(isDuplicate ? 'systemAdmin.roles.form.duplicateHint' : 'systemAdmin.roles.form.hint')}
      </p>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-4">
          <Card>
            <CardBody className="space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label={t('systemAdmin.roles.form.nameAr')} required>
                  <Input dir="rtl" value={nameAr} onChange={(e) => setNameAr(e.target.value)} required />
                </Field>
                <Field label={t('systemAdmin.roles.form.nameEn')} required>
                  <Input dir="ltr" value={nameEn} onChange={(e) => setNameEn(e.target.value)} required />
                </Field>
              </div>
              <Field label={t('systemAdmin.roles.group')} hint={t('systemAdmin.roles.groupHint')}>
                <Select
                  value={group}
                  onChange={(e) => {
                    if (e.target.value !== NEW_GROUP) {
                      setGroup(e.target.value);
                      return;
                    }
                    // A heading is a name on a role, so naming one here IS creating it — there is
                    // no record to add first, and the role about to be saved is its first member.
                    const next = window.prompt(t('systemAdmin.roles.newGroupPrompt'))?.trim();
                    setGroup(next === undefined || next === '' ? '' : next);
                  }}
                >
                  <option value="">{t('systemAdmin.roles.noGroup')}</option>
                  {/* A heading typed a moment ago is not in the list yet — it lives on this role
                      alone until it saves, so it is offered here or it could not be picked back. */}
                  {[...new Set([...knownGroups, ...(group === '' ? [] : [group])])]
                    .sort((a, b) => a.localeCompare(b, locale))
                    .map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  <option value={NEW_GROUP}>{t('systemAdmin.roles.newGroupOption')}</option>
                </Select>
              </Field>
              <Field label={t('systemAdmin.roles.form.description')}>
                <Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
              </Field>
            </CardBody>
          </Card>

          <Card>
            <CardBody>
              {catalogUnavailable && (
                <p className="mb-2 text-xs text-amber-700 dark:text-amber-400">
                  {t('systemAdmin.permissions.noAccess')}
                </p>
              )}
              <RolePermissionMatrix
                catalog={catalog}
                pages={pages}
                selected={keys}
                managed={role?.managed ?? 'none'}
                onToggle={toggle}
                onBulkChange={replaceKeys}
              />
            </CardBody>
          </Card>
        </div>

        {/* Sticky: the tree is long, and the question «what does this role carry now» has to stay
            answerable at every scroll position rather than only at the top of the page. */}
        <div className="space-y-3 lg:sticky lg:top-4 lg:self-start">
          <Card>
            <CardBody className="space-y-3">
              <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                {t('systemAdmin.roles.form.carries')}
              </h2>
              <p className="text-2xl font-bold text-slate-900 dark:text-slate-50">
                {t('systemAdmin.roles.permissionCount', { count: keys.length })}
              </p>
              <div className="max-h-72 space-y-1 overflow-auto">
                {summary.rows.length === 0 && (
                  <p className="text-sm text-slate-500 dark:text-slate-400">
                    {t('systemAdmin.roles.form.carriesNothing')}
                  </p>
                )}
                {summary.rows.map((row) => (
                  <div
                    key={row.label}
                    className="flex flex-wrap items-baseline gap-x-2 border-b border-dashed border-slate-200 py-1 text-xs last:border-b-0 dark:border-slate-700"
                  >
                    <span className="font-medium text-slate-700 dark:text-slate-200">{row.label}</span>
                    <span className="text-slate-400">{row.actions.join('، ')}</span>
                  </div>
                ))}
                {summary.unknown > 0 && (
                  <Badge size="sm" tone="warning">
                    {t('systemAdmin.roles.form.carriesUnknown', { count: summary.unknown })}
                  </Badge>
                )}
              </div>
            </CardBody>
          </Card>

          <div className="flex gap-2">
            <Button className="flex-1" loading={busy} onClick={submit}>
              {t(
                isDuplicate
                  ? 'systemAdmin.roles.form.duplicate'
                  : isCreate
                    ? 'systemAdmin.roles.form.create'
                    : 'systemAdmin.roles.form.save',
              )}
            </Button>
            <Button variant="ghost" onClick={() => onDone(null)}>
              {t('common.cancel')}
            </Button>
          </div>
        </div>
      </div>
    </PageContainer>
  );
};
