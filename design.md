# sonoQui — Design System

Single source of truth for product UI. Web (Tailwind v4 + Material-3 tokens) and mobile (React Native StyleSheet via `packages/shared/design`) consume the same scale.

## 1. Brand

- **Name in product copy:** `sonoQui` (lowercase `c`, capital `S`, rest lowercase). Never `CiSono`, never `SonoQui` in user-facing strings. Marketing tagline: _"Una timbratura semplice. Per chi c'è."_
- **Logo placeholder:** word-mark only in v1, no separate icon. Letter pair `ciS` accented in primary; rest in on-surface.
- **Tone of voice:** Italian-first, second-person plural ("voi" only in legal docs; "tu" in app). Avoid English jargon ("login" → "accedi", "submit" → "invia").

## 2. Color tokens

All colors expressed as CSS custom properties under `:root` (web) and as constants exported from `packages/shared/src/design/colors.ts` (mobile). Both refer to the **same hex values** — single edit propagates.

| Token | Hex | Use |
|---|---|---|
| `--color-primary` | `#b25500` | Primary CTAs, header background, branded accents |
| `--color-on-primary` | `#ffffff` | Text on primary background |
| `--color-primary-container` | `#ffe0c8` | Selected nav item, badge "branded" |
| `--color-on-primary-container` | `#5a2a00` | Text on primary-container |
| `--color-surface` | `#fffbf8` | App background |
| `--color-on-surface` | `#1f1b16` | Default body text |
| `--color-surface-variant` | `#f3ece5` | Card borders, secondary buttons, dividers |
| `--color-on-surface-variant` | `#514440` | Muted text, form labels |
| `--color-outline` | `#847872` | Input borders, focus ring base |
| `--color-success` | `#1e7a3a` | "Al lavoro" badge, success toasts |
| `--color-warning` | `#a67700` | "In pausa", anomaly flags, mock-location |
| `--color-error` | `#ba1a1a` | Errors, destructive buttons |
| `--color-info` | `#0064a5` | Reserved (info banners) |

State-colored badges always use a 0.12 alpha fill of the same hue (no separate palette).

## 3. Typography

- **Web sans:** `Inter` (system fallback `ui-sans-serif, system-ui, sans-serif`)
- **Mobile sans:** platform default (San Francisco / Roboto). No custom font in v1 — bundle size matters.
- **Numeric:** tabular figures everywhere stamps render (`font-variant-numeric: tabular-nums`).

Type scale (single ladder, both platforms):

| Token | Size | Line | Weight |
|---|---|---|---|
| `text-display` | 32 | 40 | 800 |
| `text-h1` | 24 | 32 | 700 |
| `text-h2` | 18 | 24 | 600 |
| `text-body` | 14 | 20 | 400 |
| `text-body-strong` | 14 | 20 | 600 |
| `text-caption` | 12 | 16 | 500 |

Headings never use color tokens other than `on-surface` or `on-primary`.

## 4. Spacing

4-pt grid. Tokens: `space-1=4`, `space-2=8`, `space-3=12`, `space-4=16`, `space-5=24`, `space-6=32`, `space-8=48`, `space-10=64`. No off-grid values.

## 5. Radius + elevation

- `radius-sm`: 6
- `radius-md`: 8 (default button, input)
- `radius-lg`: 12 (cards on mobile)
- `radius-pill`: 999 (badges)

Elevation: one shadow only — `shadow-card: 0 1px 2px rgba(0,0,0,0.06)`. Modals don't shadow; they use the overlay (`rgba(0,0,0,0.4)`) for separation.

## 6. Components

Both platforms expose the same six primitives. Web maps to Tailwind classes (already in `apps/web/src/index.css`); mobile maps to RN components in `packages/shared/src/design/native.tsx`.

| Primitive | Web class | Mobile component | Notes |
|---|---|---|---|
| Button — primary | `.btn.btn-primary` | `<Button variant="primary">` | Big CTA. Min height 44 (mobile) / 36 (web). |
| Button — secondary | `.btn.btn-secondary` | `<Button variant="secondary">` | Outline-feel using surface-variant. |
| Button — danger | `.btn.btn-danger` | `<Button variant="danger">` | Destructive (delete, force-reject). |
| Input | `.input` | `<Input>` | Single line, 12px vertical padding. Labels go above with `.label`. |
| Card | `.card` | `<Card>` | 16px padding, radius-md (web) / radius-lg (mobile). |
| Badge | `.badge` (+ tone modifier) | `<Badge tone="ok|warn|err|muted">` | Pill, caption-size. |

## 7. State badges (recurring)

| State | Web class | Tone token | Italian label |
|---|---|---|---|
| Clocked-in | `.badge.badge-ok` | success | Al lavoro |
| On break | `.badge.badge-warn` | warning | In pausa |
| Off the clock | `.badge.badge-muted` | surface-variant | Fuori servizio |
| Mock location flagged | `.badge.badge-warn` | warning | mock |
| Stamp deleted | `.badge.badge-err` | error | annullata |

## 8. Iconography

System icons only (browser-native emoji or Material icons font via CDN later). No custom icon set in v1. Status states use color, not icon.

## 9. Motion

- Button press: opacity → 0.6 on press, no transform. RN `Pressable` default. Web `:hover` uses filter brightness 1.05.
- Modal: fade-in only, 120ms. No slide.
- No skeletons; loading states use the literal `…` ellipsis or `<ActivityIndicator>`.

## 10. Accessibility

- WCAG 2.1 AA contrast — token pairs above already verified.
- Hit targets ≥ 44pt (mobile), 36px (web pointer; touch breakpoint bumps to 44).
- All inputs paired with `<label>` (web) or `accessibilityLabel` (mobile).
- Color is never the sole signal — every state badge has a text label too.

## 11. Italian copy conventions

- Dates: `DD/MM/YYYY`. Times: `HH:mm` (24h).
- Currency: `€ 4,20` (space, comma decimal).
- Verbs in imperative for buttons: "Salva", "Annulla", "Invita".
- Errors as full Italian sentences ("Sei fuori dall'area consentita."), never bare codes.

## 12. Editing this doc

Tokens listed here are the contract. When changing a value:
1. Edit `packages/shared/src/design/tokens.ts` (the canonical source).
2. Edit `apps/web/src/index.css` `:root` block to match — both files reference this section's table.
3. Update this doc.
