# RoadScore Driver View — UI/UX Polish Plan (`/driver`)
**Automotive HMI Redesign: Glanceability, Hierarchy & Touch Ergonomics**

---

## 1. Objective & Design Principles

The V1 cockpit is functionally complete but visually flat: everything competes at
the same size and weight, critical text renders at 8–10 px, and content blocks
shift layout when cards arrive. A driver-glance UI must obey stricter rules than
an ops dashboard:

| Principle | Rule for this UI |
|---|---|
| **2-Second Glance** | Speed, next hazard, and score must be readable in < 2 s at arm's length |
| **Visual Hierarchy** | Primary (speed + next hazard) → Secondary (orb, score) → Tertiary (cards, buttons) |
| **Zero Layout Shift** | Alerts must overlay, never push content while driving |
| **Touch Ergonomics** | All interactive targets ≥ 44 px; primary actions reachable one-handed |
| **Night-First Contrast** | OLED black, luminous accents, no large bright surfaces |
| **Automotive Semantics** | Speed-limit = circular road-sign badge; warnings = ISO-ish amber/red vocabulary |

---

## 2. Current-UI Audit (Weaknesses)

Evidence from `web/src/app/driver/page.tsx` + `components/driver/*`:

| # | Weakness | Evidence |
|---|---|---|
| W-1 | **Tiny type everywhere** — 17× `text-[8px]`–`text-[10px]` instances on the main page alone; unreadable on a dash mount or windshield | `page.tsx` instrument row, header pills, footer buttons |
| W-2 | **Speed isn't the hero** — 36 px (`text-4xl`) and sandwiched equally between orb and score; real clusters make speed the dominant element | `page.tsx` instrument row `grid-cols-3` |
| W-3 | **Next hazard has no DOM presence** — the single most important driving fact (what + how far + what to do) lives only inside the canvas; fails a11y and quick-glance tests | `HazardHorizonRadar` canvas-only labels |
| W-4 | **Layout shift on alerts** — Smart Assist cards render in normal flow (`min-h-[74px] flex-1`); every card pushes the footer/buttons down mid-drive | `page.tsx` card dock section |
| W-5 | **Footer buttons are text-first at 10 px** with icons at 13 px — weak affordance, sub-44 px rows | `page.tsx` footer |
| W-6 | **Speed limit is a plain pill** — not the universally recognized circular red-ring sign | `page.tsx` "Limit: 60" |
| W-7 | **Score is bare digits** — no progress affordance; 98 vs 100 indistinguishable at a glance | `page.tsx` score cell |
| W-8 | **HUD mode is a raw mirror** — same dense layout flipped; a windshield reflection needs a *minimal, enlarged, high-contrast* composition, not the full cockpit | `page.tsx` `scaleX(-1)` wrapper |
| W-9 | **Landscape wastes the screen** — portrait stack squishes the radar on wide phones/car head-units | no `landscape:`/`md:` variants in cockpit |
| W-10 | **Dead empty states** — dashed "Smart Assist standing by" box; no sense the system is alive | `page.tsx` card dock |
| W-11 | **No haptic channel** — Tier-1 alerts are audio+visual only; a phone on a mount can vibrate for urgent hazards | — |
| W-12 | **Drawer lacks drag-to-dismiss** — only the small header area closes it | `SimulationStudioDrawer` |

---

## 3. P0 — Layout Hierarchy Rework (highest impact)

### 3.1 New cockpit composition (mobile portrait)

```
┌──────────────────────────────────────────────────────────────┐
│ 🛡️ TrueScore™ │ ● LIVE            ⛽+8% │ 🔔 │ ⟳ pair (44px) │  Slim 40px status bar
├──────────────────────────────────────────────────────────────┤
│  ┌────────────────────────────────────────────────────────┐  │
│  │  🕳️ Severe Pothole · 85m     STAY RIGHT  (target 20)  │  │  ◀ NEXT-MANOEUVRE BAR
│  └────────────────────────────────────────────────────────┘  │     (DOM, overlay, always
│                                                              │      visible when hazards
│                    HAZARD HORIZON CANVAS                     │      exist — W-3)
│                         (flex-1)                             │
│                                                              │
│              ┌─ Speed hero (bottom-left, overlay) ─┐         │
│              │   54                                 │         │
│              │   km/h  Ⓞ 60                         │         │  ◀ 84px digits + circular
│              └──────────────────────────────────────┘         │     limit sign (W-2, W-6)
├───────────────────────────────┬──────────────────────────────┤
│   RIDE DYNAMICS  (orb 120px)  │   TRUESCORE  ◯ 98  ring      │  Secondary row (2-up,
│   a_long/a_lat readouts       │   +0 Deductions (Protected)  │  orb/score get room — W-7)
├───────────────────────────────┴──────────────────────────────┤
│  [🌙 HUD]            [🎙️ Voice]           [🧪 Studio]        │  56px icon-first buttons (W-5)
└──────────────────────────────────────────────────────────────┘
        ▲ Smart Assist cards FLOAT here (absolute, above footer,
          bottom-anchored, pointer-events-auto) — no reflow (W-4)
```

### 3.2 P0 change specs

| ID | Change | Spec |
|---|---|---|
| P0-1 | **Next-Manoeuvre Bar** (`NextHazardBar.tsx`) | DOM overlay at top of radar section showing nearest hazard: glyph + title + live distance (18 px bold) + advisory chip + target speed; empty state hidden. Color-coded left border by severity. Feeds screen readers (`role="status"`), fixing W-3 + L-6 |
| P0-2 | **Hero Speed overlay** | Speed moves to a bottom-left overlay on the radar: `text-[84px]` tabular-nums, `km/h` caption 13 px; circular limit sign (44 px, white disc + 3 px rose ring, black digits) beside it; over-limit → digits turn rose-400 + ring pulses |
| P0-3 | **Cards become floating overlays** | Card dock → `absolute inset-x-3 bottom-[76px] z-30`, `pointer-events-none` wrapper; sections never resize; footer stays planted (W-4) |
| P0-4 | **Secondary row 2-up** | Orb enlarged to 120 px with inline `a_long`/`a_lat` numerals; score gets a 64 px progress ring (SVG `strokeDasharray`) + `+0 Deductions (Protected)` chip (W-7) |
| P0-5 | **Footer 56 px icon-first buttons** | 20 px icons over 9 px labels, min-h 56 px, full-width thirds; active states keep current color language (W-5) |
| P0-6 | **Typography floor** | Nothing below 10 px anywhere; body labels 11–12 px; touch/copy minimums enforced by token audit (W-1) |
| P0-7 | **Header slim-down** | 40 px bar: TrueScore chip, live/sim dot + label, eco pill; pair + alerts icons as 44 px hit-slotted buttons |


---

## 4. P1 — Windshield HUD 2.0, Landscape & Motion

### 4.1 HUD Mode 2.0 (W-8)
Today: `scaleX(-1)` on the full dense cockpit. Proposal — HUD mode swaps to a
**dedicated minimal composition** (still mirrored, OLED black):
- Speed at 128 px, center-dominant; limit sign at 56 px.
- Next-manoeuvre line: `🕳️ Pothole · 85m · Stay Right` at 24 px bold.
- Score ring small, bottom-right; everything else (orb, cards, header, footer) hidden.
- One-tap exit: full-screen invisible tap zone (mirrored) + auto-dim after 10 s idle.
- Implementation: `hudMode ? <HudMinimalLayout/> : <FullCockpit/>` inside the same
  `scaleX(-1)` wrapper.

### 4.2 Landscape / head-unit layout (W-9)
`md:` and `landscape:` variants: radar left (60%), right rail stacks
speed+limit, orb, score; footer docks right edge vertically; drawer becomes a
right-side sheet (`inset-y-0 right-0 w-80`) instead of bottom sheet.

### 4.3 Motion & liveliness
- **Rolling speed digits**: framer-motion `AnimatePresence` per-digit slide (or spring `transform` on value) at 5 Hz throttle to avoid churn.
- **Score ring tween** on change; **shield pulse** on exoneration already exists.
- **Ambient idle state** (W-10): radar shows a slow "scanning" sweep line + `Path Clear` shimmer pill when no hazards (uses existing `animate-shimmer`).
- **Coasting glow** (ties to Eco-Glide): while `snapshot.coasting`, hero speed digits and radar edge lines tint emerald-400 — the cabin "breathes green" while saving fuel.
- **Card arrival** also nudges the Next-Manoeuvre bar (subtle shared-layout spring) instead of pushing sections.

### 4.4 Haptic channel (W-11)
`navigator.vibrate([80,40,80])` on Tier-1 hazard alerts and `[40]` on
exoneration, guarded by `'vibrate' in navigator` + a drawer toggle
(`Haptics: on/off`, default on). Zero-cost safety channel for mounted phones.

### 4.5 Drawer ergonomics (W-12)
`drag="y"` + `dragConstraints { top: 0 }` + velocity-based dismiss
(`onDragEnd` → close when offset > 120 px or velocity > 500). Add scrim tap-to-close.


---

## 5. P2 — Depth, Texture & Delight (do after P0/P1)

| ID | Enhancement |
|---|---|
| P2-1 | **Glass depth on overlays**: cards/bar get `backdrop-blur-md` + 1 px gradient border (emerald→transparent) instead of flat zinc |
| P2-2 | **Radar weathering**: subtle film-grain/scanline overlay at 3% opacity for the "instrument cluster" feel (pure CSS, GPU-cheap) |
| P2-3 | **Time + trip chip**: header gains clock (`HH:MM`) and trip elapsed time once V2 trip lifecycle (M2) lands |
| P2-4 | **Severity color language unification**: extract `severityColor()` helper shared by radar, cards, bar, and drawer buttons (today colors are per-file literals) |
| P2-5 | **Focus-visible rings** on all interactive elements (a11y) + `prefers-reduced-motion` already honored globally |
| P2-6 | **Sound-off affordance**: when voice is muted, Tier-1 alerts escalate the card to a full-width flashing banner (existing `animate-alert-flash`) so muting never blinds the driver |

---

## 6. Design Tokens (single source of truth)

Add to `globals.css` as CSS vars; reference from all driver components:

```css
/* Driver cockpit tokens */
--drv-bg: #000000;            /* OLED black */
--drv-surface: rgba(10,10,10,0.85);
--drv-border: #1c1c1c;
--drv-text: #ffffff;
--drv-text-dim: #8b8b94;      /* bumped from #666 for contrast */
--drv-accent: #10b981;        /* emerald — safe/protected/eco */
--drv-warn: #f59e0b;          /* amber — moderate */
--drv-danger: #f43f5e;        /* rose — harsh/critical */
--drv-info: #38bdf8;          /* sky — water/info */
--drv-curve: #a78bfa;         /* violet — curves */

/* Type scale (px) — nothing below 10 */
--drv-t-micro: 10; --drv-t-caption: 12; --drv-t-body: 13;
--drv-t-bar: 18; --drv-t-hero: 84; --drv-t-hud: 128;

/* Touch */
--drv-touch: 44px; --drv-touch-lg: 56px;
```

---

## 7. File-by-File Change List

| File | Changes |
|---|---|
| `app/driver/page.tsx` | Recompose layout (hero overlay, 2-up secondary row, floating card dock, footer sizing); HUD minimal branch; landscape classes; vibrate hooks on sim events; clock chip |
| `components/driver/NextHazardBar.tsx` | **New** — P0-1 (DOM next-manoeuvre overlay, `role="status"`) |
| `components/driver/SpeedHero.tsx` | **New** — P0-2 (84 px digits + circular limit sign + over-limit pulse + coasting glow) |
| `components/driver/ScoreRing.tsx` | **New** — P0-4 (SVG progress ring + deductions chip) |
| `components/driver/HudMinimalLayout.tsx` | **New** — §4.1 minimal mirrored composition |
| `components/driver/TrueScoreCards.tsx` | Overlay positioning contract, glass styling, shared-layout nudge |
| `components/driver/HazardHorizonRadar.tsx` | Ambient scanning sweep when idle; emerald edge tint while coasting; remove pill labels collision with NextHazardBar (keep canvas pills, they track markers) |
| `components/driver/RideDynamicsOrb.tsx` | Size to 120 px container; add numeric readouts under dial |
| `components/driver/SimulationStudioDrawer.tsx` | Drag-to-dismiss, scrim, right-sheet variant on `md:`, haptics toggle |
| `components/driver/LaunchModal.tsx` | Token migration only |
| `globals.css` | Token block (§6); no new keyframes needed (reuse shimmer/pulse/flash) |


---

## 8. Milestones & Validation

| MS | Scope | Done when |
|----|-------|-----------|
| **UI-1 (P0)** | P0-1…P0-7: NextHazardBar, SpeedHero, floating cards, 2-up secondary row, footer 56px, type floor, slim header | 360×740 screenshot review: speed/hazard/score readable at arm's length; zero reflow when cards arrive; `tsc`/`eslint`/`build` green |
| **UI-2 (P1)** | HUD 2.0 minimal layout, landscape rail, rolling digits, ambient/coasting states, haptics, drawer drag | HUD mirror shows only 3 elements at high contrast; landscape usable; vibrate fires on Tier-1 (Android Chrome) |
| **UI-3 (P2)** | Glass depth, texture, tokens migration, severity helper, focus rings | Token audit: zero `text-[8px]`/`text-[9px]` left in driver feature; no per-file color literals for severity |

**Validation protocol per milestone:**
1. `tsc --noEmit` + `eslint` clean on all touched files.
2. `next build` succeeds; `/driver` serves 200.
3. Manual device matrix: 360×740 (small Android), 390×844 (iPhone), 820×1180 portrait/landscape (tablet/head-unit), `prefers-reduced-motion` on.
4. Glance test: within 2 s — current speed, next hazard + distance + advisory, score state.
5. Night test: HUD mode readable as windshield reflection (mirror + contrast).
6. Sim smoke suite (24 asserts) must stay green — UI rework must not touch simulator logic.

**Dependencies:** P2-3 needs V2-plan M2 (trip lifecycle). Otherwise this plan is
independent of, and compatible with, `DRIVER_VIEW_V2_PLAN.md` M2–M5; suggested
order: **UI-1 → M2/M3 (map) → UI-2 → M4/M5 → UI-3** so the map lands in the
redesigned layout once, not twice.

---

## 9. Status
- [x] UI audit complete (12 weaknesses, §2)
- [ ] UI-1 (P0) — ready to implement on approval
- [ ] UI-2 (P1) — pending
- [ ] UI-3 (P2) — pending

