// A stroke icon drawn from its path data — the dark boards' icons.
//
// Fleet drew its boards' icons this way first (`BoardIcon`, the fuel cards' design) and the filter
// bars took it up for the icon at each filter's start (`FilterWithIcon`). Shared here so a screen
// outside Fleet can wear the same filter bar without reaching into another module.

/** The design's stroke icons, drawn as the design draws them. */
export const StrokeIcon = ({
  d,
  className,
  width = 2,
}: {
  d: readonly string[];
  className: string;
  width?: number;
}): JSX.Element => (
  <svg
    className={className}
    fill="none"
    stroke="currentColor"
    viewBox="0 0 24 24"
    aria-hidden="true"
  >
    {d.map((path) => (
      <path key={path} d={path} strokeLinecap="round" strokeLinejoin="round" strokeWidth={width} />
    ))}
  </svg>
);
