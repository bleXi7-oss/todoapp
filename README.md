# Doable

A clean, fast to-do app with priority levels, due dates, and optional Google Calendar sync — no account required.

**[Live demo →](https://bleXi7-oss.github.io/todoapp/)**

---

## Features

| Feature | Details |
|---|---|
| Add / edit / delete tasks | Inline editing with a polished modal |
| Priority levels | High · Medium · Low with colour coding |
| Due dates | Pick any date; overdue tasks are flagged automatically |
| Overdue detection | Banner appears when tasks are past their due date |
| Filter & sort | All / Active / Completed · sort by priority, due date, or creation date |
| Drag-to-reorder | Manual ordering via drag and drop |
| localStorage | All tasks persist in your browser — no server, no signup |
| Google Calendar sync | Sync individual tasks or all tasks to your primary calendar |
| Responsive design | Works on desktop, tablet, and mobile |
| Dark mode | Follows your system preference |

---

## Tech stack

- **HTML / CSS / JavaScript** — no frameworks, no build step
- **[Google Calendar API](https://developers.google.com/calendar)** — calendar event management
- **[Google Identity Services](https://developers.google.com/identity/oauth2/web/guides/overview)** — OAuth 2.0 token flow (frontend-only, no backend)
- **[GitHub Pages](https://pages.github.com/)** — static hosting

---

## Local setup

```bash
# 1. Clone the repo
git clone https://github.com/bleXi7-oss/todoapp.git
cd todoapp

# 2. Serve locally (any static server works)
npx serve .
# or
python -m http.server 3000
```

Open `http://localhost:3000` in your browser. The app works fully without Google Calendar — the next steps are only needed if you want calendar sync.

---

## Google Calendar sync setup

> **Optional.** The app works as a plain to-do list without any Google setup.

### 1 — Create a Google Cloud project

1. Go to [console.cloud.google.com](https://console.cloud.google.com) → **New Project**
2. Give it any name (e.g. "Doable")

### 2 — Enable the Google Calendar API

**APIs & Services → Library → search "Google Calendar API" → Enable**

### 3 — Create OAuth 2.0 credentials

1. **APIs & Services → Credentials → Create Credentials → OAuth client ID**
2. Application type: **Web application**
3. Add both origins to **Authorized JavaScript origins**:
   ```
   http://localhost:3000
   https://bleXi7-oss.github.io
   ```
4. Click **Create** and copy the **Client ID** (ends in `.apps.googleusercontent.com`)

### 4 — Add test users (if your OAuth app is in Testing mode)

Google restricts OAuth apps in Testing mode to explicitly added accounts.

**APIs & Services → OAuth consent screen → Test users → Add users**

Add the Google account(s) that will use the app.

### 5 — Connect inside the app

Click **Connect Calendar** in the sidebar, paste your Client ID, and click **Save & Connect**.

> **Privacy note:** Your Client ID is stored only in your browser's `localStorage`. It is never sent to any server.

---

## Usage

| Action | How |
|---|---|
| Add a task | Type in the top input and press **Add** or `Enter` |
| Set priority & due date | Use the dropdowns next to the input before adding |
| Edit a task | Click the pencil icon on any task |
| Mark complete | Click the checkbox on the left |
| Delete a task | Click the trash icon (appears on hover) |
| Sync to Calendar | Toggle the calendar icon on a task, or use **Sync all** in the sidebar |
| Disconnect Calendar | Click the × button in the sidebar's Google section |

---

## Privacy

- All task data is stored in **your browser's `localStorage`** only.
- Google Calendar integration uses **frontend OAuth only** — no backend server handles your tokens.
- Your Google OAuth Client ID is stored locally in your browser and is never transmitted to any third party.
- Revoking access in [Google Account permissions](https://myaccount.google.com/permissions) removes all calendar access immediately.

---

## Future improvements

- [ ] Multiple calendar support (not just primary)
- [ ] Recurring tasks
- [ ] Subtasks / checklists
- [ ] Tags and custom categories
- [ ] Export to CSV / JSON
- [ ] Keyboard shortcut reference panel
- [ ] PWA support (offline-first, installable)

---

## License

MIT
