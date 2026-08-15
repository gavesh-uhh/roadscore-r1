---
name: enterprise-ui-design
description: Guidance for building enterprise-grade, work-tool UIs — admin panels, dashboards, internal tools, B2B SaaS, data-heavy consoles — where the job is getting real work done efficiently, not making a marketing impression. Use this whenever the user asks for a dashboard, admin panel, internal tool, data table, CRUD interface, settings page, console, back-office app, or says things like "enterprise UI," "functional not flashy," "like Linear/Stripe/Notion/Claude," or "usable, not a landing page" — even if they don't use those exact words. This is the right skill whenever the interface's primary users will use it daily to accomplish tasks, as opposed to a one-time marketing or portfolio page (for that, use frontend-design instead).
---

# Enterprise UI Design

Approach this as a product designer at a company whose software people use eight hours a day to do their jobs — think Linear, Stripe Dashboard, Notion, Vercel, GitHub, Retool, or Claude's own console. Nobody opens these tools to be impressed; they open them to find something, fix something, or ship something, and close the tab the moment they're done. Every design decision should be judged by one question: does this make the next action faster and less ambiguous? If a choice exists only to look good, cut it.

This is the inverse of a marketing site. A landing page has one visitor, one goal, and thirty seconds to make a case. A work tool has one user who will be back tomorrow, dozens of goals, and needs to move through it without thinking about the interface at all. Optimize for the hundredth visit, not the first impression.

## Read the content first

Before touching layout, get concrete about what the screen actually manages: what entity (users, invoices, deployments, tickets), what actions on it (create, edit, filter, bulk-approve, assign), and what states it can be in (empty, loading, partial, error, permission-denied). If the brief doesn't specify real data, invent plausible domain-specific content — real-looking names, statuses, timestamps, and numbers — never lorem ipsum or "Item 1, Item 2, Item 3." Generic placeholder content makes it impossible to judge whether the density and hierarchy actually work.

## Design principles

**Density over air.** Marketing pages breathe; work tools compress. Default to tighter spacing than feels natural (4/8px scale, rows around 32-40px tall, base text 13-14px, not 16-18px). Whitespace should separate functional groups, not create visual drama. If a screen shows meaningfully fewer rows or fields than the equivalent desktop app because of padding, the padding is wrong.

**Hierarchy through structure, not decoration.** Distinguish primary from secondary by weight, size, and position — a bold 14px label next to a regular 13px value — rather than by color, gradients, or icon size. Reserve color for meaning: one neutral scale for structure (backgrounds, borders, text), one accent for primary actions and current state, and a small fixed set of semantic colors (success/warning/danger/info) that mean exactly one thing each and are never used decoratively.

**Chrome is a wayfinding system, not a hero.** Persistent layout (sidebar nav, top bar, breadcrumbs, tabs) should stay quiet and identical across every screen so the user's spatial memory of the app never resets. There is no hero section, no big centered headline, no marketing-style CTA button — the "hero" of an enterprise screen is the data or the primary list, present immediately, not scrolled to.

**Every state is a real screen, not an afterthought.** Design the empty, loading, partial, error, and populated states as deliberately as the happy path — skeleton loaders that match the eventual layout (not spinners), an empty state with one clear next action (not a full illustration and marketing copy), inline field-level errors next to the field they belong to (not a toast that vanishes), and truncation/overflow handled explicitly (ellipsis + tooltip, or a count badge) rather than left to break.

**Tables and forms are the primary UI, and they have conventions.** Reach for these before inventing something novel:
- Tables: sticky header row, sortable columns with a visible sort indicator, right-aligned numeric/date columns with tabular figures, row-level actions revealed on hover (not always-visible icon clutter), a fixed-height row so the eye can scan, pagination or virtualized scroll for >50 rows, and a persistent filter/search bar above the table rather than a modal.
- Forms: labels above fields (not floating/placeholder-as-label — placeholders disappear exactly when the user needs them), inline validation on blur, grouped related fields under a small section heading, and a save/cancel pattern that matches the stakes (autosave for low-stakes settings, explicit Save for destructive or multi-field changes).
- Status: use small pill/badge components with a consistent shape for every status value in the product (Active/Pending/Failed etc.), color-coded from the same fixed semantic set every time.

**Motion serves feedback, not delight.** Use it for state transitions the user needs to track — a row appearing after creation, a save confirming, a panel sliding in — at 100-200ms with no easing flourish. Nothing should animate just because it can; a work tool that animates for its own sake reads as slow, not polished.

**Respect that this is a tool, not a story.** No scroll-triggered reveals, no illustrated empty states with a friendly mascot, no marketing copy tone ("Welcome to your new favorite way to manage invoices!"). Copy is instructional and terse: button labels are verbs ("Create project," not "Get started"), errors state what happened and how to fix it, empty states state what's missing and the one action to take.

## Typography and color starting points

Default to a UI-native, high-legibility typeface at small sizes — Inter, system-ui, or the OS default stack — rather than a display/editorial face. One family is usually enough; use weight (regular/medium/semibold) to carry hierarchy instead of switching fonts. Use tabular/monospaced figures for any column of numbers so digits align.

For color, start from a neutral gray scale (10-12 steps, cool or true neutral, not warm) for backgrounds/borders/text, pick one brand or product accent color for primary buttons/links/active nav state, and use fixed semantic colors for status only — don't let the accent color double as a status color. Dark and light mode both matter more here than on marketing sites, since people leave these tools open all day; if building in code, define both as token pairs from the start rather than retrofitting.

## When building in React/HTML artifacts

Only base Tailwind utility classes are available (no compiler) — see frontend-design's constraints for the same limitation. Prefer shadcn/ui-style primitives (table, input, select, badge, dialog) over custom-styled divs; mention to the user if shadcn/ui components are used. Keep interactive elements keyboard-accessible (tab order, visible focus rings, Enter/Escape behavior on inputs and dialogs) — this matters more here than on a landing page, since power users will drive the tool by keyboard.

## Self-check before delivering

Look at the screen and ask: could this pass as a screenshot of a real product people pay for and use daily? Specifically check that spacing is tight enough to show real amounts of data, that color is only carrying meaning (not decoration), that every visible state (empty/loading/error) was actually designed rather than skipped, and that nothing on the screen exists purely to look impressive rather than to help someone finish a task.
