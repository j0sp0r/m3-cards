// Central design-token scale for every M3 card. const.ts's per-card constants
// (e.g. BATTERY_ROW_HEIGHT, COST_CHIP_RADIUS) derive their values from here,
// so the numbers behind "a row is 52px tall" or "a chip has 15px radius"
// live in exactly one place. Card files keep importing the per-card names
// from const.ts as before — this file is the single source of truth behind
// those names, not a replacement import surface.
//
// Where cards genuinely need a different number (e.g. the climate card's
// larger 32px hero radius, or the battery card's taller two-line row), that
// deviation is intentional and documented at the const.ts call site, not
// silently forced onto this scale.

// ---- Radius scale --------------------------------------------------------
export const RADIUS = {
  // Default outer card radius. Every card uses this except the two climate
  // cards, which use `cardHero`/`cardMini` for their larger hero shape.
  card: 28,
  cardHero: 32,
  // Squircle icon-swatch radius, keyed by the icon box size it's paired
  // with. Converges on a ~0.365 radius-to-box ratio across every card that
  // was built with a squircle icon.
  squircle56: 20, // hero header icon (56px box) — weather/media
  squircle44: 16, // header icon-swatch (44px box)
  squircle52: 19, // "hero" main icon (52px box) — cost/summary
  squircle32: 12, // list-row icon (32px box) — top-consumers/battery
  squircle30: 11, // list-row icon (30px box) — power-list/cost-tariff
  squircle28: 10, // metric-chip icon (28px box) — power-summary
  // List-row corner radius (resting / pressed-morph target).
  row: 18,
  rowActive: 11,
  // Chip / pill radius, used by every small icon+text badge.
  chip: 15,
  // The inner corners of a connected control — the joints between its
  // parts. Its outer ends stay fully round (half its height); the joints are
  // squared off to this, so the parts read as one shape rather than as
  // separate buttons. The climate card's `expressive` setpoint is the first.
  segmentInner: 8,
} as const;

// ---- Height scale ---------------------------------------------------------
export const HEIGHT = {
  // Single-line list row (power-list, top-consumers, cost tariff row).
  rowStandard: 52,
  // Two-line list row with a name + progress bar (battery card).
  rowTall: 56,
  // Compact/idle row shown inside an expanded "N more" section.
  rowCompact: 38,
  // Expand/collapse toggle button ("N weitere anzeigen").
  toggle: 44,
  // A connected control (see RADIUS.segmentInner). Below a standard row,
  // above a compact one: it holds a 22px setpoint numeral with a caption.
  segmented: 42,
} as const;

// ---- Spacing ---------------------------------------------------------------
export const SPACING = {
  rowGap: 6,
  // The seam between the parts of a connected control. Narrower than rowGap
  // on purpose: wide enough to show where one press target ends, narrow
  // enough that the parts still read as one control.
  segmentGap: 4,
} as const;

// ---- Motion -----------------------------------------------------------------
// Easing itself lives in shared/animation.ts (STANDARD_EASING) since it's
// consumed as a CSS value, not a plain number; durations are grouped here.
export const DURATION_MS = {
  // FLIP reorder animation shared by every sortable list card.
  flip: 300,
  // Digit-roll / counter animations (deliberately snappier).
  roll: 350,
} as const;

// ---- Typography (reference only) ------------------------------------------
// Already consistent across every card at the time of writing — documented
// here for new cards to match, not mechanically wired into existing inline
// CSS templates (which would churn a lot of diff for zero behavior change).
export const FONT = {
  headerName: { size: 15, weight: 700 },
  headerSubtitle: { size: 12, weight: 400, opacity: 0.65 },
  rowName: { size: 13, weight: 500 },
  rowValue: { size: 14, weight: 700 },
} as const;

// ---- Color palette ----------------------------------------------------------
// Canonical hex values for the M3 mode/domain palette. THEME_COLOR_TOKENS
// (const.ts) covers free-form HA color names for user overrides; this is the
// project's own default palette used when a card falls back to its built-in
// accent rather than a user override.
export const PALETTE = {
  off: "#888780",
  heat: "#e57368",
  cool: "#6ba7dc",
  dryAuto: "#5dcaa5",
  fan: "#b8c4c9",
  solar: "#f0a24a",
  grid: "#8f79e0",
  home: "#85b7eb",
  ok: "#81c784",
  light: "#f0c46e",
  media: "#a58fe8",
  cover: "#9fd6bf",
} as const;
