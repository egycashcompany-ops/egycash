// The ATM ID filter — «which machines?», asked by their codes, the way the vehicles registry asks
// «which cars?» (`fleet/components/VehicleCodeFilter`): picked from a list, or TYPED and pasted.
//
// An operator usually reads codes off a message, so the search box doubles as the input: each code
// is taken the moment its separator (a space, a comma, a new line) is typed, and Enter takes the
// last one. A pasted column of codes becomes that many picks at once. Codes are normalized as every
// entry point normalizes them — `0123` is machine 123 — and Arabic-Indic digits read as digits.
//
// THE LIST IS SEARCHED ON THE SERVER. The vehicle filter holds the whole registry (two hundred
// cars); the directory holds some 2,600 machines, so the picker asks for the codes holding the
// fragment being typed — among the machines the OTHER filters match — fifty at a time, and narrows
// as the reader types. A chosen code stays listed, ticked, whatever the search has moved on to.
import { useEffect, useMemo, useState } from 'react';
import { asciiDigits, splitAtmMachineCodeList } from '@ecms/contracts';
import { MultiSelect } from '../../../shared/ui/MultiSelect';
import { type ControlDensity } from '../../../shared/ui/form';
import { useAtmMachineCodeSearch } from '../api/atm-queries';
import { type AtmListParams } from '../api/atm-api';
import { machineCodeOptions, readTypedMachineCodes } from '../lib/machine-directory';

/** The pause after the last keystroke before the picker asks the server. */
const SEARCH_PAUSE_MS = 250;

export const MachineCodeFilter = ({
  label,
  value,
  onChange,
  narrow,
  density,
  fullWidth = false,
  className,
}: {
  /** What the empty trigger says, and the control's accessible name. */
  label: string;
  /** The codes filtering now, in the order they were chosen. */
  value: readonly string[];
  onChange: (next: string[]) => void;
  /** The other filters, so the picker offers the machines they leave. */
  narrow: AtmListParams;
  density?: ControlDensity;
  fullWidth?: boolean;
  className?: string;
}): JSX.Element => {
  // What is still being TYPED — the trailing fragment, once the completed codes are taken.
  const [search, setSearch] = useState('');
  const [term, setTerm] = useState('');
  // `MultiSelect` asks with '' each time it opens: the first ask is what turns the search on, so a
  // screen that never opens the picker never pays for it.
  const [opened, setOpened] = useState(false);
  useEffect(() => {
    const id = window.setTimeout(() => setTerm(search.trim()), SEARCH_PAUSE_MS);
    return () => window.clearTimeout(id);
  }, [search]);
  const found = useAtmMachineCodeSearch({ ...narrow, ...(term === '' ? {} : { code: term }) }, opened);

  const add = (codes: readonly string[]): void => {
    const merged = [...value];
    for (const code of codes) if (!merged.includes(code)) merged.push(code);
    if (merged.length !== value.length) onChange(merged);
  };

  const options = useMemo(
    () => machineCodeOptions(found.data?.items ?? [], value),
    [found.data, value.join(',')],
  );

  return (
    <MultiSelect
      clearable
      label={label}
      options={options}
      value={value}
      onChange={onChange}
      showSelectedValues
      chips
      searchThreshold={0}
      searchValue={search}
      onSearch={(raw) => {
        setOpened(true);
        const { chosen, typing } = readTypedMachineCodes(asciiDigits(raw));
        add(chosen);
        setSearch(typing);
      }}
      searching={found.isFetching}
      // Enter takes whatever is left in the box — the last code of a list needs no separator.
      onCommitSearch={(raw) => {
        add(splitAtmMachineCodeList(asciiDigits(raw)));
        setSearch('');
      }}
      fullWidth={fullWidth}
      {...(density === undefined ? {} : { density })}
      {...(className === undefined ? {} : { className })}
    />
  );
};
