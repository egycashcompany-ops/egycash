// The reach of one grant, in a chip — and an honest warning where that reach is not what it says.
//
// `section` and `department` are declared by only a handful of collections (users, employees, leave
// requests, vehicles). Everywhere else `scopeFilter` finds no such field on the collection and
// simply does not constrain by it, so the grant behaves as the next scope the collection DOES
// declare — in practice branch. That is a property of the data model, not a bug this screen can
// fix, so the badge says it rather than letting an administrator believe a section grant is
// narrower than it is on 25 of the 29 scoped collections.
import { type DataScope, type RoleAssignmentDto } from '@ecms/contracts';
import { useAppSelector } from '../../../../store';
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

/**
 * With the grant itself, the badge says WHERE the reach goes — «الحركة · المهندسين · أكتوبر» — rather
 * than only which rung of the ladder it sits on. A reader of the roles tab should be able to tell
 * what a person sees from the row, without opening anything.
 */
export const AssignmentScopeBadge = ({
  scope,
  assignment,
  className,
}: {
  scope: DataScope;
  assignment?: Pick<RoleAssignmentDto, 'branches' | 'departmentCatalog' | 'allBranches'>;
  className?: string;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state) => state.locale.locale);
  // A grant that names a company-wide department or reaches added branches is fully honoured by the
  // scope filter; the widening caveat is about the OLD single-unit department grant only.
  const hasReach =
    assignment !== undefined &&
    (assignment.departmentCatalog !== null || assignment.allBranches || assignment.branches.length > 0);
  const widens = WIDENS.includes(scope) && !hasReach;
  return (
    <span
      className={`inline-flex flex-wrap items-center gap-1 ${className ?? ''}`}
      {...(widens ? { title: t('systemAdmin.assignments.scopeWidens') } : {})}
    >
      {assignment?.departmentCatalog ? (
        <Badge size="sm" tone="info">
          {assignment.departmentCatalog.name[locale]}
        </Badge>
      ) : (
        <Badge size="sm" tone={TONE[scope]}>
          {t(`systemAdmin.assignments.scopes.${scope}`)}
          {widens && (
            <span aria-hidden className="text-amber-600 dark:text-amber-400">
              *
            </span>
          )}
        </Badge>
      )}
      {assignment?.allBranches && (
        <Badge size="sm" tone="success">
          {t('systemAdmin.assignments.reaches.all')}
        </Badge>
      )}
      {!assignment?.allBranches &&
        assignment?.branches.map((b) => (
          <Badge key={b.id} size="sm" tone="brand">
            {b.name[locale]}
          </Badge>
        ))}
    </span>
  );
};
