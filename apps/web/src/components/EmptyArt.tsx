import type { JSX, ReactNode } from 'react';

/* =============================================================================
   Animated illustrations for empty states.

   These replace the grey glyph in a round chip that used to sit at the centre
   of every empty page. A muted icon says nothing the title does not already
   say: it spends the most visible spot on the screen repeating "empty" in
   grey. A drawing that moves shows *what will appear there* — a punch being
   registered, a day being marked on a calendar, a request landing in a tray.

   Inline SVG rather than files in `public/`: the motion lives in the
   `.empty-art-*` rules of index.css, so the shapes have to ship next to the CSS
   that animates them, and the ink comes from `currentColor` so one rule on the
   wrapper tunes every scene at once.

   All timing is CSS, never JS: a six-second loop must not cost a re-render, and
   a single `prefers-reduced-motion` block freezes every scene in a readable
   static pose (see the end of the empty-state section in index.css).

   Every colour is a token. `--art-surface` fills the paper, `--art-accent` is
   the single brand accent, and `currentColor` carries everything else — all
   three are set once on `.empty-art-holder`.
   ========================================================================== */

/** Which scene to draw. One per kind of nothing this product can show. */
export type EmptyArtName =
  | 'clock'
  | 'documents'
  | 'calendar'
  | 'schedule'
  | 'clear'
  | 'search'
  | 'inbox'
  | 'board'
  | 'site'
  | 'vehicle'
  | 'people'
  | 'place'
  | 'export'
  | 'history'
  | 'alert';

export interface EmptyArtProps {
  name: EmptyArtName;
  /**
   * Draw the scene in its resting pose and never loop it.
   *
   * For the places that show SEVERAL scenes at once — a dashboard with one in
   * every panel — where four independent loops on one screen stop being a hint
   * and become a carnival. The pose is the same one `prefers-reduced-motion`
   * uses, so it is already known to read on its own.
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
 * Four-pointed stars, not little crosses: a `+` in colour next to a "Nuovo"
 * button reads as a second button, and at 12px a cross is clip art.
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
 * A clock with the minute hand going round: the default scene for timbrature.
 *
 * The one thing this product measures is time passing, and a face whose hand
 * moves is that, drawn. Nothing is being created here — a list of punches fills
 * itself as the day goes on — so there is no pen and no stroke drawing in.
 */
function ClockArt() {
  return (
    <Art>
      <Shadow rx={22} />
      <Sparkles
        spots={[
          [20, 26, 0.95],
          [101, 34, 0.75],
          [24, 68, 0.6],
        ]}
      />
      <g className="empty-art-stack">
        <g className="empty-art-hoverpop">
          <circle
            cx="60"
            cy="46"
            r="25"
            fill="var(--art-surface)"
            stroke="currentColor"
            strokeOpacity="0.32"
            strokeWidth="2"
          />
          {/* The quarters, so the face reads as a clock and not as a coin. */}
          <g stroke="currentColor" strokeOpacity="0.28" strokeWidth="2">
            <path d="M60 25v4M60 63v4M39 46h4M77 46h4" />
          </g>
          {/* The hour hand stays put; the minute hand is what shows the passing. */}
          <path d="M60 46 70 39" stroke="currentColor" strokeOpacity="0.45" strokeWidth="2.5" />
          <path className="empty-art-hand" d="M60 46 60 29" stroke="var(--art-accent)" strokeWidth="2.25" />
          <circle cx="60" cy="46" r="2.5" fill="var(--art-accent)" />
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
 * A calendar with one day being marked: for ferie, permessi and residui.
 *
 * The mark lands first and the tick is drawn into it afterwards, because that
 * is the order of the thing it stands for — a day is chosen, then approved.
 */
function CalendarArt() {
  const dots: Array<[number, number]> = [];
  for (const cy of [44, 56, 68]) {
    for (const cx of [36, 50, 64, 78]) {
      // The marked day owns (64,56): a grey dot under the mark is a smudge.
      if (!(cx === 64 && cy === 56)) dots.push([cx, cy]);
    }
  }
  return (
    <Art>
      <Shadow rx={26} />
      <Sparkles
        spots={[
          [19, 28, 0.95],
          [103, 36, 0.8],
          [23, 70, 0.6],
        ]}
      />
      <g className="empty-art-stack">
        <g className="empty-art-hoverpop">
          {/* The two rings, drawn before the body so the body covers their feet. */}
          <path d="M44 14v10M76 14v10" stroke="currentColor" strokeOpacity="0.4" strokeWidth="2.5" />
          <rect
            x="26"
            y="20"
            width="68"
            height="58"
            rx="6"
            fill="var(--art-surface)"
            stroke="currentColor"
            strokeOpacity="0.32"
            strokeWidth="1.75"
          />
          <path d="M26 34h68" stroke="currentColor" strokeOpacity="0.26" strokeWidth="1.75" />
          <g fill="currentColor" fillOpacity="0.18">
            {dots.map(([cx, cy]) => (
              <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="2.6" />
            ))}
          </g>
          {/* The chosen day, then the approval drawn into it. */}
          <rect
            className="empty-art-daymark"
            x="57"
            y="49"
            width="14"
            height="14"
            rx="4"
            fill="var(--art-accent)"
            fillOpacity="0.18"
            stroke="var(--art-accent)"
            strokeOpacity="0.65"
            strokeWidth="1.5"
          />
          <path
            className="empty-art-check"
            d="M60 56 63 59.5 68.5 51.5"
            stroke="var(--art-accent)"
            strokeWidth="2.25"
            strokeDasharray="42"
          />
        </g>
      </g>
    </Art>
  );
}

/**
 * A week of shift bars rising one after the other: for orari and turni.
 *
 * Horizontal bars would be a Gantt chart and a Gantt chart is data; these are
 * columns of a week, which is the unit an orario is actually defined in.
 */
const SCHEDULE_BARS: Array<[number, number]> = [
  [31, 26],
  [44, 34],
  [57, 20],
  [70, 30],
  [83, 24],
];

function ScheduleArt() {
  return (
    <Art>
      <Shadow rx={26} />
      <Sparkles
        spots={[
          [20, 26, 0.95],
          [102, 34, 0.75],
          [24, 70, 0.6],
        ]}
      />
      <g className="empty-art-stack">
        <rect
          x="22"
          y="16"
          width="76"
          height="58"
          rx="6"
          fill="var(--art-surface)"
          stroke="currentColor"
          strokeOpacity="0.3"
          strokeWidth="1.75"
        />
        {/* The day headings, and the line the bars stand on. */}
        <path
          d="M31 26h8M44 26h8M57 26h8M70 26h8M83 26h8"
          stroke="currentColor"
          strokeOpacity="0.18"
          strokeWidth="2"
        />
        <path d="M28 66h64" stroke="currentColor" strokeOpacity="0.2" strokeWidth="1.5" />
        {SCHEDULE_BARS.map(([x, h], i) => (
          <rect
            key={x}
            className={`empty-art-bar empty-art-bar-${i + 1}`}
            x={x}
            y={66 - h}
            width="8"
            height={h}
            rx="3"
            fill={i === 4 ? 'var(--art-accent)' : 'currentColor'}
            fillOpacity={i === 4 ? 0.55 : 0.22}
          />
        ))}
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
 * A note pinned to a board, swinging on its pin: for the Bacheca.
 *
 * A board, not another sheet of paper: what is missing here is something
 * addressed to everyone, and the pin is the whole difference between a notice
 * and a document.
 */
function BoardArt() {
  return (
    <Art>
      <Shadow rx={26} />
      <Sparkles
        spots={[
          [18, 30, 0.95],
          [103, 38, 0.8],
          [22, 68, 0.6],
        ]}
      />
      <g className="empty-art-stack">
        <rect
          x="22"
          y="16"
          width="76"
          height="56"
          rx="5"
          fill="var(--art-surface)"
          stroke="currentColor"
          strokeOpacity="0.32"
          strokeWidth="1.75"
        />
        <rect x="27" y="21" width="66" height="46" rx="3" stroke="currentColor" strokeOpacity="0.14" strokeWidth="1.25" />
        {/* The note hangs from the pin, so it is the pin the swing turns about. */}
        <g className="empty-art-swing">
          <rect
            x="46"
            y="28"
            width="28"
            height="26"
            rx="3"
            fill="var(--art-surface)"
            stroke="var(--art-accent)"
            strokeOpacity="0.6"
            strokeWidth="1.5"
          />
          <path d="M51 38h18M51 44h12" stroke="currentColor" strokeOpacity="0.24" strokeWidth="1.75" />
        </g>
        <circle cx="60" cy="28" r="3.5" fill="var(--art-accent)" />
      </g>
    </Art>
  );
}

/**
 * A hard hat with a stripe being painted on: for Cantieri.
 *
 * Same "a mark is being made" cycle as the documents pen, on the object the
 * module is named after — a crane or a barrier would be a stock illustration of
 * "construction", where the hat is what a person on site actually wears.
 */
function SiteArt() {
  return (
    <Art>
      <Shadow rx={24} />
      <Sparkles
        spots={[
          [20, 28, 0.95],
          [101, 36, 0.75],
          [24, 70, 0.6],
        ]}
      />
      <g className="empty-art-stack">
        <g className="empty-art-hoverpop">
          {/* One silhouette, dome AND crown ridge: the raised block on top is
              the whole difference between a hard hat and a mushroom, and it
              disappears the moment the dome is drawn as a clean semicircle. */}
          <path
            d="M34 62v-10a20 20 0 0 1 20-20v-2a3 3 0 0 1 3-3h6a3 3 0 0 1 3 3v2a20 20 0 0 1 20 20v10Z"
            fill="var(--art-surface)"
            stroke="currentColor"
            strokeOpacity="0.35"
            strokeWidth="2"
          />
          {/* The ridge carried down the shell. */}
          <path d="M54 32v16M66 32v16" stroke="currentColor" strokeOpacity="0.22" strokeWidth="1.75" />
          <path
            className="empty-art-written"
            d="M43 50h34"
            stroke="var(--art-accent)"
            strokeWidth="2.25"
            strokeDasharray="34"
          />
          {/* The brim, last, so it sits over the foot of the shell. */}
          <path
            d="M28 62h64a4 4 0 0 1 0 8H28a4 4 0 0 1 0-8Z"
            fill="var(--art-surface)"
            stroke="currentColor"
            strokeOpacity="0.35"
            strokeWidth="1.75"
          />
        </g>
      </g>
    </Art>
  );
}

/**
 * A van with its wheels turning, on a moving road: for Mezzi.
 *
 * The road is outside the floating group and the wheels turn on their own
 * axles, so the vehicle reads as travelling rather than as bouncing. No ground
 * shadow: the road already is the ground, and two of them stack up as clutter.
 */
function VehicleArt() {
  return (
    <Art>
      <Sparkles
        spots={[
          [20, 24, 0.95],
          [102, 32, 0.75],
          [24, 62, 0.6],
        ]}
      />
      <g className="empty-art-stack">
        <g className="empty-art-hoverpop">
          <path
            d="M30 72V48a4 4 0 0 1 4-4h32v28Z"
            fill="var(--art-surface)"
            stroke="currentColor"
            strokeOpacity="0.34"
            strokeWidth="1.75"
          />
          <path
            d="M66 44h13l11 14v14H66Z"
            fill="var(--art-surface)"
            stroke="currentColor"
            strokeOpacity="0.34"
            strokeWidth="1.75"
          />
          <path
            d="M70 49h8l7 9h-15Z"
            fill="var(--art-accent)"
            fillOpacity="0.18"
            stroke="var(--art-accent)"
            strokeOpacity="0.6"
            strokeWidth="1.25"
          />
          <path d="M36 54h20M36 60h13" stroke="currentColor" strokeOpacity="0.18" strokeWidth="1.75" />
        </g>
        <g className="empty-art-wheel empty-art-wheel-1">
          <circle cx="44" cy="72" r="6" fill="var(--art-surface)" stroke="currentColor" strokeOpacity="0.45" strokeWidth="2" />
          <path d="M44 68v8M40 72h8" stroke="currentColor" strokeOpacity="0.25" strokeWidth="1.5" />
        </g>
        <g className="empty-art-wheel empty-art-wheel-2">
          <circle cx="80" cy="72" r="6" fill="var(--art-surface)" stroke="currentColor" strokeOpacity="0.45" strokeWidth="2" />
          <path d="M80 68v8M76 72h8" stroke="currentColor" strokeOpacity="0.25" strokeWidth="1.5" />
        </g>
      </g>
      {/* The road stays put while the van floats: it is what the float is against. */}
      <path
        className="empty-art-road"
        d="M16 82h88"
        stroke="currentColor"
        strokeOpacity="0.22"
        strokeWidth="2"
        strokeDasharray="10 8"
      />
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
 * A sheet with an arrow dropping out of it onto a shelf: for Esportazioni.
 *
 * The arrow leaves the page rather than entering it, which is the one thing
 * that separates an export from an upload at a glance.
 */
function ExportArt() {
  return (
    <Art>
      <Shadow rx={24} />
      <Sparkles
        spots={[
          [21, 27, 0.95],
          [100, 35, 0.75],
          [25, 68, 0.6],
        ]}
      />
      <g className="empty-art-stack">
        <g className="empty-art-card empty-art-card-back-1">
          <Sheet opacity={0.18} />
        </g>
        <g className="empty-art-card empty-art-card-front">
          <rect
            x="34"
            y="18"
            width="52"
            height="44"
            rx="5"
            fill="var(--art-surface)"
            stroke="currentColor"
            strokeOpacity="0.3"
            strokeWidth="1.5"
          />
          <path d="M43 30h22" stroke="currentColor" strokeOpacity="0.4" strokeWidth="2.5" />
          <path d="M43 41h34M43 49h26" stroke="currentColor" strokeOpacity="0.16" strokeWidth="1.75" />
        </g>
        {/* Arrow drawn around (0,0) = its tip, so the keyframes only translate it. */}
        <g className="empty-art-arrow">
          <path d="M0 -14v16M-6 -4 0 2 6 -4" stroke="var(--art-accent)" strokeWidth="2.5" />
        </g>
        <path d="M42 78h36" stroke="currentColor" strokeOpacity="0.3" strokeWidth="2" />
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
  clock: ClockArt,
  documents: DocumentsArt,
  calendar: CalendarArt,
  schedule: ScheduleArt,
  clear: ClearArt,
  search: SearchArt,
  inbox: InboxArt,
  board: BoardArt,
  site: SiteArt,
  vehicle: VehicleArt,
  people: PeopleArt,
  place: PlaceArt,
  export: ExportArt,
  history: HistoryArt,
  alert: AlertArt,
};

/**
 * The decorative scene at the top of an empty state.
 *
 * Exported on its own as well as through `<EmptyState art>` because a few
 * screens draw their own layout around one.
 */
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
