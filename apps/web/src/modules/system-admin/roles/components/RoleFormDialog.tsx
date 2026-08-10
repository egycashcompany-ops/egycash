// Create, edit and duplicate a role. The permission matrix is the form — a role IS its bundle of
// grants.
//
// **Duplicating is CREATING, deliberately.** `duplicateOf` only pre-fills this form; the submit path
// is `POST /platform/roles`, identical to a hand-built role, so the copy passes through
// `assertKnownPermissionKeys` and `assertKeysHeld` on the server exactly as anything else does. A
// dedicated duplicate endpoint would have had to re-implement both — on the one operation whose
// entire purpose is reproducing a set of authorities in a single click.
//
// The matrix disables every permission the actor does not hold, because the server refuses those
// anyway: nobody hands out an authority they lack. Showing them ticked-but-locked rather than
// hiding them is deliberate — an administrator editing a role they did not create needs to see
// what it already carries, including the parts they cannot change.
import { useState } from 'react';
import { type CreateRole, type RoleDto, type UpdateRole } from '@ecms/contracts';
import { duplicateName, duplicatePayload } from '../lib/role-duplication';
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
  duplicateOf = null,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  /** `null` creates; a role edits it. */
  role: RoleDto | null;
  /**
   * Pre-fill from this role and CREATE a new one. Mutually exclusive with `role` in practice — the
   * caller passes one or the other — and it changes nothing about the submit path.
   */
  duplicateOf?: RoleDto | null;
  onCreated?: (created: RoleDto) => void;
}): JSX.Element => {
  const t = useT();
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
  const [keys, setKeys] = useState<string[]>(copied?.permissionKeys ?? role?.permissionKeys ?? []);
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
          toast.success(
            t(isDuplicate ? 'systemAdmin.roles.duplicated' : 'systemAdmin.roles.created'),
          );
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
        isDuplicate
          ? 'systemAdmin.roles.form.duplicateTitle'
          : isCreate
            ? 'systemAdmin.roles.form.createTitle'
            : 'systemAdmin.roles.form.editTitle',
      )}
      description={t(
        isDuplicate ? 'systemAdmin.roles.form.duplicateHint' : 'systemAdmin.roles.form.hint',
      )}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button size="sm" loading={busy} onClick={submit}>
            {t(
              isDuplicate
                ? 'systemAdmin.roles.form.duplicate'
                : isCreate
                  ? 'systemAdmin.roles.form.create'
                  : 'systemAdmin.roles.form.save',
            )}
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
