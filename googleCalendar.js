/**
 * DOABLE — googleCalendar.js
 * ─────────────────────────────────────────────────
 * Google Calendar API integration via OAuth 2.0
 * (Google Identity Services — token model)
 *
 * Sections:
 *   1. Config & constants
 *   2. Token storage
 *   3. OAuth flow (initTokenClient, silentRefresh, sign in/out)
 *   4. Calendar API (gcalFetch + event endpoints)
 *   5. Sync operations (syncTodo, unsyncTodo, syncAllTodos)
 *   6. DOM cache (gcalDOM, cacheDOM)
 *   7. UI widget (gcalUI)
 *   8. Toast & log (gcalToast, gcalLog)
 *   9. Local utils
 *  10. Public API + init
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
const GCAL_SCOPE            = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/userinfo.profile',
  'https://www.googleapis.com/auth/userinfo.email',
].join(' ');
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
    try {
      localStorage.setItem(GCAL_STORAGE_KEY, JSON.stringify(tokenObj));
    } catch (e) {
      // Storage quota exceeded — token is valid this session but won't persist
      console.warn('[GCal] Could not persist token:', e);
    }
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
let _tokenClient    = null;
let _refreshPromise = null; // shared promise during silent refresh — prevents concurrent callback races

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
 * Silently request a new access token.
 * Returns the same Promise to all concurrent callers so only one refresh runs at a time.
 *
 * Safety notes:
 *  - Captures a local `client` ref so signOut() setting _tokenClient=null mid-refresh
 *    doesn't cause a TypeError when the callback tries to restore the original callback.
 *  - Checks _tokenClient===null inside the callback to detect a sign-out that raced the
 *    refresh; rejects instead of storing a stale token.
 *  - Wraps requestAccessToken() in try/catch so a synchronous throw also restores the
 *    original callback and rejects the promise cleanly.
 */
function silentRefresh() {
  if (_refreshPromise) return _refreshPromise;
  if (!_tokenClient)   return Promise.reject(new Error('NOT_AUTHENTICATED'));
  const client = _tokenClient; // local ref — unaffected by signOut clearing the global
  _refreshPromise = new Promise((resolve, reject) => {
    const origCallback = client.callback;
    client.callback = (resp) => {
      client.callback = origCallback;
      if (_tokenClient === null) { // signOut() ran while refresh was in flight
        reject(new Error('NOT_AUTHENTICATED'));
        return;
      }
      if (resp.error) { reject(new Error(resp.error)); return; }
      tokenStore.set(parseTokenResponse(resp));
      resolve();
    };
    try {
      client.requestAccessToken({ prompt: '' });
    } catch (err) {
      client.callback = origCallback; // restore before rejecting
      reject(err);
    }
  }).finally(() => { _refreshPromise = null; });
  return _refreshPromise;
}

/**
 * Called by GIS after the user grants (or denies) consent.
 */
async function handleTokenResponse(resp) {
  if (resp.error) {
    handleTokenError(resp);
    return;
  }
  tokenStore.set(parseTokenResponse(resp));

  gcalLog.add('info', 'OAuth token received. Fetching user profile…');

  // Use raw fetch — routing through gcalFetch would clear the token on any 401
  // (e.g. if the app previously ran with fewer scopes and the cached grant is stale).
  try {
    const res = await fetch(GCAL_PEOPLE_API, {
      headers: { 'Authorization': `Bearer ${tokenStore.getAccessToken()}` },
    });
    if (res.ok) {
      const profile = await res.json();
      userStore.set({
        name:    profile.name    || 'Google Account',
        email:   profile.email   || '',
        picture: profile.picture || '',
      });
    } else {
      gcalLog.add('error', `Profile fetch failed (${res.status}) — check OAuth scopes.`);
      userStore.set({ name: 'Google Account', email: '', picture: '' });
    }
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
  _tokenClient    = null;
  _refreshPromise = null; // abandon any in-flight silent refresh so it can't restore the token
  gcalUI.updateWidget();
  gcalLog.add('info', 'Disconnected from Google Calendar.');
  gcalToast.show('Disconnected from Google Calendar.', 'info');
}

/* ═══════════════════════════════════════════════
   4. CALENDAR API HELPERS
═══════════════════════════════════════════════ */

/**
 * Authenticated fetch wrapper for Google APIs.
 * Silently refreshes an expired token before the request.
 * Fires 'gcal:auth-expired' on 401 so the UI layer can react without being
 * called directly from here (keeps the API layer decoupled from the DOM).
 */
async function gcalFetch(url, options = {}) {
  if (!tokenStore.isValid() && url !== GCAL_PEOPLE_API) {
    if (!_tokenClient) throw new Error('NOT_AUTHENTICATED');
    await silentRefresh(); // shared promise — concurrent calls piggyback the same refresh
  }

  const token = tokenStore.getAccessToken();
  if (!token) throw new Error('NOT_AUTHENTICATED');

  const res = await fetch(url, {
    ...options,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type':  'application/json',
      ...(options.headers ?? {}),
    },
  });

  if (res.status === 401) {
    tokenStore.clear();
    window.dispatchEvent(new CustomEvent('gcal:auth-expired'));
    throw new Error('TOKEN_EXPIRED');
  }
  if (res.status === 404) throw new Error('NOT_FOUND');
  if (res.status === 429) throw new Error('RATE_LIMITED');
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    throw new Error(errBody?.error?.message || `HTTP ${res.status}`);
  }
  if (res.status === 204) return null;
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
 * Falls back to creating a new event if the stored calEventId no longer exists
 * (e.g. the user deleted it directly from Google Calendar).
 */
async function updateCalendarEvent(todo) {
  if (!todo.calEventId) return createCalendarEvent(todo);
  const url  = `${GCAL_API_BASE}/calendars/${encodeURIComponent(GCAL_CALENDAR_ID)}/events/${encodeURIComponent(todo.calEventId)}`;
  const body = buildEventBody(todo);
  try {
    await gcalFetch(url, { method: 'PATCH', body: JSON.stringify(body) });
    return todo.calEventId;
  } catch (err) {
    if (err.message === 'NOT_FOUND') return createCalendarEvent(todo);
    throw err;
  }
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
    const msg = userMessage(err);
    if (!silent) { gcalLog.add('error', `"${truncate(todo.text)}" — ${msg}`); gcalToast.show(msg, 'error'); }
    return { success: false, error: err.message };
  }
}

/**
 * Remove a todo from Google Calendar when deleted.
 * Returns { success, error } for consistency with syncTodo.
 */
async function unsyncTodo(eventId, taskText) {
  if (!eventId)            return { success: false, error: 'no_event_id' };
  if (!navigator.onLine)  {
    gcalLog.add('error', 'Offline — calendar event not removed.');
    return { success: false, error: 'offline' };
  }
  if (!tokenStore.isValid()) return { success: false, error: 'not_authenticated' };
  try {
    await deleteCalendarEvent(eventId);
    gcalLog.add('success', `Removed "${truncate(taskText)}" from Calendar.`);
    return { success: true };
  } catch (err) {
    gcalLog.add('error', `Could not remove event: ${err.message}`);
    return { success: false, error: err.message };
  }
}

// Prevents two sync-all runs from overlapping (button disable alone isn't enough —
// the button state updates asynchronously and the call can also come programmatically).
let _syncAllRunning = false;

/**
 * Sync every todo that has calSync = true.
 * Shows progress in the log panel.
 */
async function syncAllTodos(todos, onTodoUpdated) {
  if (_syncAllRunning) {
    gcalToast.show('Sync already in progress.', 'info');
    return;
  }
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

  _syncAllRunning = true;
  gcalLog.add('info', `Starting sync for ${targets.length} task${targets.length > 1 ? 's' : ''}…`);
  gcalUI.setSyncAllLoading(true);

  let successCount = 0;
  let failCount    = 0;
  let aborted      = false;

  try {
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
        // Auth failures affect every remaining task — abort rather than logging N identical errors
        if (result.error === 'not_authenticated' || result.error === 'TOKEN_EXPIRED') {
          gcalLog.add('error', 'Sync aborted: authentication lost.');
          aborted = true;
          break;
        }
      }
      // Small delay to avoid rate-limiting
      await sleep(120);
    }
  } finally {
    // Always reset loading state, even if an unexpected error escapes the loop
    _syncAllRunning = false;
    gcalUI.setSyncAllLoading(false);
  }

  const suffix = aborted ? ' (aborted)' : '';
  gcalLog.add('info', `Sync complete: ${successCount} succeeded, ${failCount} failed${suffix}.`);

  if (aborted) {
    gcalToast.show('Session expired during sync. Please reconnect.', 'error');
  } else {
    gcalToast.show(
      failCount === 0
        ? `Synced ${successCount} task${successCount > 1 ? 's' : ''} to Calendar.`
        : `${successCount} synced, ${failCount} failed.`,
      failCount === 0 ? 'success' : 'error'
    );
  }

  if (failCount > 0 || aborted) gcalUI.openLog();
}

/* ═══════════════════════════════════════════════
   6. DOM CACHE — populated once in init()
   Avoids getElementById on every call to hot paths
   like updateWidget (called on every auth state change).
═══════════════════════════════════════════════ */
const gcalDOM = {};

function cacheDOM() {
  gcalDOM.loggedOut      = document.getElementById('gcal-loggedout');
  gcalDOM.loggedIn       = document.getElementById('gcal-loggedin');
  gcalDOM.userName       = document.getElementById('gcal-user-name');
  gcalDOM.avatar         = document.getElementById('gcal-avatar');
  gcalDOM.addCalLabel    = document.getElementById('add-cal-label');
  gcalDOM.modalSyncRow   = document.getElementById('modal-sync-row');
  gcalDOM.syncAllBtn     = document.getElementById('gcal-sync-all-btn');
  gcalDOM.setupModal     = document.getElementById('setup-modal');
  gcalDOM.setupInput     = document.getElementById('setup-client-id');
  gcalDOM.setupOrigin    = document.getElementById('setup-origin-hint');
  gcalDOM.setupSave      = document.getElementById('setup-modal-save');
  gcalDOM.setupCancel    = document.getElementById('setup-modal-cancel');
  gcalDOM.setupClose     = document.getElementById('setup-modal-close');
  gcalDOM.connectBtn     = document.getElementById('gcal-connect-btn');
  gcalDOM.disconnectBtn  = document.getElementById('gcal-disconnect-btn');
  gcalDOM.logBtn         = document.getElementById('gcal-log-btn');
  gcalDOM.logPanel       = document.getElementById('sync-log-panel');
  gcalDOM.logClose       = document.getElementById('sync-log-close');
  gcalDOM.logClear       = document.getElementById('sync-log-clear');
  gcalDOM.logList        = document.getElementById('sync-log-list');
  gcalDOM.toastContainer = document.getElementById('toast-container');
  gcalDOM.newSyncToggle  = document.getElementById('new-sync-toggle');
  gcalDOM.connectedBadge = document.getElementById('gcal-connected-badge'); // may be null — created lazily
}

/* ═══════════════════════════════════════════════
   7. UI WIDGET
═══════════════════════════════════════════════ */
const gcalUI = {
  updateWidget() {
    if (!gcalDOM.loggedOut || !gcalDOM.loggedIn) return;

    const isAuth = tokenStore.isValid();
    gcalDOM.loggedOut.hidden = isAuth;
    gcalDOM.loggedIn.hidden  = !isAuth;

    if (isAuth) {
      const user = userStore.get();
      if (gcalDOM.userName && user) {
        gcalDOM.userName.textContent = user.name || user.email || 'Google Account';
      }
      if (gcalDOM.avatar && user) {
        if (user.picture) {
          const img = document.createElement('img');
          img.src = user.picture;
          img.alt = '';
          gcalDOM.avatar.replaceChildren(img);
        } else {
          gcalDOM.avatar.textContent = (user.name || 'G')[0].toUpperCase();
        }
      }

      // Create badge lazily if the HTML doesn't already include one
      if (!gcalDOM.connectedBadge && gcalDOM.loggedIn) {
        const badge = document.createElement('span');
        badge.id        = 'gcal-connected-badge';
        badge.className = 'gcal-connected-badge';
        badge.innerHTML = '<span aria-hidden="true" style="color:#16a34a;font-size:.6em;vertical-align:middle;">●</span> Connected to Google';
        gcalDOM.loggedIn.appendChild(badge);
        gcalDOM.connectedBadge = badge;
      }
      if (gcalDOM.connectedBadge) gcalDOM.connectedBadge.hidden = false;
    } else {
      if (gcalDOM.connectedBadge) gcalDOM.connectedBadge.hidden = true;
    }

    if (gcalDOM.addCalLabel)  gcalDOM.addCalLabel.style.display  = isAuth ? '' : 'none';
    if (gcalDOM.modalSyncRow) gcalDOM.modalSyncRow.style.display = isAuth ? '' : 'none';
  },

  setSyncAllLoading(isLoading) {
    if (!gcalDOM.syncAllBtn) return;
    gcalDOM.syncAllBtn.classList.toggle('is-syncing', isLoading);
    gcalDOM.syncAllBtn.disabled = isLoading;
  },

  openSetupModal() {
    if (!gcalDOM.setupModal) return;
    if (gcalDOM.setupInput)  gcalDOM.setupInput.value = clientIdStore.get();
    if (gcalDOM.setupOrigin) gcalDOM.setupOrigin.textContent = window.location.origin;
    gcalDOM.setupModal.hidden = false;
    document.body.style.overflow = 'hidden';
    setTimeout(() => gcalDOM.setupInput?.focus(), 50);
  },

  closeSetupModal() {
    if (gcalDOM.setupModal) gcalDOM.setupModal.hidden = true;
    document.body.style.overflow = '';
  },

  openLog()   { if (gcalDOM.logPanel) gcalDOM.logPanel.hidden = false; },
  closeLog()  { if (gcalDOM.logPanel) gcalDOM.logPanel.hidden = true; },
  toggleLog() { if (gcalDOM.logPanel) gcalDOM.logPanel.hidden = !gcalDOM.logPanel.hidden; },
};

/* ═══════════════════════════════════════════════
   8. TOAST & LOG
═══════════════════════════════════════════════ */
const gcalToast = {
  show(message, type = 'success') {
    const container = gcalDOM.toastContainer;
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
    const list = gcalDOM.logList;
    if (!list) return;

    const time = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const li   = document.createElement('li');
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
    if (gcalDOM.logList) gcalDOM.logList.innerHTML = '';
  },
};

/* ═══════════════════════════════════════════════
   9. LOCAL UTILS
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

// Converts a raw GIS token response into the shape tokenStore expects.
function parseTokenResponse(resp) {
  return {
    access_token: resp.access_token,
    expires_at:   Date.now() + (parseInt(resp.expires_in, 10) * 1000),
  };
}

// Maps internal error codes to user-facing strings (single source of truth).
function userMessage(err) {
  if (err.message === 'TOKEN_EXPIRED')     return 'Session expired. Please reconnect Google Calendar.';
  if (err.message === 'NOT_AUTHENTICATED') return 'Not connected to Google Calendar.';
  if (err.message === 'NOT_FOUND')         return 'Calendar event not found — it may have been deleted externally.';
  if (err.message === 'RATE_LIMITED')      return 'Google Calendar rate limit reached. Please wait a moment.';
  return `Sync failed: ${err.message}`;
}

/* ═══════════════════════════════════════════════
  10. PUBLIC API + INIT
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
    cacheDOM();

    // gcalFetch fires this when a token is revoked server-side (401).
    // Handled here (UI layer) so the fetch layer stays decoupled from the DOM.
    window.addEventListener('gcal:auth-expired', () => gcalUI.updateWidget());

    const clientId = clientIdStore.get();
    if (clientId) {
      // GIS might still be loading — poll, but give up after ~10 s
      let gisAttempts = 0;
      const tryInit = () => {
        if (window.google?.accounts?.oauth2) {
          initTokenClient(clientId);
          gcalUI.updateWidget();
        } else if (++gisAttempts < 33) {
          setTimeout(tryInit, 300);
        } else {
          gcalLog.add('error', 'Google Identity Services failed to load. Check your internet connection.');
        }
      };
      tryInit();
    } else {
      gcalUI.updateWidget();
    }

    // Setup modal
    gcalDOM.setupSave?.addEventListener('click', () => {
      const id = gcalDOM.setupInput?.value?.trim();
      if (!id) { gcalDOM.setupInput?.focus(); return; }
      if (!id.endsWith('.apps.googleusercontent.com')) {
        gcalToast.show('That doesn\'t look like a valid Client ID.', 'error');
        return;
      }
      googleCalendar.setClientId(id);
      gcalUI.closeSetupModal();
      gcalLog.add('info', 'Client ID saved. Initiating sign-in…');
      signIn();
    });
    gcalDOM.setupCancel?.addEventListener('click', () => gcalUI.closeSetupModal());
    gcalDOM.setupClose?.addEventListener('click',  () => gcalUI.closeSetupModal());
    gcalDOM.setupModal?.addEventListener('click', (e) => {
      if (e.target === gcalDOM.setupModal) gcalUI.closeSetupModal();
    });

    // Sidebar
    gcalDOM.connectBtn?.addEventListener('click',    signIn);
    gcalDOM.disconnectBtn?.addEventListener('click', signOut);
    gcalDOM.logBtn?.addEventListener('click',        () => gcalUI.toggleLog());

    // Log panel
    gcalDOM.logClose?.addEventListener('click', () => gcalUI.closeLog());
    gcalDOM.logClear?.addEventListener('click', () => gcalLog.clear());

    // Add-form cal toggle: show active state even without :has() support
    gcalDOM.newSyncToggle?.addEventListener('change', () => {
      gcalDOM.addCalLabel?.classList.toggle('is-checked', gcalDOM.newSyncToggle.checked);
      if (gcalDOM.newSyncToggle.checked && !tokenStore.isValid()) {
        gcalDOM.newSyncToggle.checked = false;
        gcalDOM.addCalLabel?.classList.remove('is-checked');
        signIn();
      }
    });
  },
};

// Make available globally (loaded before app.js)
window.googleCalendar = googleCalendar;
