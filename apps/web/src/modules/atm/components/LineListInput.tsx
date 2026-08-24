// A multi-value entry box that occupies exactly ONE normal input's worth of the row.
//
// The open forms take their values a line at a time — machine codes down one column, schedule
// times or service types down the next, paired BY LINE NUMBER (atm_replenishment.ejs:558-580,
// atm_maintenance.ejs:707-735). That is a textarea, and a textarea sized to show its lines stands
// two to three times a normal control's height and can be dragged taller still, so the entry row
// never lines up with the single-line date beside it or the filters at the end of it.
//
// So the control keeps its multi-line VALUE and gives up its multi-line HEIGHT: one row tall,
// `resize-none` against the drag handle, and pinned to one width so the columns stay even. Height
// resolves to the same 38px an `Input` does — identical padding, border and line-height, one line
// of each — which is what makes the row read as a row.
//
// The cost is real and worth naming: only one line is visible at a time, so a reader cannot see
// that column three has drifted a line out of step with column one. Pasting a prepared column —
// how a bank's batch actually arrives — is unaffected.
import { Textarea } from '../../../shared/ui/form';

/**
 * `min-w`/`max-w` rather than `w`: `cn` joins class names without resolving Tailwind conflicts
 * (shared/lib/cn.ts), so a `w-*` here would race the `w-full` the control base already carries
 * and lose or win by stylesheet order. Clamping both bounds pins the width whoever wins.
 */
const WIDTH = 'min-w-40 max-w-40';

export const LineListInput = ({
  value,
  onChange,
  placeholder,
  required = false,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder: string;
  required?: boolean;
}): JSX.Element => (
  <Textarea
    value={value}
    onChange={(e) => onChange(e.target.value)}
    rows={1}
    required={required}
    placeholder={placeholder}
    className={`resize-none text-center ${WIDTH}`}
  />
);
