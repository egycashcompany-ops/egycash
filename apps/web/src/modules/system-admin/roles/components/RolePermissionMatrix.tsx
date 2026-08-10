// A role's grants, against the whole registry, grouped by the module that declares them.
//
// Three things this component refuses to hide, because each one is a decision an administrator has
// to be able to see:
//
//   • **A grant the actor does not hold is DISABLED, with the reason on it.** The server refuses it
//     anyway (nobody hands out an authority they lack), so a checkbox that looked available would
//     be a promise the save breaks. Disabled-and-explained is the honest rendering.
//   • **A key the registry does not know is shown as Unknown**, still ticked, and still removable.
//     Roles keep keys a retired module used to declare; pretending they are not there would make an
//     administrator unable to clean them up, and dropping them silently on save would be worse.
//   • **A managed role is read-only throughout.** Editing a `hr-only:*` derivative is not merely
//     unwise — the next boot restores it — so the whole matrix is inert rather than lying.
import { useMemo } from 'react';
import { type Locale, type PermissionDto, type RoleManagement } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { useAppSelector } from '../../../../store';
import { useCan } from '../../../../platform/rbac/Can';
import { Badge, Card, CardBody, CardHeader, Checkbox } from '../../../../shared/ui';

export interface MatrixRow {
  key: string;
  /** Absent for a key the registry no longer knows. */
  definition: PermissionDto | undefined;
}

/** The registry plus whatever the role carries that the registry has forgotten. */
export const matrixRows = (
  catalog: PermissionDto[],
  roleKeys: readonly string[],
): Map<string, MatrixRow[]> => {
  const byKey = new Map(catalog.map((p) => [p.key, p]));
  const groups = new Map<string, MatrixRow[]>();
  for (const permission of catalog) {
    const rows = groups.get(permission.moduleId) ?? [];
    rows.push({ key: permission.key, definition: permission });
    groups.set(permission.moduleId, rows);
  }
  const orphans = roleKeys.filter((key) => !byKey.has(key));
  if (orphans.length > 0) {
    groups.set(
      'unknown',
      orphans.map((key) => ({ key, definition: undefined })),
    );
  }
  return groups;
};

export const RolePermissionMatrix = ({
  catalog,
  selected,
  managed,
  onToggle,
}: {
  catalog: PermissionDto[];
  selected: readonly string[];
  managed: RoleManagement;
  /** Absent = read-only. */
  onToggle?: ((key: string, next: boolean) => void) | undefined;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const can = useCan();

  const groups = useMemo(() => matrixRows(catalog, selected), [catalog, selected]);
  const readOnly = onToggle === undefined || managed !== 'none';
  const chosen = new Set(selected);

  return (
    <div className="space-y-4">
      {readOnly && managed !== 'none' ? (
        <p className="text-xs text-amber-700 dark:text-amber-400">
          {t(`systemAdmin.roles.readOnly.${managed}`)}
        </p>
      ) : (
        !readOnly && (
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {t('systemAdmin.roles.notHeldHint')}
          </p>
        )
      )}
      {[...groups.entries()].map(([moduleId, rows]) => (
        <Card key={moduleId}>
          <CardHeader
            title={t(`systemAdmin.roles.module.${moduleId}`)}
            description={t('systemAdmin.roles.moduleCount', { count: rows.length })}
          />
          <CardBody>
            <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {rows.map((row) => {
                const held = can(row.key);
                const unknown = row.definition === undefined;
                // Grantable only when the actor holds it — the same rule the server applies.
                const disabled = readOnly || unknown || !held;
                return (
                  <li
                    key={row.key}
                    className={`min-w-0 rounded-md p-2 ${disabled ? 'opacity-70' : 'hover:bg-slate-50 dark:hover:bg-slate-800'}`}
                  >
                    <Checkbox
                      label={row.definition?.name[locale] ?? row.key}
                      checked={chosen.has(row.key)}
                      disabled={disabled}
                      onChange={(e) => onToggle?.(row.key, e.target.checked)}
                      className="items-start"
                    />
                    <p className="ms-6 truncate font-mono text-[11px] text-slate-400" dir="ltr">
                      {row.key}
                    </p>
                    <div className="ms-6 mt-0.5 flex flex-wrap gap-1">
                      {unknown && (
                        <Badge size="sm" tone="warning">
                          {t('systemAdmin.roles.unknownKey')}
                        </Badge>
                      )}
                      {row.definition?.breakGlass === true && (
                        <Badge size="sm" tone="danger">
                          {t('systemAdmin.roles.breakGlass')}
                        </Badge>
                      )}
                      {!readOnly && !held && !unknown && (
                        <Badge size="sm" tone="neutral">
                          {t('systemAdmin.roles.notHeld')}
                        </Badge>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </CardBody>
        </Card>
      ))}
    </div>
  );
};
