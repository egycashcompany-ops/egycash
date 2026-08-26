// The picture on the portal's sign-in panel — and the one place that decides where it comes from.
//
// HOW TO CHANGE IT. Drop your own file at `apps/web/public/branding/gold-portal-login.png` and it
// is picked up on the next build; nothing here needs editing. A deployment that wants a different
// picture without touching the repository sets `VITE_PORTAL_LOGIN_IMAGE` to any URL or path.
//
// The login screen is UNAUTHENTICATED, which is why the source is a static asset rather than a
// setting: reading a setting means an API call, and an API call before sign-in means a public
// endpoint that exists only to serve a picture. A file the web server already serves costs
// nothing and cannot leak anything.
//
// If neither source resolves — no file dropped in, no variable set, a typo in either — the built-in
// mark below is drawn instead. That is the DEFAULT state of a fresh checkout, so it is a finished
// illustration rather than a grey box with a broken-image icon in it.
import { useState } from 'react';

/** Set per deployment; overrides the file. Any URL or absolute path. */
const CONFIGURED = import.meta.env.VITE_PORTAL_LOGIN_IMAGE as string | undefined;

/** The file a deployment drops in. `BASE_URL` keeps it correct under a sub-path deploy. */
const DROPPED_IN = `${import.meta.env.BASE_URL}branding/gold-portal-login.png`;

const source = CONFIGURED !== undefined && CONFIGURED !== '' ? CONFIGURED : DROPPED_IN;

/**
 * A stack of bars, drawn rather than photographed.
 *
 * Isometric, because that is how a vault reads at a glance: depth without perspective, so every
 * bar is the same size wherever it sits. Four bars on the floor and one on top — the arrangement
 * that says "stack" in the fewest shapes, and the reason the faces are drawn back-to-front rather
 * than in a loop over a list: in isometric, what overlaps what IS the drawing order.
 *
 * The glow is one radial gradient behind the stack — the light a vault door throws when it opens,
 * and the only warm thing on an otherwise black panel.
 */
const W = 54;
const H = 27;
const D = 30;

/**
 * Bars are SPACED slightly wider than they are drawn.
 *
 * Sitting them flush makes four bars read as one slab: adjacent top faces share an edge, and the
 * seam disappears at any size the panel actually renders at. A few pixels of air puts the seam
 * back without the bars looking like they float.
 */
const STEP_X = W + 4;
const STEP_Y = H + 2;

/** One bar, its top face centred on (x, y). */
const Bar = ({ x, y }: { x: number; y: number }): JSX.Element => (
  <g transform={`translate(${x} ${y})`}>
    <path d={`M0 ${-H} L${W} 0 L0 ${H} L${-W} 0 Z`} fill="url(#pl-top)" />
    <path d={`M${-W} 0 L0 ${H} L0 ${H + D} L${-W} ${D} Z`} fill="url(#pl-left)" />
    <path d={`M${W} 0 L0 ${H} L0 ${H + D} L${W} ${D} Z`} fill="url(#pl-right)" />
    <path
      d={`M0 ${-H} L${W} 0 L0 ${H} L${-W} 0 Z`}
      fill="none"
      stroke="#fde68a"
      strokeOpacity="0.4"
      strokeWidth="1.5"
    />
  </g>
);

const BuiltInMark = (): JSX.Element => (
  <svg
    viewBox="0 0 420 360"
    role="img"
    aria-hidden="true"
    className="h-full w-full"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <defs>
      <radialGradient id="pl-glow" cx="50%" cy="50%" r="52%">
        <stop offset="0%" stopColor="#fbbf24" stopOpacity="0.26" />
        <stop offset="58%" stopColor="#b45309" stopOpacity="0.09" />
        <stop offset="100%" stopColor="#000000" stopOpacity="0" />
      </radialGradient>
      <linearGradient id="pl-top" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stopColor="#fef3c7" />
        <stop offset="45%" stopColor="#f5c33b" />
        <stop offset="100%" stopColor="#d69e18" />
      </linearGradient>
      <linearGradient id="pl-left" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#d9a01c" />
        <stop offset="100%" stopColor="#a06f0e" />
      </linearGradient>
      <linearGradient id="pl-right" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#a97a10" />
        <stop offset="100%" stopColor="#6b4907" />
      </linearGradient>
      <radialGradient id="pl-shadow" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stopColor="#000000" stopOpacity="0.6" />
        <stop offset="70%" stopColor="#000000" stopOpacity="0.28" />
        <stop offset="100%" stopColor="#000000" stopOpacity="0" />
      </radialGradient>
    </defs>

    <rect width="420" height="360" fill="url(#pl-glow)" />

    <g transform="translate(210 150)">
      {/* The shadow the stack sits in, drawn before anything stands on it. Faded at the rim
          rather than cut off, so it reads as light falling away and not as a black disc. */}
      <ellipse cx="0" cy="118" rx="152" ry="44" fill="url(#pl-shadow)" />

      {/* Back to front. In isometric, drawing order IS occlusion. */}
      <Bar x={0} y={0} />
      <Bar x={-STEP_X} y={STEP_Y} />
      <Bar x={STEP_X} y={STEP_Y} />
      <Bar x={0} y={2 * STEP_Y} />
      <Bar x={0} y={STEP_Y - D} />
    </g>

    {/* Two sparks of light — the only detail that says "new". */}
    <circle cx="306" cy="150" r="2.5" fill="#fde68a" opacity="0.8" />
    <circle cx="118" cy="196" r="1.8" fill="#fde68a" opacity="0.55" />
  </svg>
);

export const PortalLoginArt = ({ alt }: { alt: string }): JSX.Element => {
  const [failed, setFailed] = useState(false);
  if (failed) return <BuiltInMark />;
  return (
    <img
      src={source}
      alt={alt}
      className="h-full w-full object-contain"
      // A missing file is the expected state of a fresh checkout, not an error worth logging.
      onError={() => setFailed(true)}
    />
  );
};
