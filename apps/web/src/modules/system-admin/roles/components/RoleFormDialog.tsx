// Create and edit a role. The permission matrix is the form — a role IS its bundle of grants.
//
// The matrix disables every permission the actor does not hold, because the server refuses those
// anyway: nobody hands out an authority they lack. Showing them ticked-but-locked rather than
// hiding them is deliberate — an administrator editing a role they did not create needs to see
// what it already carries, including the parts they cannot change.
import { useState } from 'react';
import { type CreateRole, type RoleDto, type UpdateRole } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { Button, Dialog, Field, Form, Input, Textarea, toast } from '../../../../shared/ui';
import { RolePermissionMatrix } from './RolePermissionMatrix';
import {
  useCreateRole,
  usePermissionCatalog,
  usePermissionPages,
  useUpdateRole,
} from '../api/role-queries';

export const RoleFormDialog = ({
  open,
  onClose,
  role,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  /** `null` creates; a role edits it. */
  role: RoleDto | null;
  onCreated?: (created: RoleDto) => void;
}): JSX.Element => {
  const t = useT();
  const [nameAr, setNameAr] = useState(role?.name.ar ?? '');
  const [nameEn, setNameEn] = useState(role?.name.en ?? '');
  const [description, setDescription] = useState(role?.description ?? '');
  const [keys, setKeys] = useState<string[]>(role?.permissionKeys ?? []);

  const isCreate = role === null;
  const create = useCreateRole();
  const update = useUpdateRole(role?.id ?? '');
  // The registry is gated by `permission.view`, which `role.create` does not imply. Without it the
  // matrix would simply be empty and the form would refuse to save with no explanation — so the
  // dialog says why instead of looking broken.
  const { data: catalog = [], isError: catalogUnavailable } = usePermissionCatalog(open);
  // Same request as the catalog — `select` splits one response, never a second fetch (P7-A).
  const { data: pages = [] } = usePermissionPages(open);
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

  const submit = (): void => {
    const name = { ar: nameAr.trim(), en: nameEn.trim() };
    const trimmedDescription = description.trim();
    if (keys.length === 0) {
      toast.error(t('systemAdmin.roles.form.needPermission'));
      return;
    }
    if (isCreate) {
      const body: CreateRole = {
        name,
        permissionKeys: keys,
        ...(trimmedDescription === '' ? {} : { description: trimmedDescription }),
      };
      create.mutate(body, {
        onSuccess: (created) => {
          toast.success(t('systemAdmin.roles.created'));
          onClose();
          onCreated?.(created);
        },
      });
      return;
    }
    const body: UpdateRole = {
      name,
      description: trimmedDescription === '' ? null : trimmedDescription,
      permissionKeys: keys,
      version: role.version,
    };
    update.mutate(body, {
      onSuccess: () => {
        toast.success(t('systemAdmin.roles.updated'));
        onClose();
      },
    });
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      title={t(
        isCreate ? 'systemAdmin.roles.form.createTitle' : 'systemAdmin.roles.form.editTitle',
      )}
      description={t('systemAdmin.roles.form.hint')}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button size="sm" loading={busy} onClick={submit}>
            {t(isCreate ? 'systemAdmin.roles.form.create' : 'systemAdmin.roles.form.save')}
          </Button>
        </div>
      }
    >
      <Form onSubmit={submit}>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label={t('systemAdmin.roles.form.nameAr')} required>
            <Input dir="rtl" value={nameAr} onChange={(e) => setNameAr(e.target.value)} required />
          </Field>
          <Field label={t('systemAdmin.roles.form.nameEn')} required>
            <Input dir="ltr" value={nameEn} onChange={(e) => setNameEn(e.target.value)} required />
          </Field>
        </div>
        <Field label={t('systemAdmin.roles.form.description')}>
          <Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>

        <div className="max-h-[45vh] overflow-auto">
          <p className="mb-2 text-sm font-medium text-slate-700 dark:text-slate-200">
            {t('systemAdmin.roles.form.permissions', { count: keys.length })}
          </p>
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
        </div>
      </Form>
    </Dialog>
  );
};
