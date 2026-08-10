// Where one permission came from — every contribution, not just the winning one.
//
// A key held through two roles at two scopes is not a duplicate: it is one answer and one also-ran,
// and which is which is the whole point. `decisive` marks the contribution that sets the effective
// reach; ties are marked on both, because when two roles both grant at the widest scope, both are
// true and picking one would be an invention.
//
// The losing and lapsed rows stay visible and dimmed rather than being dropped. "This role would
// have granted it, but the window closed in March" is the answer to the question that brought the
// administrator here, and an absent row answers nothing.
import { type EffectivePermissionSourceDto, type Locale } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { useAppSelector } from '../../../../store';
import { Badge } from '../../../../shared/ui';
import { formatDate } from '../../../../shared/lib/format';
import { cn } from '../../../../shared/lib/cn';
import { AssignmentScopeBadge } from './AssignmentScopeBadge';
import { ManagedRoleBadge } from './ManagedRoleBadge';
import { PermissionStateBadge } from './PermissionStateBadge';

export const EffectiveSourceList = ({
  sources,
  id,
}: {
  sources: EffectivePermissionSourceDto[];
  /** Ties the panel to the row's toggle for assistive technology. */
  id: string;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);

  return (
    <ul id={id} className="space-y-2">
      {sources.map((source) => (
        <li
          key={source.assignmentId}
          className={cn(
            'rounded-md border p-2 text-sm',
            source.decisive
              ? 'border-brand-200 bg-brand-50/60 dark:border-brand-900 dark:bg-brand-950/30'
              : 'border-slate-200 dark:border-slate-800',
            source.state === 'active' ? '' : 'opacity-75',
          )}
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-slate-800 dark:text-slate-100">
              {source.roleName[locale]}
            </span>
            <ManagedRoleBadge managed={source.roleManaged} />
            <AssignmentScopeBadge scope={source.scope} />
            <PermissionStateBadge state={source.state} />
            {source.decisive && (
              <Badge size="sm" tone="brand">
                {t('systemAdmin.effective.decisive')}
              </Badge>
            )}
          </div>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {source.validFrom === null && source.validTo === null
              ? t('systemAdmin.assignments.always')
              : `${source.validFrom === null ? '—' : formatDate(source.validFrom, locale)} → ${
                  source.validTo === null ? '—' : formatDate(source.validTo, locale)
                }`}
          </p>
        </li>
      ))}
    </ul>
  );
};
