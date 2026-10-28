// The register's CSV export (DEC-17, spec §5.9) — streamed like the attendance export (a lean
// cursor, `drainingWriter`, audited after the stream), because a server-side export is the only
// kind that is audited and the only kind that can keep the K/S columns on the server.
//
// P-class columns ONLY, for everybody — viewSecrets holders included: key codes, both notes columns
// and the combination never leave in a file, whose copies nobody can audit. The headers are the
// workbook's own texts (newlines → spaces) so the file reads like the sheet it replaces, plus a
// derived `Status` and DEC-37's `Data incomplete` («بيانات ناقصة»: `yes` / `no`) — the export
// inherits the list's filters, `incomplete` included, so Efficiency can take the rows still to be
// completed away in a file. Every cell passes the formula-injection guard before `csvEscape`: a
// cell an Excel user opens must never run as a formula.
import { type Response } from 'express';
import {
  ATM_REGISTER_COLUMNS,
  type AtmRegisterField,
  type ExportAtmRegisterEntriesQuery,
} from '@ecms/contracts';
import { auditService } from '../../../platform/audit';
import { csvEscape } from '../../../platform/audit/audit.export';
import { scopeSelector, type AuthContext } from '../../../shared/types';
import { drainingWriter } from '../../../shared/utils/draining-writer';
import { isHeadRequest, streamRows, type StreamedRows } from '../../../shared/utils/stream-rows';
import { cairoDateString } from '../shared/cairo-time';
import { registerDateString } from './register.mapper';
import { AtmRegisterEntryModel, type AtmRegisterEntryDoc } from './register.model';
import { registerScopeMatch } from './register.repository';
import { resolveRegisterSettings, type RegisterSettings } from './register-settings';
import { atmRegisterService } from './register.service';

/** The P-class columns in A..AW order: A..I, R..AM, AP, AQ, AR, AS, AT, AV, AW. */
const EXPORT_COLUMNS = ATM_REGISTER_COLUMNS.filter((column) => column.sensitivity === 'P');

export const REGISTER_EXPORT_HEADERS: readonly string[] = [
  ...EXPORT_COLUMNS.map((column) => column.header.replace(/\r?\n/g, ' ')),
  'Status',
  'Data incomplete',
];

/**
 * DEC-17: a cell that starts with `= + - @ TAB CR` is prefixed with `'` so a spreadsheet shows it
 * as text — except a lone `-` and a plain number (`-5` is a value, not a formula).
 */
export const guardCsvFormula = (value: string): string => {
  if (value === '' || value === '-') return value;
  if (!/^[=+\-@\t\r]/.test(value)) return value;
  if (/^[+-]?\d+(\.\d+)?$/.test(value)) return value;
  return `'${value}`;
};

const cellOf = (
  doc: AtmRegisterEntryDoc,
  field: AtmRegisterField,
  settings: RegisterSettings,
): string => {
  if (field === 'branchCode') {
    return doc.branchId === null ? '' : (settings.codeByBranchId.get(String(doc.branchId)) ?? '');
  }
  if (field === 'startDate') return registerDateString(doc.startDate) ?? '';
  if (field === 'endDate') return registerDateString(doc.endDate) ?? '';
  if (field.startsWith('cassettes.')) {
    const key = field.slice('cassettes.'.length) as keyof AtmRegisterEntryDoc['cassettes'];
    return (doc.cassettes as Partial<AtmRegisterEntryDoc['cassettes']> | undefined)?.[key] ?? '';
  }
  const value = (doc as unknown as Record<string, unknown>)[field];
  return typeof value === 'string' ? value : '';
};

export const registerRowToCsv = (doc: AtmRegisterEntryDoc, settings: RegisterSettings): string =>
  [
    ...EXPORT_COLUMNS.map((column) => cellOf(doc, column.field, settings)),
    doc.status,
    doc.dataIncomplete === true ? 'yes' : 'no',
  ]
    .map((cell) => csvEscape(guardCsvFormula(cell)))
    .join(',');

export const streamRegisterExport = async (
  res: Response,
  ctx: AuthContext,
  query: ExportAtmRegisterEntriesQuery,
): Promise<void> => {
  // The cursor reads the model directly, so it applies the SAME match the repository would
  // (DEC-29) — a department-scoped exporter gets their branch, never the company.
  const scope = registerScopeMatch(scopeSelector(ctx, 'atmRegister.export'));
  const filter = {
    $and: [{ isDeleted: false }, scope, atmRegisterService.buildFilter(query)].filter(
      (clause) => Object.keys(clause).length > 0,
    ),
  };
  const settings = await resolveRegisterSettings();

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="atm-register-${cairoDateString(new Date())}.csv"`,
  );
  res.setHeader('Cache-Control', 'private, no-store');

  // A HEAD request gets the headers alone: see `isHeadRequest`.
  if (isHeadRequest(res)) {
    res.end();
    return;
  }

  // Made before the first write: see `drainingWriter`. A false from it means the client has gone,
  // and the export stops reading the cursor.
  const write = drainingWriter(res);
  let outcome: StreamedRows = { rowCount: 0, completed: false };
  if (await write(`\uFEFF${REGISTER_EXPORT_HEADERS.map(csvEscape).join(',')}\n`)) {
    const cursor = AtmRegisterEntryModel.find(filter)
      .sort({ createdAt: 1, _id: 1 })
      .lean<AtmRegisterEntryDoc[]>()
      .cursor();
    outcome = await streamRows(cursor, write, (doc) => `${registerRowToCsv(doc, settings)}\n`);
  }
  if (outcome.failure === undefined) res.end();

  // Audited after the stream completes — never blocks the export itself (the audit F1 shape). A
  // download the client left part-way, or that a failed read stopped, is audited too, with the rows
  // written before it ended (`streamRows`); a failure is rethrown after.
  await auditService.record({
    entityRef: { moduleId: 'atm', entityType: 'registerEntry', entityId: 'export' },
    action: 'export',
    changes: [
      { field: 'rowCount', old: null, new: outcome.rowCount },
      { field: 'completed', old: null, new: outcome.completed },
      { field: 'filter', old: null, new: JSON.stringify(query) },
    ],
  });
  if (outcome.failure !== undefined) throw outcome.failure;
};
