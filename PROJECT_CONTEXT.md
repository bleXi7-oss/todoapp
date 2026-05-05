# Doable — Project Context

> Single source of truth for development context. Read this at the start of any new AI session or onboarding.

---

## Overview

**Doable** is a static, frontend-only productivity app for managing daily tasks with optional Google Calendar sync. It is built with plain HTML, CSS, and vanilla JavaScript — no framework, no build step, no backend.

- **Intended audience:** Personal use; shared with friends and family
- **Design philosophy:** Minimalistic, dark-mode-first, fast, and maintainable — complexity is avoided unless it solves a real problem
- **Current maturity:** Production-ready and deployed on GitHub Pages; feature-complete for its intended scope

**Live app:** https://bleXi7-oss.github.io/todoapp/  
**Repository:** https://github.com/bleXi7-oss/todoapp

---

## Stack

| Layer | Technology |
|---|---|
| UI | HTML + CSS (custom properties, CSS Grid) |
| Logic | Vanilla JavaScript (ES modules pattern, no bundler) |
| Auth | Google Identity Services (GIS) token flow |
| External API | Google Calendar API v3 |
| Persistence | `localStorage` |
| Hosting | GitHub Pages (subpath `/todoapp/`) |
| Offline | Service Worker (cache-first, app shell) |
| Install | PWA (`manifest.json`) |

No backend. No database. No framework. No build system.

---

## Core Features

### Task Management

- Create, edit, and delete tasks
- Mark tasks complete/incomplete
- Three priority levels: Low, Medium, High
- Due dates with overdue detection (tasks past due date are visually flagged)
- All edits handled via an inline modal

### Filters & Sorting

- Status filters: All / Active / Completed
- Category filter: All / Inbox / Work / Personal / Family
- Sort modes: Manual (drag order), Due Date, Priority
- Manual drag-and-drop reordering with stable `order` field persisted to `localStorage`

### Google Calendar Integration

- OAuth 2.0 login via Google Identity Services (popup token flow)
- Sync individual tasks to Google Calendar as events
- Displays connected user name and avatar after login
- "Connected to Google" badge in the sidebar widget
- Entirely frontend — tokens are stored in memory only, never sent to a server

### Backup System

- Export all tasks to a JSON file
- Import tasks from a previously exported JSON file
- Import validates the file format and confirms before overwriting
- Export format: `{ "app": "Doable", "version": 1, "exportedAt": "...", "todos": [...] }`

### PWA Support

- `manifest.json` with `start_url: /todoapp/` and `scope: /todoapp/`
- `service-worker.js` with cache-first strategy for the app shell
- Installable on Android and desktop Chrome
- Icons: `icons/icon.svg` (general) + `icons/icon-maskable.svg` (Android safe-zone)
- Standalone display mode (no browser chrome when installed)

### Mobile Support

- Responsive layout (CSS Grid, single-column on narrow viewports)
- Touch-friendly pill controls with `min-height: 36px`
- Custom date picker UX: hidden `<input type="date">` overlaid on a visible label
- Export/import accessible on mobile via sidebar footer
- Category navigation visible on desktop; hidden on mobile to save space

---

## Architecture

### File Responsibilities

| File | Role |
|---|---|
| `index.html` | App shell, all markup, script tags |
| `style.css` | All styles, CSS custom properties, dark mode, responsive breakpoints |
| `app.js` | All app logic: state, store, render, events, drag-and-drop, filters, export/import |
| `googleCalendar.js` | OAuth token flow, GCal API calls, connected widget UI |
| `manifest.json` | PWA metadata, icon definitions, display mode |
| `service-worker.js` | App shell caching, Google origin passthrough |
| `favicon.svg` | Browser tab icon (CSS-based color, not used for Android PWA) |
| `icons/icon.svg` | PWA icon with solid background and inline fills (Android-safe) |
| `icons/icon-maskable.svg` | Android maskable icon; brand mark confined to inner 80% safe zone |

### `app.js` Structure

The file follows a single-module pattern organized into plain objects:

```
utils       — pure helpers (uid, formatDate, etc.)
store       — localStorage read/write, task CRUD, reorder
DOM         — cached element references (populated in initDOM)
render      — all DOM rendering (single entry point: render())
dnd         — drag-and-drop handlers
controller  — user action handlers (add, edit, delete, filter, export/import)
init        — app startup (DOM cache, event binding, SW registration, render)
```

The render cycle is intentionally synchronous and always re-renders the full task list from state. No virtual DOM or diffing.

### `googleCalendar.js` Structure

```
tokenStore   — in-memory access token management
userStore    — connected user profile (name, avatar)
gcalDOM      — cached element references for the widget
gcalLog      — debug log entries
gcalFetch    — authenticated fetch wrapper (clears token on 401)
updateWidget — re-renders the GCal sidebar widget from current state
```

**Critical:** The `handleTokenResponse` function uses a raw `fetch` (not `gcalFetch`) for the userinfo profile call. This is intentional — a profile fetch failure must not clear the Calendar access token.

### localStorage Persistence

- Storage key: `STORAGE_KEY = 'doable_todos_v3'`
- The key is versioned in name only for readability — schema migrations are additive and handled in `store.load()`, so the key never needs to change
- On every load, missing fields on existing todos are filled with defaults (see migration section)

### Task Schema

```js
{
  id:          string,   // uuid-like, generated by utils.uid()
  text:        string,   // task description
  completed:   boolean,
  priority:    'low' | 'medium' | 'high',
  dueDate:     string | null,   // ISO date string "YYYY-MM-DD"
  category:    'Inbox' | 'Work' | 'Personal' | 'Family',
  order:       number,  // used for manual drag sort; multiples of 1000
  calSync:     boolean, // whether to sync this task to Google Calendar
  calEventId:  string | null,
  calSyncedAt: string | null,   // ISO timestamp of last sync
}
```

### Migration Strategy

All schema additions are handled in `store.load()` with additive defaults:

```js
state.todos.forEach((t, i) => {
  if (t.calSync     === undefined) t.calSync     = false;
  if (t.calEventId  === undefined) t.calEventId  = null;
  if (t.calSyncedAt === undefined) t.calSyncedAt = null;
  if (!t.category)                 t.category    = 'Inbox';
  if (t.order       === undefined) t.order       = i * 1000;
});
```

**Rule:** Never change `STORAGE_KEY`. Never delete fields from existing todos. Only add new fields with safe defaults.

### Service Worker

- Caches: `./`, `./index.html`, `./style.css`, `./app.js`, `./googleCalendar.js`, `./favicon.svg`, `./manifest.json`
- Passthroughs (not cached): `accounts.google.com`, `www.googleapis.com`, `fonts.googleapis.com`, `fonts.gstatic.com`
- Strategy: cache-first (serve from cache, fall back to network)
- Must use relative paths to work correctly under the `/todoapp/` GitHub Pages subpath

---

## Google OAuth Setup

### Prerequisites

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create or select a project
3. Enable **Google Calendar API** under APIs & Services → Library
4. Configure **OAuth consent screen**:
   - User type: External
   - App name: Doable
   - Scopes to add:
     - `https://www.googleapis.com/auth/calendar.events`
     - `https://www.googleapis.com/auth/userinfo.profile`
     - `https://www.googleapis.com/auth/userinfo.email`
   - Leave in **Testing** mode (see note below)
   - Add test users under "Test users"
5. Create an **OAuth 2.0 Client ID**:
   - Application type: Web application
   - Authorized JavaScript origins:
     - `http://localhost:3000`
     - `https://bleXi7-oss.github.io`

### Testing Mode

The app intentionally stays in **Testing** mode on the OAuth consent screen. This avoids Google's production verification process (which requires a privacy policy, domain verification, and security audit) while still allowing the app to work for a small group of trusted users added as test users.

**Implication:** Only users added as test users can use Google Calendar sync. Tokens expire after 7 days.

### Token Handling

- Tokens are stored in memory only (never `localStorage`, never a server)
- The GIS popup flow requests all three scopes in a single prompt
- If the userinfo profile fetch returns a non-200 status, the app falls back to "Google Account" as the display name — this must not clear the Calendar token

---

## Local Development Workflow

### Serving locally

```bash
npx serve . --listen 3000
```

**Why port 3000?** The OAuth Client ID has `http://localhost:3000` as an authorized origin. Other ports will get an `origin_mismatch` error from Google.

### Deploying

GitHub Pages auto-deploys from the `main` branch. Standard workflow:

```bash
git add .
git commit -m "your message"
git push
```

Changes are live within ~1 minute at https://bleXi7-oss.github.io/todoapp/

### Subpath Note

The app lives at `/todoapp/`, not at the root. This affects:
- `manifest.json`: `start_url` and `scope` must be `/todoapp/`
- `service-worker.js`: use relative paths (`./index.html` not `/index.html`)
- Any absolute URL references to app assets

---

## PWA Notes

- **Installability:** Works on Android Chrome (Add to Home Screen) and desktop Chrome (install icon in address bar)
- **Icon caching:** Android aggressively caches PWA icons at install time. If icons are updated, users must uninstall and reinstall the app to see the new icon
- **SVG icons:** Chrome 95+ on Android supports SVG PWA icons via `"sizes": "any"`. For older Android support, PNG icons at 192×192 and 512×512 would be needed
- **Icon requirements for Android:** Icons must have solid (non-transparent) backgrounds and inline `fill` attributes — not CSS `currentColor`. Transparent backgrounds render as white on Android
- **Maskable icon:** `icons/icon-maskable.svg` confines the brand mark to the inner 80% safe zone (coordinates 102–410 on a 512×512 canvas) so Android's squircle crop doesn't cut the design
- **Offline behavior:** The app shell (HTML, CSS, JS) works offline. Google Calendar sync requires internet — this is expected and by design
- **Standalone mode:** When installed, the app runs without browser chrome (no address bar, no tabs)

---

## Known Challenges / Technical Notes

### OAuth

- **COOP warnings in the console:** `Cross-Origin-Opener-Policy` warnings from the GIS popup are harmless — they come from Google's own popup and do not affect functionality
- **Token scope cascade bug (fixed):** If the userinfo endpoint returns 401 and the code uses `gcalFetch` (which clears the token on 401), the Calendar token gets destroyed. Fix: always use raw `fetch` for non-Calendar API calls in `handleTokenResponse`
- **Scope must include userinfo:** The GIS token request must include `userinfo.profile` and `userinfo.email` or the People API will return 401

### Mobile UI

- **`type="date"` styling:** Native date inputs have no placeholder text and render as an opaque dark rectangle in dark mode. Solution: hide the input (`opacity: 0; position: absolute; inset: 0`) and overlay it on a visible `<label>` containing an icon and span text. JS updates the span text on `change`
- **Touch targets:** All interactive pills and buttons need `min-height: 36px` on mobile for comfortable tap targets

### Layout

- **Content centering in CSS Grid:** A grid item with `max-width` but no explicit centering defaults to left-align within the `1fr` track. Fix: `margin-inline: auto` on the `.main` element

### GitHub Pages

- **Subpath routing:** All asset paths in the service worker and manifest must account for the `/todoapp/` prefix
- **No server-side logic:** The app is entirely static; any feature requiring a backend (push notifications, server-side sync queue) is out of scope

---

## Current TODO / Roadmap

### Recently Completed

- Desktop layout centering on wide screens
- Mobile date input UX (custom label overlay)
- PWA icons (solid background, maskable variant)
- Mobile export/import visibility
- Mobile touch target polish

### Near-Term Ideas

- Better visual feedback on drag-and-drop
- Keyboard shortcuts for common actions
- Swipe-to-complete on mobile

### Future Ideas

- Task search / filter by text
- Notifications / reminders (requires Service Worker push)
- Recurring tasks
- Recurring Google Calendar sync (re-sync on edit)
- Offline-first sync queue (retry failed GCal syncs when back online)
- Multi-calendar support (choose which Google Calendar to sync to)
- Custom categories (user-defined, not hardcoded)
- Statistics / productivity dashboard
- Animations and microinteractions
- Dark/light theme toggle (currently auto-detected via `prefers-color-scheme`)

---

## Design Principles

- **Minimalistic:** Every element earns its place; no decorative complexity
- **Dark-mode-first:** Primary design target is dark mode; light mode is supported via `prefers-color-scheme`
- **Productivity-focused:** UI is optimized for quick task entry and scanning, not visual flair
- **Low complexity:** A bug fix does not need surrounding cleanup; a simple feature does not need an abstraction
- **Fast startup:** No framework bootstrap, no network requests on load (app shell from cache)
- **Framework-free:** Vanilla JS is intentional — no build tooling, no dependency updates, no version conflicts
- **Incremental and safe:** All changes should be additive and backward-compatible; never rewrite working code without a clear reason
- **Mobile-friendly:** Designed to work well on phone screens even though desktop is the primary context

---

## Important Constraints

These constraints must be respected in all future development:

1. **No framework** — no React, Vue, Svelte, etc.
2. **No backend** — no server, no database, no API keys on the server
3. **No build system** — no webpack, Vite, npm scripts that compile code
4. **No breaking changes to `localStorage`** — use additive migration only; never change `STORAGE_KEY`
5. **Preserve Google Calendar functionality** — OAuth flow, token handling, and `gcalFetch` must not be disrupted by unrelated changes
6. **Preserve GitHub Pages compatibility** — `start_url`, `scope`, and SW paths must reflect the `/todoapp/` subpath
7. **Avoid unnecessary rewrites** — modify only what is needed; do not refactor working code as a side effect of a bug fix

---

## Instructions For Future AI Sessions

When starting a new AI conversation about this project:

1. **Read this file first** to restore full project context without re-explaining everything
2. **Read `app.js`, `index.html`, `style.css`, and `googleCalendar.js`** before making changes — the codebase is the source of truth
3. **Make safe, incremental changes** — fix the specific issue, do not refactor surrounding code
4. **Do not break OAuth** — any change touching `googleCalendar.js` or token handling needs extra care
5. **Do not break PWA behavior** — changes to `manifest.json` or `service-worker.js` must preserve the subpath setup
6. **Keep `localStorage` backward-compatible** — new task fields go in `store.load()` migration with a safe default
7. **Test on mobile mentally** — consider touch targets, dark mode, and the date picker overlay pattern when editing the UI
8. **No new dependencies** — the zero-dependency constraint is intentional and permanent

The app is intentionally small and complete. Most future work will be polish, minor features, or bug fixes — not architectural changes.
