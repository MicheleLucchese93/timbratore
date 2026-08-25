import type { JSX, ReactNode } from 'react';

/* =============================================================================
   Animated illustrations for empty states — partner console.

   The catalogue and the motion are the ones the main web app uses
   (`apps/web/src/components/EmptyArt.tsx` + the `.empty-art-*` rules of its
   index.css); this console keeps its own copy the same way it keeps its own
   `.btn`, `.card` and `PageHeader`. Only the scenes this console can actually
   show are here — there is nothing to draw about a punch or a shift in a
   reseller's tenant list — plus `company`, which only exists here.

   All timing is CSS, never JS: a six-second loop must not cost a re-render, and
   a single `prefers-reduced-motion` block freezes every scene in a readable
   static pose (see the end of the empty-state section in index.css).

   Every colour is a token. `--art-surface` fills the paper, `--art-accent` is
   the single brand accent, and `currentColor` carries everything else — all
   three are set once on `.empty-art-holder`.
   ========================================================================== */

/** Which scene to draw. One per kind of nothing this console can show. */
export type EmptyArtName =
  | 'company'
  | 'people'
  | 'place'
  | 'inbox'
  | 'clear'
  | 'documents'
  | 'history'
  | 'search'
  | 'alert';

export interface EmptyArtProps {
  name: EmptyArtName;
  /**
   * Draw the scene in its resting pose and never loop it — for the places that
   * show several at once, where independent loops stop being a hint and become
   * a carnival.
   */
  still?: boolean;
  className?: string;
}

/** Shared frame: one viewBox for every scene, so the CSS poses apply to all. */
function Art({ children }: { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 120 88"
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="empty-art"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

/** Ground shadow, centred under the scene. Counterpoint to the float. */
function Shadow({ rx = 24 }: { rx?: number }) {
  return (
    <ellipse className="empty-art-shadow" cx="60" cy="85" rx={rx} ry="2.5" fill="currentColor" />
  );
}

/**
 * The three accent sparkles: the only brand colour in a scene.
 *
 * Four-pointed stars, not little crosses: a `+` in colour next to a "Nuova
 * azienda" button reads as a second button, and at 12px a cross is clip art.
 *
 * Position lives in a `transform` attribute and scale in the inner group,
 * because the CSS `transform` that makes them twinkle would REPLACE the
 * attribute rather than compose with it. Two levels keep the two apart.
 */
const STAR = 'M0-4C.5-1.3 1.3-.5 4 0 1.3.5.5 1.3 0 4-.5 1.3-1.3.5-4 0-1.3-.5-.5-1.3 0-4Z';

/** [x, y, scale] — positions move per scene: a sparkle inside a shape is a smudge. */
type SparkleSpot = readonly [number, number, number];
const DEFAULT_SPARKLES: readonly SparkleSpot[] = [
  [21, 27, 1],
  [100, 36, 0.8],
  [27, 69, 0.65],
];

function Sparkles({ spots = DEFAULT_SPARKLES }: { spots?: readonly SparkleSpot[] }) {
  return (
    <g fill="var(--art-accent)">
      {spots.map(([x, y, s], i) => (
        <g key={`${x}-${y}`} transform={`translate(${x} ${y}) scale(${s})`}>
          <path className={`empty-art-sparkle empty-art-sparkle-${i + 1}`} d={STAR} />
        </g>
      ))}
    </g>
  );
}

/** The sheet several scenes are built on: same rect, same rounding, same ink. */
function Sheet({ opacity = 0.3 }: { opacity?: number }) {
  return (
    <rect
      x="34"
      y="18"
      width="52"
      height="64"
      rx="5"
      fill="var(--art-surface)"
      stroke="currentColor"
      strokeOpacity={opacity}
      strokeWidth="1.5"
    />
  );
}

/**
 * A building with a light coming on in one window: for a partner's tenant list
 * with no companies in it.
 *
 * The unit this console manages is a COMPANY, and every other scene in the
 * catalogue draws a document, a person or a place. The lit window is the whole
 * idea of the page — an azienda is created here and then it is live.
 */
function CompanyArt() {
  const windows: Array<[number, number]> = [];
  for (const y of [32, 44, 56]) {
    for (const x of [45, 57, 69]) {
      // The lit one owns (57,44): a grey pane under it would be a smudge.
      if (!(x === 57 && y === 44)) windows.push([x, y]);
    }
  }
  return (
    <Art>
      <Shadow rx={24} />
      <Sparkles
        spots={[
          [20, 26, 0.95],
          [101, 34, 0.75],
          [24, 68, 0.6],
        ]}
      />
      <g className="empty-art-stack">
        <g className="empty-art-hoverpop">
          {/* The lower annex, drawn first so the tower reads as the front. */}
          <path
            d="M26 74V50a3 3 0 0 1 3-3h11v27Z"
            fill="var(--art-surface)"
            stroke="currentColor"
            strokeOpacity="0.28"
            strokeWidth="1.75"
          />
          <path d="M31 55h5M31 63h5" stroke="currentColor" strokeOpacity="0.18" strokeWidth="1.75" />
          <path
            d="M40 74V22a4 4 0 0 1 4-4h26a4 4 0 0 1 4 4v52Z"
            fill="var(--art-surface)"
            stroke="currentColor"
            strokeOpacity="0.34"
            strokeWidth="1.75"
          />
          <g fill="currentColor" fillOpacity="0.16">
            {windows.map(([x, y]) => (
              <rect key={`${x}-${y}`} x={x} y={y} width="6" height="7" rx="1.5" />
            ))}
          </g>
          {/* The door: what stops the tower reading as a spreadsheet. */}
          <path
            d="M53 74V66a4 4 0 0 1 8 0v8Z"
            stroke="currentColor"
            strokeOpacity="0.28"
            strokeWidth="1.75"
          />
        </g>
        {/* The window that comes on. */}
        <rect
          className="empty-art-daymark"
          x="57"
          y="44"
          width="6"
          height="7"
          rx="1.5"
          fill="var(--art-accent)"
          fillOpacity="0.55"
        />
        <path d="M24 74h72" stroke="currentColor" strokeOpacity="0.22" strokeWidth="2" />
      </g>
    </Art>
  );
}

/**
 * Two figures with a third arriving: for a list of people with nobody in it.
 *
 * The arrival is the point — every screen that shows this one has an "Aggiungi"
 * next to it — so the third figure is the one in the accent colour and the only
 * one that moves.
 */
function Person({ cx, accent }: { cx: number; accent?: boolean }) {
  const stroke = accent ? 'var(--art-accent)' : 'currentColor';
  const op = accent ? 0.75 : 0.34;
  return (
    <g stroke={stroke} strokeOpacity={op} strokeWidth="1.75" fill="var(--art-surface)">
      <circle cx={cx} cy="45" r="8" />
      {/* Shoulders start 3px under the chin: any lower and the head floats. */}
      <path d={`M${cx - 12} 70c0-8.6 5.4-13.5 12-13.5s12 4.9 12 13.5Z`} />
    </g>
  );
}

function PeopleArt() {
  return (
    <Art>
      <Shadow rx={26} />
      <Sparkles
        spots={[
          [18, 26, 0.95],
          [103, 34, 0.75],
          [21, 68, 0.6],
        ]}
      />
      <g className="empty-art-stack">
        <g className="empty-art-hoverpop">
          <Person cx={34} />
          <Person cx={60} />
        </g>
        <g className="empty-art-appear">
          <Person cx={86} accent />
        </g>
      </g>
    </Art>
  );
}

/**
 * A pin dropping onto a map: for Sedi.
 *
 * The pin has its own fall rather than borrowing the tray scene's, because it
 * has to come to REST on the map — a sede is a place that stays put, and a
 * marker that fades out every cycle says the opposite.
 */
function PlaceArt() {
  return (
    <Art>
      <Shadow rx={24} />
      <Sparkles
        spots={[
          [18, 28, 0.95],
          [103, 36, 0.75],
          [22, 68, 0.6],
        ]}
      />
      <g className="empty-art-stack">
        <rect
          x="24"
          y="24"
          width="72"
          height="50"
          rx="6"
          fill="var(--art-surface)"
          stroke="currentColor"
          strokeOpacity="0.3"
          strokeWidth="1.75"
        />
        {/* Roads, not a grid of lines: what makes the rectangle a map. */}
        <path d="M24 46h72M52 24v50" stroke="currentColor" strokeOpacity="0.14" strokeWidth="1.5" />
        <path d="M36 74V58h16M96 34H72v12" stroke="currentColor" strokeOpacity="0.1" strokeWidth="1.5" />
        {/* Pin drawn around (0,0) = its point, so the keyframes only translate it. */}
        <g className="empty-art-pin">
          <path
            d="M0 0 -8 -12a9.5 9.5 0 1 1 16 0Z"
            fill="var(--art-surface)"
            stroke="var(--art-accent)"
            strokeOpacity="0.85"
            strokeWidth="1.75"
          />
          <circle cx="0" cy="-16" r="3.5" fill="var(--art-accent)" fillOpacity="0.55" />
        </g>
      </g>
    </Art>
  );
}

/**
 * An envelope dropping into a tray: for a queue of requests with nothing in it.
 *
 * Vertical motion on purpose — the documents scene next door writes
 * horizontally, and two scenes that move the same way compete instead of
 * distinguishing the screens they belong to.
 */
function InboxArt() {
  return (
    <Art>
      <Shadow rx={26} />
      <Sparkles
        spots={[
          [19, 30, 1],
          [102, 40, 0.8],
          [17, 66, 0.65],
        ]}
      />
      <g className="empty-art-stack">
        {/* The message in flight, drawn around its own centre. */}
        <g className="empty-art-drop">
          <rect
            x="-16"
            y="-11"
            width="32"
            height="22"
            rx="3"
            fill="var(--art-surface)"
            stroke="currentColor"
            strokeOpacity="0.32"
            strokeWidth="1.5"
          />
          {/* The flap: the one line that makes the rectangle an envelope. */}
          <path d="M-16 -8 0 3 16 -8" stroke="var(--art-accent)" strokeOpacity="0.9" strokeWidth="1.75" />
        </g>
        {/* The tray, open upwards, so the envelope "goes in" instead of "landing on". */}
        <g className="empty-art-tray empty-art-hoverpop">
          <path
            d="M30 54v14a5 5 0 0 0 5 5h50a5 5 0 0 0 5-5V54"
            fill="var(--art-surface)"
            stroke="currentColor"
            strokeOpacity="0.32"
            strokeWidth="1.75"
          />
          <path d="M30 54h13l3 6h28l3-6h13" stroke="currentColor" strokeOpacity="0.32" strokeWidth="1.75" />
        </g>
      </g>
    </Art>
  );
}

/**
 * A shield with a tick drawn inside it: for "nothing needs you".
 *
 * The one empty state that is good news, so it is the one scene in success
 * green rather than the brand accent — and a shield rather than a page,
 * because what it reports is that everything is in order, not that a list is
 * short.
 */
function ClearArt() {
  return (
    <Art>
      <Shadow rx={20} />
      <Sparkles
        spots={[
          [24, 26, 0.9],
          [97, 34, 0.75],
          [28, 66, 0.6],
        ]}
      />
      <g className="empty-art-stack">
        <g className="empty-art-hoverpop">
          <path
            d="M60 14 88 24v22c0 16-12 27-28 32-16-5-28-16-28-32V24Z"
            fill="var(--art-surface)"
            stroke="currentColor"
            strokeOpacity="0.3"
            strokeWidth="1.75"
          />
          <path
            className="empty-art-check"
            d="M47 46 56 56 74 35"
            stroke="var(--color-success)"
            strokeWidth="3.5"
            strokeDasharray="42"
          />
        </g>
      </g>
    </Art>
  );
}

/**
 * A stack of documents with a pen writing a line, on a loop.
 *
 * For anything whose page stays empty until the first record arrives, and where
 * that record is written by a person. On hover the stack fans out — a small
 * reward for anyone who plays with it.
 */
function DocumentsArt() {
  return (
    <Art>
      <Shadow />
      <Sparkles />
      <g className="empty-art-stack">
        {/* The two sheets underneath: outline only, rotated about (60,50). */}
        <g className="empty-art-card empty-art-card-back-2">
          <Sheet opacity={0.16} />
        </g>
        <g className="empty-art-card empty-art-card-back-1">
          <Sheet opacity={0.2} />
        </g>
        {/* The top sheet: the one being written. */}
        <g className="empty-art-card empty-art-card-front">
          <Sheet />
          {/* Heading and body lines already there: the document exists, the
              content does not. */}
          <path d="M43 30h22" stroke="currentColor" strokeOpacity="0.4" strokeWidth="2.5" />
          <path d="M43 42h34M43 50h26" stroke="currentColor" strokeOpacity="0.16" strokeWidth="1.75" />
          {/* The line the pen traces: dasharray = the stroke's length. */}
          <path
            className="empty-art-written"
            d="M43 62h34"
            stroke="var(--art-accent)"
            strokeWidth="2"
            strokeDasharray="34"
          />
        </g>
        {/* Pen drawn around (0,0) = its nib, so the keyframes translate the group
            and the nib lands exactly on the line. */}
        <g className="empty-art-pen">
          <path d="M3 -3 17 -17" stroke="currentColor" strokeOpacity="0.5" strokeWidth="4" />
          <path d="M2.5 -2.5 8 -8" stroke="var(--art-surface)" strokeOpacity="0.45" strokeWidth="1.25" />
          <path d="M0 0 5.5 -2 2 -5.5Z" fill="var(--art-accent)" />
        </g>
      </g>
    </Art>
  );
}

/**
 * A timeline with the newest entry pulsing: for the Registro attività.
 *
 * A spine with dots on it, not a table of rows: what is missing on this screen
 * is a *sequence*, and rows alone would draw the same picture the "no results"
 * scene already owns.
 */
function HistoryArt() {
  return (
    <Art>
      <Shadow rx={22} />
      <g className="empty-art-stack">
        <rect
          x="28"
          y="16"
          width="64"
          height="58"
          rx="6"
          fill="var(--art-surface)"
          stroke="currentColor"
          strokeOpacity="0.3"
          strokeWidth="1.5"
        />
        <path d="M42 30v30" stroke="currentColor" strokeOpacity="0.18" strokeWidth="1.5" />
        {[30, 45].map((cy) => (
          <g key={cy}>
            <circle cx="42" cy={cy} r="3.5" fill="var(--art-surface)" stroke="currentColor" strokeOpacity="0.4" strokeWidth="1.75" />
            <path d={`M52 ${cy - 3}h28M52 ${cy + 3}h17`} stroke="currentColor" strokeOpacity="0.16" strokeWidth="1.75" />
          </g>
        ))}
        <path d="M52 57h24M52 63h14" stroke="currentColor" strokeOpacity="0.16" strokeWidth="1.75" />
        <g className="empty-art-pulse">
          <circle cx="42" cy="60" r="4.5" fill="var(--art-accent)" fillOpacity="0.3" stroke="var(--art-accent)" strokeOpacity="0.7" strokeWidth="1.75" />
        </g>
      </g>
    </Art>
  );
}

/**
 * A lens sweeping a list: for "no results".
 *
 * No sparkles, unlike the others: a search that found nothing is a fact, not an
 * invitation, and rewarding it with glitter says "well done" to someone who did
 * not find what they were looking for. The motion stays — the lens keeps
 * looking — because that IS the right hint.
 */
function SearchArt() {
  return (
    <Art>
      <Shadow rx={26} />
      <g className="empty-art-stack">
        <rect
          x="24"
          y="20"
          width="72"
          height="48"
          rx="6"
          fill="var(--art-surface)"
          stroke="currentColor"
          strokeOpacity="0.28"
          strokeWidth="1.5"
        />
        {/* The rows never move: it is the lens that searches. */}
        <path d="M34 32h30M34 42h44M34 52h24" stroke="currentColor" strokeOpacity="0.16" strokeWidth="2" />
        {/* Lens drawn around (0,0) = the centre of the glass. */}
        <g className="empty-art-lens empty-art-hoverpop">
          <circle r="9" fill="var(--art-surface)" fillOpacity="0.75" />
          <circle r="9" stroke="currentColor" strokeOpacity="0.55" strokeWidth="2.5" />
          <path d="M6.5 6.5 13 13" stroke="currentColor" strokeOpacity="0.55" strokeWidth="3" />
          {/* The glint: the only accent here, and it is what makes the glass read. */}
          <path d="M-4.5 -2a5 5 0 0 1 3-3" stroke="var(--art-accent)" strokeOpacity="0.85" strokeWidth="1.75" />
        </g>
      </g>
    </Art>
  );
}

/**
 * A page with a raised mark: for a load failure or a route that does not exist.
 *
 * No sparkles and no accent: this is the one scene that is not an invitation.
 * The mark breathes instead of drawing itself — nothing is being made here, and
 * a stroke animating in would promise a recovery the screen cannot deliver.
 */
function AlertArt() {
  return (
    <Art>
      <Shadow rx={22} />
      <g className="empty-art-stack">
        <g className="empty-art-card empty-art-card-back-1">
          <Sheet opacity={0.14} />
        </g>
        <g className="empty-art-card empty-art-card-front">
          <Sheet opacity={0.26} />
          <path d="M43 30h24M43 40h34" stroke="currentColor" strokeOpacity="0.14" strokeWidth="1.75" />
          <g className="empty-art-pulse">
            <circle
              cx="60"
              cy="59"
              r="14"
              fill="var(--art-surface)"
              stroke="var(--color-warning)"
              strokeOpacity="0.6"
              strokeWidth="2"
            />
            <path d="M60 52v8" stroke="var(--color-warning)" strokeWidth="2.5" />
            <circle cx="60" cy="65.5" r="1.5" fill="var(--color-warning)" />
          </g>
        </g>
      </g>
    </Art>
  );
}

const SCENES: Record<EmptyArtName, () => JSX.Element> = {
  company: CompanyArt,
  people: PeopleArt,
  place: PlaceArt,
  inbox: InboxArt,
  clear: ClearArt,
  documents: DocumentsArt,
  history: HistoryArt,
  search: SearchArt,
  alert: AlertArt,
};

/** The decorative scene at the top of an empty state. */
export function EmptyArt({ name, still = false, className }: EmptyArtProps) {
  const Scene = SCENES[name];
  return (
    <span
      className={['empty-art-holder', still ? 'empty-art-still' : '', className ?? '']
        .filter(Boolean)
        .join(' ')}
      aria-hidden="true"
    >
      <Scene />
    </span>
  );
}
