/**
 * DOABLE — googleCalendar.js
 * ─────────────────────────────────────────────────
 * Google Calendar API integration via OAuth 2.0
 * (Google Identity Services — token model)
 *
 * Sections:
 *   1. Config & constants
 *   2. Token storage
 *   3. OAuth flow
 *   4. Calendar API helpers
 *   5. Sync operations (create / update / delete)
 *   6. Sync-all
 *   7. UI state management
 *   8. Toast & log
 *   9. Public API
 * ─────────────────────────────────────────────────
 *
 * SETUP:
 *   1. Create a Google Cloud project
 *   2. Enable "Google Calendar API"
 *   3. Create OAuth 2.0 credentials (Web application)
 *      - Add your app's origin to Authorized JavaScript origins
 *   4. Click "Connect Calendar" in the sidebar and paste your Client ID
 *
 * DATA MODEL additions to each todo:
 *   todo.calSync      {boolean}  — user wants this synced
 *   todo.calEventId   {string}   — Google Calendar event id
 *   todo.calSyncedAt  {number}   — timestamp of last successful sync
 * ─────────────────────────────────────────────────
 */

/* ═══════════════════════════════════════════════
   1. CONFIG & CONSTANTS
═══════════════════════════════════════════════ */
const GCAL_STORAGE_KEY      = 'doable_gcal_token';
const GCAL_USER_KEY         = 'doable_gcal_user';
const GCAL_CLIENT_ID_KEY    = 'doable_gcal_client_id';
const GCAL_CALENDAR_ID      = 'primary';
const GCAL_SCOPE            = 'https://www.googleapis.com/auth/calendar.events';
const GCAL_API_BASE         = 'https://www.googleapis.com/calendar/v3';
const GCAL_PEOPLE_API       = 'https://www.googleapis.com/oauth2/v3/userinfo';
const TOKEN_EXPIRY_BUFFER   = 5 * 60 * 1000; // refresh 5 min before expiry

/* ═══════════════════════════════════════════════
   2. TOKEN STORAGE
═══════════════════════════════════════════════ */
const tokenStore = {
  get() {
    try {
      const raw = localStorage.getItem(GCAL_STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  },
  set(tokenObj) {
    // tokenObj: { access_token, expires_at }
    localStorage.setItem(GCAL_STORAGE_KEY, JSON.stringify(tokenObj));
  },
  clear() {
    localStorage.removeItem(GCAL_STORAGE_KEY);
    localStorage.removeItem(GCAL_USER_KEY);
  },
  isValid() {
    const t = tokenStore.get();
    if (!t || !t.access_token) return false;
    return Date.now() < (t.expires_at - TOKEN_EXPIRY_BUFFER);
  },
  getAccessToken() {
    return tokenStore.get()?.access_token ?? null;
  },
};

const userStore = {
  get() {
    try {
      const raw = localStorage.getItem(GCAL_USER_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  },
  set(u) { localStorage.setItem(GCAL_USER_KEY, JSON.stringify(u)); },
  clear() { localStorage.removeItem(GCAL_USER_KEY); },
};

const clientIdStore = {
  get()    { return localStorage.getItem(GCAL_CLIENT_ID_KEY) || ''; },
  set(id)  { localStorage.setItem(GCAL_CLIENT_ID_KEY, id.trim()); },
  clear()  { localStorage.removeItem(GCAL_CLIENT_ID_KEY); },
};

/* ═══════════════════════════════════════════════
   3. OAUTH FLOW
═══════════════════════════════════════════════ */
let _tokenClient = null;

/**
 * Initialise (or reinitialise) the GIS token client.
 * Called after we have a Client ID.
 */
function initTokenClient(clientId) {
  if (!window.google?.accounts?.oauth2) {
    gcalLog.add('error', 'Google Identity Services not loaded. Check your internet connection.');
    return false;
  }
  _tokenClient = window.google.accounts.oauth2.initTokenClient({
    client_id: clientId,
    scope:     GCAL_SCOPE,
    callback:  handleTokenResponse,
    error_callback: handleTokenError,
  });
  return true;
}

/**
 * Called by GIS after the user grants (or denies) consent.
 */
async function handleTokenResponse(resp) {
  if (resp.error) {
    handleTokenError(resp);
    return;
  }
  const expiresAt = Date.now() + (parseInt(resp.expires_in, 10) * 1000);
  tokenStore.set({ access_token: resp.access_token, expires_at: expiresAt });

  gcalLog.add('info', 'OAuth token received. Fetching user profile…');

  // Fetch user profile
  try {
    const profile = await gcalFetch(GCAL_PEOPLE_API);
    userStore.set({
      name:    profile.name || 'Google Account',
      email:   profile.email || '',
      picture: profile.picture || '',
    });
  } catch {
    userStore.set({ name: 'Google Account', email: '', picture: '' });
  }

  gcalUI.updateWidget();
  gcalLog.add('success', `Signed in as ${userStore.get()?.email || 'Google Account'}.`);
  gcalToast.show('Connected to Google Calendar!', 'success');
}

function handleTokenError(err) {
  console.warn('[GCal] Token error:', err);
  const msg = err.type === 'popup_closed'
    ? 'Sign-in popup was closed.'
    : `OAuth error: ${err.type || err.error || 'unknown'}`;
  gcalLog.add('error', msg);
  gcalToast.show(msg, 'error');
}

/**
 * Trigger sign-in popup. If token is still valid, skip the popup.
 */
function signIn() {
  const clientId = clientIdStore.get();
  if (!clientId) {
    // Show setup modal instead
    gcalUI.openSetupModal();
    return;
  }
  if (!_tokenClient) {
    if (!initTokenClient(clientId)) return;
  }
  if (tokenStore.isValid()) {
    gcalLog.add('info', 'Already authenticated.');
    gcalUI.updateWidget();
    return;
  }
  _tokenClient.requestAccessToken({ prompt: 'consent' });
}

/**
 * Sign out: revoke token and clear local data.
 */
async function signOut() {
  const token = tokenStore.getAccessToken();
  if (token && window.google?.accounts?.oauth2) {
    try {
      window.google.accounts.oauth2.revoke(token, () => {});
    } catch { /* non-fatal */ }
  }
  tokenStore.clear();
  userStore.clear();
  _tokenClient = null;
  gcalUI.updateWidget();
  gcalLog.add('info', 'Disconnected from Google Calendar.');
  gcalToast.show('Disconnected from Google Calendar.', 'info');
}

/* ═══════════════════════════════════════════════
   4. CALENDAR API HELPERS
═══════════════════════════════════════════════ */

/**
 * Authenticated fetch wrapper for Google APIs.
 */
async function gcalFetch(url, options = {}) {
  // Auto-refresh check — if token expired, request a new one silently
  if (!tokenStore.isValid() && url !== GCAL_PEOPLE_API) {
    const clientId = clientIdStore.get();
    if (clientId && _tokenClient) {
      await new Promise((resolve, reject) => {
        const orig = _tokenClient.callback;
        _tokenClient.callback = (resp) => {
          _tokenClient.callback = orig;
          if (resp.error) { reject(new Error(resp.error)); return; }
          const expiresAt = Date.now() + (parseInt(resp.expires_in, 10) * 1000);
          tokenStore.set({ access_token: resp.access_token, expires_at: expiresAt });
          resolve();
        };
        _tokenClient.requestAccessToken({ prompt: '' });
      });
    } else {
      throw new Error('NOT_AUTHENTICATED');
    }
  }

  const token = tokenStore.getAccessToken();
  if (!token) throw new Error('NOT_AUTHENTICATED');

  const headers = {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };

  const res = await fetch(url, { ...options, headers });

  if (res.status === 401) {
    // Token was revoked externally
    tokenStore.clear();
    gcalUI.updateWidget();
    throw new Error('TOKEN_EXPIRED');
  }
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    throw new Error(errBody?.error?.message || `HTTP ${res.status}`);
  }
  if (res.status === 204) return null; // DELETE responses
  return res.json();
}

/**
 * Build a Google Calendar event body from a todo.
 */
function buildEventBody(todo) {
  const priorityLabel = { high: '🔴 High', medium: '🟠 Medium', low: '🟢 Low' };
  const body = {
    summary:     todo.text,
    description: `Priority: ${priorityLabel[todo.priority] || todo.priority}\n\nSynced from Doable`,
    status:      todo.completed ? 'cancelled' : 'confirmed',
  };

  if (todo.dueDate) {
    // All-day event
    body.start = { date: todo.dueDate };
    body.end   = { date: todo.dueDate };
  } else {
    // No date — use today as a placeholder (no time)
    const today = new Date().toISOString().split('T')[0];
    body.start = { date: today };
    body.end   = { date: today };
  }

  return body;
}

/* ═══════════════════════════════════════════════
   5. SYNC OPERATIONS
═══════════════════════════════════════════════ */

/**
 * Create a new Calendar event for a todo.
 * Returns the event id on success.
 */
async function createCalendarEvent(todo) {
  const url  = `${GCAL_API_BASE}/calendars/${encodeURIComponent(GCAL_CALENDAR_ID)}/events`;
  const body = buildEventBody(todo);
  const event = await gcalFetch(url, {
    method: 'POST',
    body:   JSON.stringify(body),
  });
  return event.id;
}

/**
 * Update an existing Calendar event.
 */
async function updateCalendarEvent(todo) {
  if (!todo.calEventId) return createCalendarEvent(todo);
  const url  = `${GCAL_API_BASE}/calendars/${encodeURIComponent(GCAL_CALENDAR_ID)}/events/${encodeURIComponent(todo.calEventId)}`;
  const body = buildEventBody(todo);
  await gcalFetch(url, {
    method: 'PATCH',
    body:   JSON.stringify(body),
  });
  return todo.calEventId;
}

/**
 * Delete a Calendar event.
 */
async function deleteCalendarEvent(eventId) {
  const url = `${GCAL_API_BASE}/calendars/${encodeURIComponent(GCAL_CALENDAR_ID)}/events/${encodeURIComponent(eventId)}`;
  await gcalFetch(url, { method: 'DELETE' });
}

/**
 * Sync a single todo (create or update).
 * Mutates todo.calEventId and todo.calSyncedAt.
 * Returns { success, eventId, error }.
 */
async function syncTodo(todo, { silent = false } = {}) {
  if (!navigator.onLine) {
    const msg = `No internet — could not sync "${truncate(todo.text)}"`;
    if (!silent) { gcalLog.add('error', msg); gcalToast.show(msg, 'error'); }
    return { success: false, error: 'offline' };
  }
  if (!tokenStore.isValid()) {
    const msg = 'Not connected to Google Calendar.';
    if (!silent) { gcalLog.add('error', msg); gcalToast.show(msg, 'error'); }
    return { success: false, error: 'not_authenticated' };
  }

  try {
    let eventId;
    if (todo.calEventId) {
      eventId = await updateCalendarEvent(todo);
      if (!silent) gcalLog.add('success', `Updated "${truncate(todo.text)}" on Calendar.`);
    } else {
      eventId = await createCalendarEvent(todo);
      if (!silent) gcalLog.add('success', `Added "${truncate(todo.text)}" to Calendar.`);
    }
    return { success: true, eventId };
  } catch (err) {
    const msg = err.message === 'TOKEN_EXPIRED'
      ? 'Session expired. Please reconnect Google Calendar.'
      : err.message === 'NOT_AUTHENTICATED'
        ? 'Not connected to Google Calendar.'
        : `Sync failed: ${err.message}`;
    if (!silent) { gcalLog.add('error', `"${truncate(todo.text)}" — ${msg}`); gcalToast.show(msg, 'error'); }
    return { success: false, error: err.message };
  }
}

/**
 * Remove a todo from Google Calendar when deleted.
 */
async function unsyncTodo(eventId, taskText) {
  if (!eventId) return;
  if (!navigator.onLine) { gcalLog.add('error', 'Offline — calendar event not removed.'); return; }
  if (!tokenStore.isValid()) return;
  try {
    await deleteCalendarEvent(eventId);
    gcalLog.add('success', `Removed "${truncate(taskText)}" from Calendar.`);
  } catch (err) {
    gcalLog.add('error', `Could not remove event: ${err.message}`);
  }
}

/* ═══════════════════════════════════════════════
   6. SYNC-ALL
═══════════════════════════════════════════════ */

/**
 * Sync every todo that has calSync = true.
 * Shows progress in the log panel.
 */
async function syncAllTodos(todos, onTodoUpdated) {
  if (!navigator.onLine) {
    gcalToast.show('No internet connection.', 'error');
    gcalLog.add('error', 'Sync-all failed: no internet.');
    return;
  }
  if (!tokenStore.isValid()) {
    gcalToast.show('Please connect Google Calendar first.', 'info');
    return;
  }

  const targets = todos.filter(t => t.calSync && !t.completed);
  if (targets.length === 0) {
    gcalToast.show('No tasks marked for calendar sync.', 'info');
    gcalLog.add('info', 'Sync-all: no tasks with sync enabled.');
    return;
  }

  gcalLog.add('info', `Starting sync for ${targets.length} task${targets.length > 1 ? 's' : ''}…`);
  gcalUI.setSyncAllLoading(true);

  let successCount = 0;
  let failCount    = 0;

  for (const todo of targets) {
    const result = await syncTodo(todo, { silent: true });
    if (result.success) {
      todo.calEventId  = result.eventId;
      todo.calSyncedAt = Date.now();
      onTodoUpdated(todo);
      gcalLog.add('success', `✓ "${truncate(todo.text)}"`);
      successCount++;
    } else {
      gcalLog.add('error', `✗ "${truncate(todo.text)}" — ${result.error}`);
      failCount++;
    }
    // Small delay to avoid rate-limiting
    await sleep(120);
  }

  gcalUI.setSyncAllLoading(false);
  gcalLog.add('info', `Sync complete: ${successCount} succeeded, ${failCount} failed.`);
  gcalToast.show(
    failCount === 0
      ? `Synced ${successCount} task${successCount > 1 ? 's' : ''} to Calendar.`
      : `${successCount} synced, ${failCount} failed.`,
    failCount === 0 ? 'success' : 'error'
  );

  // Show log if there were failures
  if (failCount > 0) gcalUI.openLog();
}

/* ═══════════════════════════════════════════════
   7. UI STATE MANAGEMENT
═══════════════════════════════════════════════ */
const gcalUI = {
  updateWidget() {
    const loggedOut = document.getElementById('gcal-loggedout');
    const loggedIn  = document.getElementById('gcal-loggedin');
    if (!loggedOut || !loggedIn) return;

    const isAuth = tokenStore.isValid();
    loggedOut.hidden = isAuth;
    loggedIn.hidden  = !isAuth;

    if (isAuth) {
      const user = userStore.get();
      const nameEl   = document.getElementById('gcal-user-name');
      const avatarEl = document.getElementById('gcal-avatar');
      if (nameEl && user) {
        nameEl.textContent = user.name || user.email || 'Google Account';
      }
      if (avatarEl && user) {
        if (user.picture) {
          avatarEl.innerHTML = `<img src="${user.picture}" alt="${user.name}" />`;
        } else {
          avatarEl.textContent = (user.name || 'G')[0].toUpperCase();
        }
      }
    }

    // Show/hide the cal toggle in add form based on auth state
    const addCalLabel = document.getElementById('add-cal-label');
    if (addCalLabel) {
      addCalLabel.style.display = isAuth ? '' : 'none';
    }
    // Show/hide modal sync row
    const modalSyncRow = document.getElementById('modal-sync-row');
    if (modalSyncRow) {
      modalSyncRow.style.display = isAuth ? '' : 'none';
    }
  },

  setSyncAllLoading(isLoading) {
    const btn = document.getElementById('gcal-sync-all-btn');
    if (!btn) return;
    btn.classList.toggle('is-syncing', isLoading);
    btn.disabled = isLoading;
  },

  openSetupModal() {
    const modal = document.getElementById('setup-modal');
    if (!modal) return;
    // Pre-fill existing client id
    const input = document.getElementById('setup-client-id');
    if (input) input.value = clientIdStore.get();
    // Show current origin
    const originHint = document.getElementById('setup-origin-hint');
    if (originHint) originHint.textContent = window.location.origin;
    modal.hidden = false;
    document.body.style.overflow = 'hidden';
    setTimeout(() => input?.focus(), 50);
  },

  closeSetupModal() {
    const modal = document.getElementById('setup-modal');
    if (modal) modal.hidden = true;
    document.body.style.overflow = '';
  },

  openLog() {
    const panel = document.getElementById('sync-log-panel');
    if (panel) panel.hidden = false;
  },

  closeLog() {
    const panel = document.getElementById('sync-log-panel');
    if (panel) panel.hidden = true;
  },

  toggleLog() {
    const panel = document.getElementById('sync-log-panel');
    if (panel) panel.hidden = !panel.hidden;
  },
};

/* ═══════════════════════════════════════════════
   8. TOAST & LOG
═══════════════════════════════════════════════ */
const gcalToast = {
  show(message, type = 'success') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const icons = {
      success: `<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="7" stroke="currentColor" stroke-width="1.5"/><path d="M5 8l2 2 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
      error:   `<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="7" stroke="currentColor" stroke-width="1.5"/><path d="M8 5v3.5M8 10.5v.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`,
      info:    `<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="7" stroke="currentColor" stroke-width="1.5"/><path d="M8 7v4M8 5v.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`,
    };

    const toast = document.createElement('div');
    toast.className = `toast toast--${type}`;
    toast.innerHTML = `${icons[type] || ''}<span>${escapeForToast(message)}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
      toast.classList.add('is-leaving');
      setTimeout(() => toast.remove(), 260);
    }, 3500);
  },
};

const gcalLog = {
  add(type, message) {
    const list = document.getElementById('sync-log-list');
    if (!list) return;

    const now  = new Date();
    const time = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

    const li = document.createElement('li');
    li.className = 'sync-log-item';
    li.innerHTML = `
      <span class="sync-log-dot sync-log-dot--${type}" aria-hidden="true"></span>
      <span class="sync-log-msg">${escapeForToast(message)}</span>
      <span class="sync-log-time">${time}</span>
    `;
    list.insertBefore(li, list.firstChild);

    // Limit log to 50 items
    while (list.children.length > 50) list.removeChild(list.lastChild);
  },
  clear() {
    const list = document.getElementById('sync-log-list');
    if (list) list.innerHTML = '';
  },
};

/* ═══════════════════════════════════════════════
   UTILS (local)
═══════════════════════════════════════════════ */
function truncate(str, max = 36) {
  return str.length > max ? str.slice(0, max) + '…' : str;
}
function escapeForToast(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/* ═══════════════════════════════════════════════
   9. PUBLIC API
   (consumed by app.js)
═══════════════════════════════════════════════ */
const googleCalendar = {
  /* Auth */
  signIn,
  signOut,
  isAuthenticated: () => tokenStore.isValid(),

  /* Client ID management */
  getClientId:    clientIdStore.get.bind(clientIdStore),
  setClientId(id) {
    clientIdStore.set(id);
    initTokenClient(id);
  },

  /* Sync operations */
  syncTodo,
  unsyncTodo,
  syncAllTodos,

  /* UI */
  updateWidget:    gcalUI.updateWidget.bind(gcalUI),
  openSetupModal:  gcalUI.openSetupModal.bind(gcalUI),
  closeSetupModal: gcalUI.closeSetupModal.bind(gcalUI),
  openLog:         gcalUI.openLog.bind(gcalUI),
  closeLog:        gcalUI.closeLog.bind(gcalUI),
  toggleLog:       gcalUI.toggleLog.bind(gcalUI),
  setSyncAllLoading: gcalUI.setSyncAllLoading.bind(gcalUI),

  /* Notifications */
  toast: gcalToast,
  log:   gcalLog,

  /* Bootstrap: call once after DOM ready */
  init() {
    const clientId = clientIdStore.get();
    if (clientId) {
      // GIS might still be loading — wait for it
      const tryInit = () => {
        if (window.google?.accounts?.oauth2) {
          initTokenClient(clientId);
          gcalUI.updateWidget();
        } else {
          setTimeout(tryInit, 300);
        }
      };
      tryInit();
    } else {
      gcalUI.updateWidget();
    }

    // Bind setup modal events
    document.getElementById('setup-modal-save')?.addEventListener('click', () => {
      const input = document.getElementById('setup-client-id');
      const id    = input?.value?.trim();
      if (!id) { input?.focus(); return; }
      if (!id.endsWith('.apps.googleusercontent.com')) {
        gcalToast.show('That doesn\'t look like a valid Client ID.', 'error');
        return;
      }
      googleCalendar.setClientId(id);
      gcalUI.closeSetupModal();
      gcalLog.add('info', 'Client ID saved. Initiating sign-in…');
      signIn();
    });
    document.getElementById('setup-modal-cancel')?.addEventListener('click', gcalUI.closeSetupModal);
    document.getElementById('setup-modal-close')?.addEventListener('click',  gcalUI.closeSetupModal);
    document.getElementById('setup-modal')?.addEventListener('click', (e) => {
      if (e.target === document.getElementById('setup-modal')) gcalUI.closeSetupModal();
    });

    // Sidebar buttons
    document.getElementById('gcal-connect-btn')?.addEventListener('click', signIn);
    document.getElementById('gcal-disconnect-btn')?.addEventListener('click', signOut);
    document.getElementById('gcal-log-btn')?.addEventListener('click', gcalUI.toggleLog.bind(gcalUI));

    // Sync log panel
    document.getElementById('sync-log-close')?.addEventListener('click', gcalUI.closeLog.bind(gcalUI));
    document.getElementById('sync-log-clear')?.addEventListener('click', gcalLog.clear.bind(gcalLog));

    // Add-form cal toggle: show active state even without :has() support
    const addCalCheckbox = document.getElementById('new-sync-toggle');
    const addCalLabel    = document.getElementById('add-cal-label');
    addCalCheckbox?.addEventListener('change', () => {
      addCalLabel?.classList.toggle('is-checked', addCalCheckbox.checked);
      if (addCalCheckbox.checked && !tokenStore.isValid()) {
        addCalCheckbox.checked = false;
        addCalLabel?.classList.remove('is-checked');
        signIn();
      }
    });
  },
};

// Make available globally (loaded before app.js)
window.googleCalendar = googleCalendar;