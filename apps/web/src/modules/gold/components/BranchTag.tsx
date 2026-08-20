// The branch a gold row belongs to, as a small chip beside its identifier.
//
// It exists because the vault is a multi-branch operation and a receipt number on its own does not
// say which building it happened in. The name comes from the ECMS organization branch the document
// carries (integration 3) — the module has no branch list of its own to disagree with.
export const BranchTag = ({ name }: { name: string | null }): JSX.Element | null => {
  if (name === null || name === '') return null;
  return (
    <span className="ms-2 rounded-md bg-slate-100 px-1.5 py-0.5 align-middle text-[11px] font-medium text-slate-500 dark:bg-slate-800 dark:text-slate-400">
      {name}
    </span>
  );
};
