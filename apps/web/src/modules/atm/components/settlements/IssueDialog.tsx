// «اعتماد الخطة» (§9.4, §6.5 S18, DS-10, DS-11): the draft lines are issued together and get
// consecutive Note numbers. Warnings are shown grouped by code (and cassette, for a cassette's
// warning), each with the lines it concerns, and are confirmed by issuing; errors
// block — the confirm stays disabled while any line has one. When the server finds an error the
// page did not (a machine archived meanwhile), its 422 reopens this dialog with those lines.
import { type AtmPlanLineDto, type AtmPlanLineIssueCode, type Locale } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { formatNumber } from '../../../../shared/lib/format';
import { Button } from '../../../../shared/ui/Button';
import { SettlementDialog } from './SettlementDialog';
import { issueText, lineCode } from '../../lib/settlement-view';

/** An error the server reported for one of the lines sent (`details[i] = { field: 'lines[k]' }`). */
export interface ServerIssue {
  lineId: string;
  code: AtmPlanLineIssueCode;
}

interface Group {
  key: string;
  text: string;
  codes: string[];
}

const groupsOf = (
  lines: readonly AtmPlanLineDto[],
  severity: 'error' | 'warning',
  extra: readonly ServerIssue[],
  t: (key: string, params?: Record<string, string | number>) => string,
): Group[] => {
  const groups = new Map<string, Group>();
  const add = (line: AtmPlanLineDto, code: AtmPlanLineIssueCode, slot?: number): void => {
    // A slot issue names its cassette, so it is grouped by code AND cassette.
    const key = `${code}:${String(slot ?? '')}`;
    const group = groups.get(key) ?? {
      key,
      text: issueText({ code, severity, ...(slot === undefined ? {} : { slot }) }, t),
      codes: [],
    };
    const name = lineCode(line);
    if (!group.codes.includes(name)) group.codes.push(name);
    groups.set(key, group);
  };
  for (const line of lines) {
    for (const issue of line.issues) {
      if (issue.severity === severity) add(line, issue.code, issue.slot);
    }
  }
  if (severity === 'error') {
    for (const issue of extra) {
      const line = lines.find((l) => l.id === issue.lineId);
      if (line !== undefined) add(line, issue.code);
    }
  }
  return [...groups.values()];
};

export const IssueDialog = ({
  open,
  lines,
  serverIssues,
  locale,
  busy,
  onConfirm,
  onClose,
}: {
  open: boolean;
  /** The plan's draft lines, the ones the issue sends. */
  lines: readonly AtmPlanLineDto[];
  serverIssues: readonly ServerIssue[];
  locale: Locale;
  busy: boolean;
  onConfirm: () => void;
  onClose: () => void;
}): JSX.Element => {
  const t = useT();
  const errors = groupsOf(lines, 'error', serverIssues, t);
  const warnings = groupsOf(lines, 'warning', [], t);
  const list = (groups: readonly Group[], tone: string, kind: string): JSX.Element => (
    <ul className="space-y-2" data-issue-groups={kind}>
      {groups.map((group) => (
        <li key={group.key} className="text-sm">
          <span className={tone}>{group.text}</span>{' '}
          <span dir="ltr" className="text-slate-500 dark:text-slate-400">
            ({group.codes.join(', ')})
          </span>
        </li>
      ))}
    </ul>
  );
  return (
    <SettlementDialog
      open={open}
      onClose={onClose}
      title={t('atm.plan.issue.title')}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            loading={busy}
            disabled={lines.length === 0 || errors.length > 0}
            onClick={onConfirm}
          >
            {t('atm.plan.issue.confirm')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-slate-700 dark:text-slate-200">
          {t('atm.plan.issue.count', { n: formatNumber(lines.length, locale) })}
        </p>
        {errors.length > 0 && (
          <section className="space-y-2">
            <h3 className="text-sm font-semibold text-red-700 dark:text-red-400">
              {t('atm.plan.issue.errors')}
            </h3>
            {list(errors, 'text-red-700 dark:text-red-400', 'errors')}
          </section>
        )}
        {warnings.length > 0 && (
          <section className="space-y-2">
            <h3 className="text-sm font-semibold text-amber-700 dark:text-amber-400">
              {t('atm.plan.issue.warnings')}
            </h3>
            {list(warnings, 'text-amber-800 dark:text-amber-300', 'warnings')}
          </section>
        )}
      </div>
    </SettlementDialog>
  );
};
