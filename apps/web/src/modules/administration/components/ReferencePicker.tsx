// The module's reference picker (design §13.6 D, D-21; P2 re-detail §9.4; ADR-019 rule 5): a form
// control that picks ONE record by searching the server, so the browser never holds a growing list
// to filter it. Rebuilt in the module after IT's `VendorPicker`, not moved to `shared/ui` (D-21).
// The keeper box (`EmployeePicker`) is its first user, and P2's item box joins it: one control and
// one behaviour to fix, rather than a copy per record.
//
// WHAT A CALLER GIVES, as props, is everything that differed between the copies: who may open it
// (`allowed`), what it searches (`useSearch`), how a row is named and drawn, and its four sentences.
// The sentences are i18n keys, said here in the reader's language; this file names no key of its
// own.
//
// THE SEARCH IS A HOOK, after HR's `ApplicantPicker`: each record's search keeps its own query key,
// and a query key is cache identity, so folding them into one parameterised call would change what
// each screen shares with what. It is asked only once something is typed and the reader may open
// the box; a page of rows is the hook's to size (the module's pickers ask for eight).
//
// THE PICK keeps its label in the caller (`valueLabel`), so the chip survives a refetch and a
// stored record is named from what the caller already holds — a warehouse's keeper summary, a
// line's stored item — with no read by id.
//
// WITHOUT ACCESS the box says so in a sentence, rather than searching into a 403 the reader could
// not interpret.
import { useState, type ReactNode } from 'react';
import { useT } from '../../../platform/localization/useT';
import { SearchInput } from '../../../shared/ui/SearchInput';
import { Spinner } from '../../../shared/ui/Spinner';
import { CloseIcon } from '../../../shared/ui/icons';

/** A caller's search for what was typed: a page of rows, as `useQuery` over a page answers it. */
type ReferenceSearchHook<Row> = (
  search: string,
  enabled: boolean,
) => { isPending: boolean; data?: { items: readonly Row[] } | undefined };

export const ReferencePicker = <Row,>({
  value,
  valueLabel,
  onChange,
  error = false,
  allowed,
  useSearch,
  rowId,
  rowLabel,
  renderRow,
  texts,
}: {
  /** The picked record's id, '' when none. */
  value: string;
  /** Label for the current pick, kept by the caller so the chip survives a refetch. */
  valueLabel: string;
  onChange: (id: string, label: string) => void;
  /** The field around it carries a refusal: the chip says so in its colour too. */
  error?: boolean;
  /** The reader holds a key the search's endpoint admits; else the box says so and never asks. */
  allowed: boolean;
  /** The record's own search — see the note above on why this is a hook. */
  useSearch: ReferenceSearchHook<Row>;
  rowId: (row: Row) => string;
  /** The label a pick hands the caller for its chip. */
  rowLabel: (row: Row) => string;
  /** A result row's contents, inside the row's button. */
  renderRow: (row: Row) => ReactNode;
  /** The box's sentences, as i18n keys. */
  texts: { placeholder: string; noResults: string; noAccess: string; clearPick: string };
}): JSX.Element => {
  const t = useT();
  const [search, setSearch] = useState('');
  const typed = search.trim() !== '';
  const results = useSearch(search, allowed && typed);
  const rows = results.data?.items ?? [];

  if (!allowed) {
    return <p className="text-sm text-slate-500 dark:text-slate-400">{t(texts.noAccess)}</p>;
  }

  return (
    <div className="space-y-2">
      {value !== '' && (
        <div
          className={
            error
              ? 'flex items-center justify-between gap-2 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm dark:border-red-800 dark:bg-red-950/40'
              : 'flex items-center justify-between gap-2 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-sm dark:border-brand-900 dark:bg-brand-950/40'
          }
        >
          <span
            className={
              error ? 'text-red-800 dark:text-red-200' : 'text-brand-800 dark:text-brand-200'
            }
          >
            {valueLabel}
          </span>
          <button
            type="button"
            onClick={() => onChange('', '')}
            aria-label={t(texts.clearPick)}
            title={t(texts.clearPick)}
            className="rounded-md p-1 text-brand-700 hover:bg-brand-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 dark:text-brand-300 dark:hover:bg-brand-900/60"
          >
            <CloseIcon className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
      <SearchInput value={search} onChange={setSearch} placeholder={t(texts.placeholder)} />
      {typed && (
        <div className="max-h-56 overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-800">
          {results.isPending ? (
            <div className="grid place-items-center p-4">
              <Spinner />
            </div>
          ) : rows.length === 0 ? (
            <p className="p-4 text-sm text-slate-500 dark:text-slate-400">{t(texts.noResults)}</p>
          ) : (
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {rows.map((row) => {
                const id = rowId(row);
                return (
                  <li key={id}>
                    <button
                      type="button"
                      aria-pressed={id === value}
                      onClick={() => {
                        onChange(id, rowLabel(row));
                        setSearch('');
                      }}
                      className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-start text-sm hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 dark:hover:bg-slate-800/60 ${
                        id === value
                          ? 'bg-brand-50 font-medium text-brand-700 dark:bg-brand-950/40 dark:text-brand-300'
                          : 'text-slate-700 dark:text-slate-200'
                      }`}
                    >
                      {renderRow(row)}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
};
