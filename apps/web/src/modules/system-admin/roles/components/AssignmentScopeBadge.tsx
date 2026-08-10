// The reach of one grant, in a chip — and an honest warning where that reach is not what it says.
//
// `section` and `department` are declared by only a handful of collections (users, employees, leave
// requests, vehicles). Everywhere else `scopeFilter` finds no such field on the collection and
// simply does not constrain by it, so the grant behaves as the next scope the collection DOES
// declare — in practice branch. That is a property of the data model, not a bug this screen can
// fix, so the badge says it rather than letting an administrator believe a section grant is
// narrower than it is on 25 of the 29 scoped collections.
import { type DataScope } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { Badge, type Tone } from '../../../../shared/ui';

const TONE: Record<DataScope, Tone> = {
  own: 'neutral',
  section: 'info',
  department: 'info',
  branch: 'brand',
  organization: 'success',
};

/** The scopes most collections cannot honour — see the file note. */
const WIDENS: DataScope[] = ['section', 'department'];

export const AssignmentScopeBadge = ({
  scope,
  className,
}: {
  scope: DataScope;
  className?: string;
}): JSX.Element => {
  const t = useT();
  const widens = WIDENS.includes(scope);
  return (
    <span
      className={className}
      {...(widens ? { title: t('systemAdmin.assignments.scopeWidens') } : {})}
    >
      <Badge size="sm" tone={TONE[scope]}>
        {t(`systemAdmin.assignments.scopes.${scope}`)}
        {widens && (
          <span aria-hidden className="text-amber-600 dark:text-amber-400">
            *
          </span>
        )}
      </Badge>
    </span>
  );
};
