// A driver, as a chip — the same object in the pool and on the car.
//
// The board is scanned, not read: a dispatcher looks for a name in a list of two hundred, then
// looks at a row to see who is on it. Both are the same question about the same person, so both
// get the same shape, and moving one from the list to the row does not change what it looks
// like — which is what makes the drag legible as MOVING something rather than filling a field.
//
// The NAME only. The code is what you search by, not what you scan by: repeated down a column it
// is noise in the position the eye is using to find a name, and the search below already accepts
// it. Where the name cannot be resolved — no `employee.view`, or the record has not landed — the
// id's tail stands in, honestly, rather than an empty chip.
//
// Solid green rather than `Badge tone="success"`: every Badge tone is a light fill for a chip
// that CLASSIFIES a row, and this one IS the content of its cell.
//
// The hue is the reference design's — Tailwind `green`, not the `emerald` this project uses for
// success elsewhere. They are a shade apart and the difference is deliberate: emerald reads as a
// STATUS ("this went well"), and a driver is not a status. Keeping the two apart means a green
// chip on this board never has to be read as a verdict about the person in it.
//
// A BLOCK, not an inline pill: in the reference a driver fills the width available to them, in
// the list and in the cell alike, so the eye scans one column of equal shapes instead of a
// ragged edge of name-length pills. `truncate` is what keeps that safe for a long name.
import { cn } from '../../../shared/lib/cn';
import { useEmployeeName } from './EmployeeName';

export const DriverChip = ({
  employeeId,
  className,
  title,
}: {
  employeeId: string;
  className?: string;
  title?: string;
}): JSX.Element => {
  const { name } = useEmployeeName(employeeId);
  return (
    <span
      data-driver-chip={employeeId}
      title={title ?? name ?? employeeId}
      className={cn(
        'flex max-w-full items-center justify-center truncate rounded-md bg-green-700 px-2.5 py-1',
        'text-xs font-medium text-white dark:bg-green-600',
        className,
      )}
    >
      {name ?? (
        <span className="font-mono" dir="ltr">
          {employeeId.slice(-8)}
        </span>
      )}
    </span>
  );
};
