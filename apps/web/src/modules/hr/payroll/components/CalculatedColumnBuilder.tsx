// Composing a calculated column (scope B1) — a structure, never a string.
//
// THERE IS NO TEXT FIELD HERE, AND THAT IS THE WHOLE DESIGN. P-HR-24 chose a described AST over an
// expression language precisely so nothing would ever need to parse what a person typed (D-EXPR-3).
// A screen that offered `amountMinor / lineCount` as text would put that parser back — in the
// browser first, and in the server the moment somebody wanted the same convenience there.
//
// So each side of a column is either a FIELD chosen from the catalog or a NUMBER typed into a
// number input, and the operation is chosen from the four the engine has. What leaves this file is
// already a valid tree; the server validates it again against the row catalog, because a screen is
// not an authority.
import {
  EXPRESSION_BINARY_OPS,
  type ExpressionNode,
  type PayrollReportColumn,
} from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';

/** What a calculated column may name: the measures of its own row, plus the major-unit form. */
export const COLUMN_FIELDS = ['lineCount', 'amountMinor', 'amount'] as const;
export type ColumnField = (typeof COLUMN_FIELDS)[number];

/** One side of a column, as the screen holds it before it becomes a node. */
export interface OperandDraft {
  kind: 'field' | 'literal';
  field: ColumnField;
  value: number;
}

export interface ColumnDraft {
  key: string;
  left: OperandDraft;
  op: (typeof EXPRESSION_BINARY_OPS)[number];
  right: OperandDraft;
}

export const emptyOperand = (): OperandDraft => ({
  kind: 'field',
  field: 'amountMinor',
  value: 0,
});

export const emptyColumn = (): ColumnDraft => ({
  key: '',
  left: emptyOperand(),
  op: 'divide',
  right: { kind: 'field', field: 'lineCount', value: 0 },
});

const toNode = (operand: OperandDraft): ExpressionNode =>
  operand.kind === 'field'
    ? { kind: 'field', path: operand.field }
    : { kind: 'literal', value: operand.value };

/** A draft as the tree the contract accepts. Always a binary node — see the header. */
export const toColumn = (draft: ColumnDraft): PayrollReportColumn => ({
  key: draft.key,
  expression: {
    kind: 'binary',
    op: draft.op,
    left: toNode(draft.left),
    right: toNode(draft.right),
  },
});

/** A stored column back into a draft, so an edit starts where the author left off. */
export const toDraft = (column: PayrollReportColumn): ColumnDraft => {
  const node = column.expression;
  const side = (operand: ExpressionNode): OperandDraft =>
    operand.kind === 'field'
      ? { kind: 'field', field: operand.path as ColumnField, value: 0 }
      : { kind: 'literal', field: 'amountMinor', value: operand.kind === 'literal' ? operand.value : 0 };

  if (node.kind !== 'binary') return { ...emptyColumn(), key: column.key };
  return { key: column.key, left: side(node.left), op: node.op, right: side(node.right) };
};

const Operand = ({
  operand,
  onChange,
}: {
  operand: OperandDraft;
  onChange: (next: OperandDraft) => void;
}): JSX.Element => {
  const t = useT();
  return (
    <span className="inline-flex items-center gap-1">
      <select
        className="rounded border border-slate-300 px-1 py-0.5 text-xs dark:border-slate-600 dark:bg-slate-800"
        value={operand.kind}
        onChange={(event) => {
          onChange({ ...operand, kind: event.target.value as 'field' | 'literal' });
        }}
        aria-label={t('payroll.reports.operandKind')}
      >
        <option value="field">{t('payroll.reports.operandField')}</option>
        <option value="literal">{t('payroll.reports.operandNumber')}</option>
      </select>
      {operand.kind === 'field' ? (
        <select
          className="rounded border border-slate-300 px-1 py-0.5 text-xs dark:border-slate-600 dark:bg-slate-800"
          value={operand.field}
          onChange={(event) => {
            onChange({ ...operand, field: event.target.value as ColumnField });
          }}
          aria-label={t('payroll.reports.operandField')}
        >
          {/* Every field stays offered even when the report did not select that measure: the
              pipeline totals both regardless, so a column may name either. */}
          {COLUMN_FIELDS.map((field) => (
            <option key={field} value={field}>
              {t(`payroll.reports.field.${field}`)}
            </option>
          ))}
        </select>
      ) : (
        <input
          type="number"
          className="w-24 rounded border border-slate-300 px-1 py-0.5 text-xs dark:border-slate-600 dark:bg-slate-800"
          value={operand.value}
          onChange={(event) => {
            onChange({ ...operand, value: Number(event.target.value) });
          }}
          aria-label={t('payroll.reports.operandNumber')}
        />
      )}
    </span>
  );
};

export const CalculatedColumnBuilder = ({
  columns,
  onChange,
}: {
  columns: ColumnDraft[];
  onChange: (next: ColumnDraft[]) => void;
}): JSX.Element => {
  const t = useT();
  const replace = (index: number, next: ColumnDraft): void => {
    onChange(columns.map((column, i) => (i === index ? next : column)));
  };

  return (
    <div className="space-y-2">
      <h4 className="text-xs font-medium text-slate-500">{t('payroll.reports.columns')}</h4>
      {columns.map((column, index) => (
        <div key={index} className="flex flex-wrap items-center gap-2 text-xs">
          <input
            className="w-32 rounded border border-slate-300 px-1 py-0.5 dark:border-slate-600 dark:bg-slate-800"
            value={column.key}
            placeholder={t('payroll.reports.columnKey')}
            onChange={(event) => {
              replace(index, { ...column, key: event.target.value });
            }}
            aria-label={t('payroll.reports.columnKey')}
          />
          <span>=</span>
          <Operand
            operand={column.left}
            onChange={(left) => {
              replace(index, { ...column, left });
            }}
          />
          <select
            className="rounded border border-slate-300 px-1 py-0.5 dark:border-slate-600 dark:bg-slate-800"
            value={column.op}
            onChange={(event) => {
              replace(index, { ...column, op: event.target.value as ColumnDraft['op'] });
            }}
            aria-label={t('payroll.reports.operation')}
          >
            {EXPRESSION_BINARY_OPS.map((op) => (
              <option key={op} value={op}>
                {t(`payroll.reports.op.${op}`)}
              </option>
            ))}
          </select>
          <Operand
            operand={column.right}
            onChange={(right) => {
              replace(index, { ...column, right });
            }}
          />
          <button
            type="button"
            className="text-slate-400 hover:text-red-600"
            onClick={() => {
              onChange(columns.filter((_, i) => i !== index));
            }}
          >
            {t('common.remove')}
          </button>
        </div>
      ))}
      <button
        type="button"
        className="rounded border border-slate-300 px-2 py-1 text-xs dark:border-slate-600"
        onClick={() => {
          onChange([...columns, emptyColumn()]);
        }}
      >
        {t('payroll.reports.addColumn')}
      </button>
    </div>
  );
};
