# PageHeader Component Design Specification

## 1. Background & Goals

The app currently has two separate header implementations:

- `SiteHeader` (`apps/www/src/components/SiteHeader.tsx`) — used on interior pages; renders breadcrumbs in the left half and auth links in the right half; no logo or site name.
- An inline `<header>` inside `HomePage` (`apps/www/src/routes/index.tsx`) — shows the logo and nav but no breadcrumbs; auth logic is duplicated in its own `handleSignOut` handler.

These two diverge visually and behaviourally, duplicate auth logic, and make it hard to keep the header consistent as the app grows.

**Goal:** Replace both with a single `<PageHeader>` component that:

- Renders logo + site name + nav-menu trigger in the top row.
- Renders breadcrumbs in a second row (hidden on the home route).
- Sticks to the top of the viewport as the user scrolls (desktop: full header; mobile: breadcrumb row only).
- Contains one canonical sign-out handler.
- Meets WCAG 2.1 AA accessibility requirements.

---

## 2. Component API

```typescript
// apps/www/src/components/PageHeader.tsx

export type Breadcrumb = {
	/** Visible text for this crumb. */
	label: string
	/**
	 * If provided, the crumb is rendered as a link.
	 * Omit for the current (last) crumb — it will receive aria-current="page".
	 */
	to?: string
}

export interface PageHeaderProps {
	/**
	 * Breadcrumb trail describing the current page's position in the hierarchy.
	 * Omit (or pass an empty array) on the home route — the breadcrumb row will
	 * not render. A "Home" crumb before this list is always rendered automatically.
	 */
	breadcrumbs?: Breadcrumb[]
}

export default function PageHeader(props: PageHeaderProps): JSX.Element
```

### Usage examples

```tsx
// Home route — no breadcrumb row
<PageHeader />

// "My Garden" page
<PageHeader breadcrumbs={[{ label: 'My Garden' }]} />

// Listing detail page
<PageHeader breadcrumbs={[{ label: listing.name }]} />

// Hypothetical two-level trail
<PageHeader breadcrumbs={[
	{ label: 'My Garden', to: '/listings/mine' },
	{ label: 'Edit Listing' },
]} />
```

The `Breadcrumb` type must be exported so callers can type intermediate values without importing from an internal path.

---

## 3. Visual Layout

### 3.1 Row 1 — site bar (all routes, all viewports)

```
[ 🍑 Pick My Fruit ]                         [ ☰ / avatar ]
```

| Slot | Content |
|---|---|
| Left | Fruit emoji + "Pick My Fruit" wordmark; the whole unit links to `/` |
| Right | Nav-menu trigger (see Section 6) |

### 3.2 Row 2 — breadcrumbs (all routes except home)

```
Home  /  My Garden
```

Rendered as an `<ol>` inside `<nav aria-label="Breadcrumb">`. The last crumb has `aria-current="page"` and is not a link. Preceding crumbs are `<Link>` elements. The `/` separator between items is purely decorative and generated with CSS `::before`.

Long trails wrap naturally; revisit only if a real problem appears.

### 3.3 Home-route variant

Row 2 is absent entirely. Row 1 sticks to the top (matching the general desktop rule — see Section 5).

---

## 4. Responsive Behaviour

| Viewport | Row 1 | Row 2 | Nav trigger |
|---|---|---|---|
| ≥ 768 px (desktop / tablet) | Full-width flex row; logo left, trigger right | Below row 1; full-width flex row | Trigger always visible; menu opens on click |
| < 768 px (mobile) | Full-width flex row; logo left, trigger right | Sticky strip below row 1 | Same as desktop |
| 350 px (minimum) | Logo text may truncate but must not overflow | Breadcrumbs wrap if needed | Trigger always visible |

The logo emoji and the nav trigger must remain reachable at all widths down to 350 px. The wordmark "Pick My Fruit" may be visually hidden below a threshold if needed, but this is implementation latitude — either approach is acceptable.

---

## 5. Sticky Behaviour

The sticky rules are achieved inside **one `<header>` element** (see Section 8).

### Desktop (≥ 768 px) and home route

The entire `<header>` (`position: sticky; top: 0`) sticks. Both rows travel with the viewport.

### Mobile (< 768 px) — interior pages only

- Row 1 (site bar) scrolls away with the page.
- Row 2 (breadcrumb `<nav>`) sticks to `top: 0`.

Implementation approach: at the mobile breakpoint, the `<header>` itself is `position: static`. The breadcrumb `<nav>` inside it is `position: sticky; top: 0`. This keeps both navs inside the same `<header>` landmark while achieving the split-scroll effect.

All sticky elements must have a `background-color` set so content does not bleed through.

---

## 6. Navigation Menu

### When it appears

The nav-menu trigger is always visible. It is not an "auth-only" control — it is a general site navigation menu that also contains auth actions.

### Trigger appearance

- **Signed out:** hamburger icon (SVG).
- **Signed in:** user avatar — `<img>` if `session.user.image` is set; otherwise a circle containing initials derived from the first letter of each word in `session.user.name` (e.g. "Jane Doe" → "JD"). If `session.user.name` is empty, fall back to a generic person icon.

The trigger must have an accessible label: `aria-label="Open navigation menu"` when closed, `aria-label="Close navigation menu"` when open.

### Menu contents

```
My Garden          (signed-in only; links to /listings/mine)
─────────────────
Sign In            (signed-out only; links to /login)
Sign Out           (signed-in only; calls authClient.signOut)
```

The separator is a visual `<hr>` between navigation links and auth actions; omit it if only one group is present.

### Implementation

Use a Kobalte `DropdownMenu` (or `Popover`) for the menu panel. This provides:

- Focus trap while open.
- `Escape` closes the menu.
- `aria-expanded` state on the trigger.
- Portal rendering to avoid z-index conflicts with page content.

See Section 11 (QA) for the Kobalte z-index note.

---

## 7. Accessibility

### Landmarks

```html
<header>                          <!-- banner landmark (one per page) -->
  <nav aria-label="Site">         <!-- site navigation -->
    <!-- logo · wordmark · menu trigger -->
  </nav>
  <nav aria-label="Breadcrumb">   <!-- breadcrumb navigation -->
    <ol>…</ol>
  </nav>
</header>
```

The breadcrumb `<nav>` must be omitted entirely (not merely hidden) on the home route so screen readers encounter only one `<nav>` inside the banner landmark.

### Skip link

Add a visually-hidden skip link as the very first focusable element in `<body>`:

```html
<a href="#main-content" class="skip-link">Skip to main content</a>
```

It becomes visible on focus. Each page's `<main>` element must carry `id="main-content"`. This is a cross-cutting concern — the skip link belongs in `RootShell` inside `__root.tsx`, not inside `PageHeader`.

### Keyboard navigation

| Key | Behaviour |
|---|---|
| `Tab` | Moves focus through logo link, menu trigger, breadcrumb links in DOM order |
| `Enter` / `Space` | Activates focused link or opens/closes the menu trigger |
| `Escape` | Closes the nav menu and returns focus to the trigger |
| Arrow keys | Navigate items inside the open menu (handled by Kobalte) |

### Reduced motion

The nav menu open/close animation must respect `prefers-reduced-motion`. The global reset in `base.css` already zeroes transition durations for reduced-motion users, so no extra work is needed in `PageHeader.css` as long as animations use CSS `transition` or `animation` properties (not JS-driven transforms outside CSS).

### Breadcrumb current page

The last breadcrumb item must carry `aria-current="page"` on its inner `<span>` (not on its `<li>`). It must not be rendered as a link.

---

## 8. DOM Structure

```html
<header class="page-header">

  <nav class="page-header__site-nav" aria-label="Site">
    <a href="/" class="page-header__logo">
      <span class="page-header__logo-icon" aria-hidden="true">🍑</span>
      <span class="page-header__logo-text">Pick My Fruit</span>
    </a>

    <!-- Kobalte DropdownMenu trigger -->
    <button
      type="button"
      class="page-header__menu-trigger"
      aria-label="Open navigation menu"
    >
      <!-- hamburger SVG or avatar img/initials/icon -->
    </button>
    <!-- menu panel rendered via Kobalte portal -->
  </nav>

  <!-- Omit this entire element on the home route -->
  <nav class="page-header__breadcrumb" aria-label="Breadcrumb">
    <ol>
      <li><a href="/">Home</a></li>
      <!-- ...intermediate crumbs as <a> elements... -->
      <li><span aria-current="page">My Garden</span></li>
    </ol>
  </nav>

</header>
```

BEM-style class names (`page-header__*`) are used here to avoid collisions with the existing `.breadcrumb` and `.header-nav` classes in `SiteHeader.css` and `index.css`. The implementer may choose any scoping convention consistent with the project's CSS practices, but must not reuse the existing class names while both components coexist during migration.

---

## 9. CSS Notes

- Place all rules in `@layer components` inside `PageHeader.css`, imported by `PageHeader.tsx`.
- Scope all rules under `.page-header` (or the chosen root class) to avoid bleed into route styles.
- Do **not** use `@layer page` — `PageHeader` is a shared component, not a route.
- The sticky breadcrumb strip on mobile needs a `z-index` high enough to clear scrolling page content but lower than Kobalte's portal overlay. A value in the range `10–50` is appropriate; verify against Kobalte's default (see QA checklist).
- Background for sticky rows: use `var(--color-background)` so content below does not show through.
- Breadcrumb separator: generate with `li + li::before { content: '/'; }`. CSS `::before` is already invisible to accessibility trees.
- Avatar initials circle: use a `<span>` with fixed `width` and `height`, `border-radius: 50%`, `background: var(--color-secondary)`, white text, centered with flexbox.
- Rely on Kobalte for menu panel positioning; do not manually set `position: absolute` on the panel itself.

---

## 10. Implementation Checklist

- [ ] Create `apps/www/src/components/PageHeader.tsx`
- [ ] Create `apps/www/src/components/PageHeader.css`
- [ ] Export `Breadcrumb` type from `PageHeader.tsx`
- [ ] Logo: emoji + wordmark wrapped in `<Link to="/">`
- [ ] Nav trigger: hamburger when signed out; avatar (image → initials → icon fallback) when signed in
- [ ] Nav menu: Kobalte `DropdownMenu` with portal; contents per Section 6
- [ ] Sign-out handler: call `authClient.signOut()` then navigate to `/` — same pattern as current `SiteHeader.tsx`
- [ ] Breadcrumb row: omit from DOM entirely when `props.breadcrumbs` is absent or empty
- [ ] "Home" crumb: always prepended automatically
- [ ] `aria-current="page"` on the last crumb's inner `<span>`
- [ ] Sticky behaviour: full header on desktop; breadcrumb-only on mobile (Section 5)
- [ ] `background-color` set on all sticky elements
- [ ] `aria-label` toggling on menu trigger (`"Open navigation menu"` / `"Close navigation menu"`)
- [ ] Avatar: render `<img>` when `session.user.image` is set; else initials from `session.user.name`; else generic person icon
- [ ] Reduced motion: confirm CSS `transition`/`animation` are used so the `base.css` global reset applies
- [ ] Add `id="main-content"` to the `<main>` element in each existing route
- [ ] Add skip link to `RootShell` in `__root.tsx`
- [ ] Replace `<SiteHeader>` in `listings/mine.tsx` with `<PageHeader breadcrumbs={[{ label: 'My Garden' }]} />`
- [ ] Replace `<SiteHeader>` in `listings.$id.tsx` with `<PageHeader>`
- [ ] Replace inline `<header>` in `index.tsx` with `<PageHeader />`; remove duplicated `handleSignOut`
- [ ] Check `listings/new.tsx`, `about.tsx`, and any other routes using `<SiteHeader>` and migrate them
- [ ] Delete `SiteHeader.tsx` and `SiteHeader.css`
- [ ] Verify no orphaned `import SiteHeader` or `import './SiteHeader.css'` references remain

---

## 11. QA Checklist

- [ ] **Desktop — all routes:** Full header sticks; content scrolls underneath with correct background visible.
- [ ] **Desktop — home route:** Full header sticks; no breadcrumb row in DOM or accessibility tree.
- [ ] **Mobile (< 768 px) — interior routes:** Site-bar row scrolls away; breadcrumb row sticks at `top: 0`.
- [ ] **Mobile — home route:** Full header sticks; no breadcrumb row.
- [ ] **350 px viewport:** Logo and menu trigger remain tappable; no overflow or horizontal scroll introduced by the header.
- [ ] **Nav menu — signed out:** Trigger shows hamburger; menu contains "Sign In" only; no "My Garden" or "Sign Out".
- [ ] **Nav menu — signed in (with image):** Trigger shows avatar `<img>`; menu contains "My Garden" and "Sign Out"; no "Sign In".
- [ ] **Nav menu — signed in (name only, e.g. "Jane Doe"):** Trigger shows "JD" initials circle.
- [ ] **Nav menu — signed in (empty name):** Trigger shows generic person icon fallback.
- [ ] **Nav menu — keyboard:** `Tab` reaches trigger; `Enter`/`Space` opens menu; arrow keys move focus through items; `Escape` closes and returns focus to trigger.
- [ ] **Breadcrumb — current page:** Last crumb has `aria-current="page"`, is not a link, and is announced as plain text (not a link) by VoiceOver / NVDA.
- [ ] **Breadcrumb — links:** All non-last crumbs are navigable links; clicking them routes correctly via TanStack Router.
- [ ] **Sign-out:** After clicking Sign Out, user is redirected to `/`, session is cleared, and nav menu shows "Sign In".
- [ ] **Skip link:** First `Tab` from the top of the page focuses the skip link; activating it moves focus to `#main-content`.
- [ ] **Kobalte z-index:** Open the nav menu, then interact with a Kobalte `Select` or `Popover` in the page body. Confirm the nav menu panel is not rendered behind any Kobalte portals. Adjust `z-index` on the menu panel if needed. (Kobalte portals use `z-index: 50` in some configurations — verify in context before choosing a value.)
- [ ] **Reduced motion:** With `prefers-reduced-motion: reduce` enabled in OS settings, menu open/close has no visible animation.
- [ ] **Dark mode:** Header background, text, avatar circle, and avatar image remain legible with `color-scheme: dark`.
- [ ] **Accessibility audit:** Run axe or equivalent; no landmark violations, heading-order violations, or contrast failures in the header.

---

## 12. Files to Create / Delete

### Create

| Path | Purpose |
|---|---|
| `apps/www/src/components/PageHeader.tsx` | New unified header component |
| `apps/www/src/components/PageHeader.css` | Component-scoped styles in `@layer components` |

### Delete (after migration is complete)

| Path | Reason |
|---|---|
| `apps/www/src/components/SiteHeader.tsx` | Superseded by `PageHeader` |
| `apps/www/src/components/SiteHeader.css` | Superseded by `PageHeader.css` |

### Modify

| Path | Change |
|---|---|
| `apps/www/src/routes/__root.tsx` | Add skip link to `RootShell` |
| `apps/www/src/routes/index.tsx` | Replace inline `<header>` + duplicated auth logic with `<PageHeader />` |
| `apps/www/src/routes/listings/mine.tsx` | Replace `<SiteHeader>` with `<PageHeader>` |
| `apps/www/src/routes/listings.$id.tsx` | Replace `<SiteHeader>` with `<PageHeader>` |
| `apps/www/src/routes/listings/new.tsx` | Replace `<SiteHeader>` if present |
| `apps/www/src/routes/about.tsx` | Replace `<SiteHeader>` if present |
| Any other route using `<SiteHeader>` | Replace with `<PageHeader>` |
| Each route's `<main>` element | Add `id="main-content"` |
