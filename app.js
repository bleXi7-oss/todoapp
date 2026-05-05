/**
 * DOABLE — app.js
 * ─────────────────────────────────────────────────
 * Sections:
 *   1. State
 *   2. Utils
 *   3. Store      (pure data — no DOM, no render calls)
 *   4. DOM        (cached references, assigned once in initDOM)
 *   5. UI         (renders from state + store, no mutations)
 *   6. Drag & drop
 *   7. Modal      (form helpers only — no save logic)
 *   8. Controller (user actions → store → render)
 *   9. Events     (thin wiring, delegates to controller)
 *  10. Init
 * ─────────────────────────────────────────────────
 */

/* ═══════════════════════════════════════════════
   1. STATE
═══════════════════════════════════════════════ */
const state = {
  todos:          [],
  filter:         'all',    // 'all' | 'active' | 'completed'
  sort:           'manual', // 'manual' | 'priority' | 'dueDate' | 'created'
  editingId:      null,
  categoryFilter: 'all',    // 'all' | category name
  dragState:      { draggedId: null, overId: null },
};

const STORAGE_KEY = 'doable_todos_v3';
const CATEGORIES  = ['Inbox', 'Work', 'Personal', 'Family'];

/* ═══════════════════════════════════════════════
   2. UTILS
═══════════════════════════════════════════════ */
const utils = {
  escapeHTML(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  },

  uid() {
    return crypto.randomUUID();
  },

  todayISO() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  },

  isOverdue(dateISO) {
    if (!dateISO) return false;
    return dateISO < utils.todayISO();
  },

  formatDate(dateISO) {
    if (!dateISO) return '';
    const [y, m, d] = dateISO.split('-').map(Number);
    const date  = new Date(y, m - 1, d);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const diff = Math.round((date - today) / 86400000);
    if (diff === 0)  return 'Today';
    if (diff === 1)  return 'Tomorrow';
    if (diff === -1) return 'Yesterday';
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  },

  priorityOrder: { high: 0, medium: 1, low: 2 },
};

/* ═══════════════════════════════════════════════
   3. STORE — pure data, no render calls
   Methods return values so callers can react
   (GCal async, UI updates) without coupling here.
═══════════════════════════════════════════════ */
const store = {
  load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      state.todos = raw ? JSON.parse(raw) : [];
      // Migrate: ensure all fields exist (safe to run on already-migrated data)
      state.todos.forEach((t, i) => {
        if (t.calSync     === undefined) t.calSync     = false;
        if (t.calEventId  === undefined) t.calEventId  = null;
        if (t.calSyncedAt === undefined) t.calSyncedAt = null;
        if (!t.category)                 t.category    = 'Inbox';
        if (t.order       === undefined) t.order       = i * 1000;
      });
    } catch {
      state.todos = [];
    }
  },

  save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state.todos));
    } catch (e) {
      console.warn('localStorage write failed', e);
    }
  },

  find(id) {
    return state.todos.find(t => t.id === id) ?? null;
  },

  add(text, priority, dueDate, calSync = false, category = 'Inbox') {
    const minOrder = state.todos.length ? state.todos[0].order - 1000 : 0;
    const todo = {
      id:          utils.uid(),
      text:        text.trim(),
      completed:   false,
      priority:    priority || 'medium',
      dueDate:     dueDate || '',
      createdAt:   Date.now(),
      order:       minOrder,
      category:    CATEGORIES.includes(category) ? category : 'Inbox',
      calSync,
      calEventId:  null,
      calSyncedAt: null,
    };
    state.todos.unshift(todo);
    store.save();
    return todo; // caller handles GCal async if needed
  },

  toggle(id) {
    const todo = store.find(id);
    if (!todo) return null;
    todo.completed = !todo.completed;
    store.save();
    return todo; // caller handles silent GCal update
  },

  // Returns { todo, prev } so the caller can decide which GCal action to take.
  update(id, { text, priority, dueDate, calSync, category }) {
    const todo = store.find(id);
    if (!todo) return null;
    const prev = structuredClone(todo);
    if (text     !== undefined) todo.text     = text.trim();
    if (priority !== undefined) todo.priority = priority;
    if (dueDate  !== undefined) todo.dueDate  = dueDate;
    if (calSync  !== undefined) todo.calSync  = calSync;
    if (category !== undefined) todo.category = CATEGORIES.includes(category) ? category : 'Inbox';
    store.save();
    return { todo, prev };
  },

  // Returns the removed todo so the caller can clean up GCal.
  remove(id) {
    const idx = state.todos.findIndex(t => t.id === id);
    if (idx === -1) return null;
    const [todo] = state.todos.splice(idx, 1);
    store.save();
    return todo;
  },

  // Returns removed todos so the caller can clean up GCal.
  clearCompleted() {
    const removed = state.todos.filter(t => t.completed);
    state.todos   = state.todos.filter(t => !t.completed);
    store.save();
    return removed;
  },

  reorder(draggedId, overId) {
    if (draggedId === overId) return;
    const from = state.todos.findIndex(t => t.id === draggedId);
    const to   = state.todos.findIndex(t => t.id === overId);
    if (from === -1 || to === -1) return;
    const [item] = state.todos.splice(from, 1);
    state.todos.splice(to, 0, item);
    // Keep order field in sync with array position so it persists correctly
    state.todos.forEach((t, i) => { t.order = (i + 1) * 1000; });
    store.save();
  },

  // Called by the sync-all callback to persist updated event IDs.
  updateCalFields(todo) {
    const existing = store.find(todo.id);
    if (existing) {
      existing.calEventId  = todo.calEventId;
      existing.calSyncedAt = todo.calSyncedAt;
    }
    store.save();
  },

  getVisible() {
    let list = state.todos.filter(t => {
      const passStatus =
        state.filter === 'active'    ? !t.completed :
        state.filter === 'completed' ?  t.completed : true;
      const passCat =
        state.categoryFilter === 'all' || t.category === state.categoryFilter;
      return passStatus && passCat;
    });
    if (state.sort === 'priority') {
      list = [...list].sort((a, b) =>
        utils.priorityOrder[a.priority] - utils.priorityOrder[b.priority]
      );
    } else if (state.sort === 'dueDate') {
      list = [...list].sort((a, b) => {
        if (!a.dueDate && !b.dueDate) return 0;
        if (!a.dueDate) return 1;
        if (!b.dueDate) return -1;
        return a.dueDate.localeCompare(b.dueDate);
      });
    } else if (state.sort === 'created') {
      list = [...list].sort((a, b) => b.createdAt - a.createdAt);
    }
    return list;
  },
};

// IDs of tasks currently being synced — drives sync-button state without stale DOM refs.
const syncingIds = new Set();

/* ═══════════════════════════════════════════════
   4. DOM — cached once in initDOM(), never re-queried
═══════════════════════════════════════════════ */
let DOM = {};

function initDOM() {
  DOM = {
    // List & status
    taskList:      document.getElementById('task-list'),
    emptyState:    document.getElementById('empty-state'),
    overdueBanner: document.getElementById('overdue-banner'),
    overdueText:   document.getElementById('overdue-text'),
    pageSubtitle:  document.getElementById('page-subtitle'),

    // Add form
    newTaskInput:  document.getElementById('new-task-input'),
    newPriority:   document.getElementById('new-priority'),
    newCategory:   document.getElementById('new-category'),
    newDate:       document.getElementById('new-date'),
    newDateWrap:   document.getElementById('new-date-wrap'),
    newDateText:   document.getElementById('new-date-text'),
    newSyncToggle: document.getElementById('new-sync-toggle'),
    addTaskBtn:    document.getElementById('add-task-btn'),
    addCalLabel:   document.getElementById('add-cal-label'),

    // Sidebar
    navItems:          document.querySelectorAll('.nav-item'),
    sortSelect:        document.getElementById('sort-select'),
    clearCompletedBtn: document.getElementById('clear-completed-btn'),
    gcalSyncAllBtn:    document.getElementById('gcal-sync-all-btn'),
    categoryNav:       document.getElementById('category-nav'),

    // Export / Import
    exportBtn:       document.getElementById('export-btn'),
    importBtn:       document.getElementById('import-btn'),
    importFileInput: document.getElementById('import-file-input'),

    // Edit modal
    modal:           document.getElementById('edit-modal'),
    modalText:       document.getElementById('modal-text'),
    modalPriority:   document.getElementById('modal-priority'),
    modalCategory:   document.getElementById('modal-category'),
    modalDate:       document.getElementById('modal-date'),
    modalSyncToggle: document.getElementById('modal-sync-toggle'),
    modalSaveBtn:    document.getElementById('modal-save-btn'),
    modalCancelBtn:  document.getElementById('modal-cancel-btn'),
    modalCloseBtn:   document.getElementById('modal-close-btn'),

    // Nav container — used for event delegation instead of per-item listeners
    sidebarNav: document.querySelector('.sidebar-nav'),

    // Setup modal — owned by googleCalendar.js, referenced for Escape handling
    setupModal: document.getElementById('setup-modal'),
  };
}

/* ═══════════════════════════════════════════════
   5. UI — reads state + store, never mutates them
═══════════════════════════════════════════════ */

// Single entry point for all re-renders — batches synchronous bursts into one paint.
let _renderPending = false;
function render() {
  if (_renderPending) return;
  _renderPending = true;
  requestAnimationFrame(() => {
    _renderPending = false;
    ui.render();
  });
}

const ui = {
  render() {
    const visible   = store.getVisible();
    const all       = state.todos;
    const active    = all.filter(t => !t.completed);
    const completed = all.filter(t =>  t.completed);
    const overdue   = active.filter(t => utils.isOverdue(t.dueDate));

    // Nav badges — each badge lives inside its button (data-filter is the shared key)
    const counts = { all: all.length, active: active.length, completed: completed.length };
    DOM.navItems.forEach(btn => {
      const badge = btn.querySelector('.nav-badge');
      if (badge) badge.textContent = counts[btn.dataset.filter] ?? 0;
    });

    // Subtitle
    DOM.pageSubtitle.textContent = active.length === 0
      ? 'Nothing pending — great job! 🎉'
      : active.length === 1
        ? '1 task remaining.'
        : `${active.length} tasks remaining.`;

    // Overdue banner
    DOM.overdueBanner.hidden = overdue.length === 0;
    if (overdue.length > 0) {
      DOM.overdueText.textContent = overdue.length === 1
        ? '1 task is overdue'
        : `${overdue.length} tasks are overdue`;
    }

    // Empty state — messages come from data-* attributes set in HTML
    DOM.emptyState.hidden = visible.length > 0;
    if (visible.length === 0) {
      if (state.categoryFilter !== 'all') {
        const cat = state.categoryFilter;
        DOM.emptyState.querySelector('.empty-title').textContent = `No tasks in ${cat}`;
        DOM.emptyState.querySelector('.empty-sub').textContent   =
          state.filter === 'active'    ? `Active ${cat} tasks will appear here.` :
          state.filter === 'completed' ? `Completed ${cat} tasks will appear here.` :
          `Add a task and assign it to ${cat}.`;
      } else {
        const key = state.filter[0].toUpperCase() + state.filter.slice(1);
        DOM.emptyState.querySelector('.empty-title').textContent = DOM.emptyState.dataset['msg' + key];
        DOM.emptyState.querySelector('.empty-sub').textContent   = DOM.emptyState.dataset['sub' + key];
      }
    }

    // Task list — one DOM write via DocumentFragment
    const frag = document.createDocumentFragment();
    visible.forEach(todo => frag.appendChild(ui.buildTaskEl(todo)));
    DOM.taskList.innerHTML = '';
    DOM.taskList.appendChild(frag);
  },

  buildTaskEl(todo) {
    const isOverdue = !todo.completed && utils.isOverdue(todo.dueDate);

    const li = document.createElement('li');
    li.className = [
      'task-item',
      `priority--${todo.priority}`,
      todo.completed ? 'is-completed' : '',
      isOverdue      ? 'is-overdue'   : '',
    ].filter(Boolean).join(' ');
    li.dataset.id = todo.id;
    li.setAttribute('draggable', 'true');
    li.setAttribute('role', 'listitem');

    li.innerHTML = `
      <span class="drag-handle" aria-hidden="true">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <circle cx="4.5" cy="3.5"  r="1" fill="currentColor"/>
          <circle cx="4.5" cy="7"    r="1" fill="currentColor"/>
          <circle cx="4.5" cy="10.5" r="1" fill="currentColor"/>
          <circle cx="9.5" cy="3.5"  r="1" fill="currentColor"/>
          <circle cx="9.5" cy="7"    r="1" fill="currentColor"/>
          <circle cx="9.5" cy="10.5" r="1" fill="currentColor"/>
        </svg>
      </span>

      <input type="checkbox" class="task-checkbox" aria-label="Mark complete"
        ${todo.completed ? 'checked' : ''} />

      <div class="task-content">
        <span class="task-text">${utils.escapeHTML(todo.text)}</span>
        <div class="task-meta">
          ${ui.buildPriorityBadge(todo.priority)}
          ${ui.buildDateMeta(todo.dueDate, isOverdue)}
          ${ui.buildCalBadge(todo)}
          ${ui.buildCategoryBadge(todo)}
        </div>
      </div>

      <div class="task-actions" role="group" aria-label="Task actions">
        ${ui.buildSyncBtn(todo)}
        <button class="task-action-btn edit-btn" aria-label="Edit task" title="Edit">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M9.5 2.5l2 2-7 7H2.5v-2l7-7z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>
          </svg>
        </button>
        <button class="task-action-btn delete-btn" aria-label="Delete task" title="Delete">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M2 4h10M5 4V2.5a.5.5 0 01.5-.5h3a.5.5 0 01.5.5V4M10 4l-.7 7.5a.5.5 0 01-.5.5H5.2a.5.5 0 01-.5-.5L4 4"
              stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
      </div>
    `;

    // Drag-and-drop stays per-element (drag events don't delegate cleanly to a container)
    dnd.bindToEl(li);
    return li;
  },

  buildPriorityBadge(priority) {
    const labels = { high: 'High', medium: 'Med', low: 'Low' };
    return `<span class="meta-badge badge--${priority}">${labels[priority]}</span>`;
  },

  buildDateMeta(dueDate, isOverdue) {
    if (!dueDate) return '';
    const label = utils.formatDate(dueDate);
    if (isOverdue) {
      return `
        <span class="meta-badge badge--overdue">
          <svg width="9" height="9" viewBox="0 0 9 9" fill="none">
            <circle cx="4.5" cy="4.5" r="4" stroke="currentColor" stroke-width="1.1"/>
            <path d="M4.5 2.5v2.2M4.5 6.2v.3" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/>
          </svg>
          Overdue · ${label}
        </span>`;
    }
    return `
      <span class="meta-date">
        <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
          <rect x="1" y="2" width="9" height="8" rx="1.5" stroke="currentColor" stroke-width="1.1"/>
          <path d="M3.5 1v2M7.5 1v2M1 5h9" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/>
        </svg>
        ${label}
      </span>`;
  },

  buildCalBadge(todo) {
    if (!window.googleCalendar?.isAuthenticated() || !todo.calSync) return '';
    if (todo.calEventId) {
      return `<span class="meta-badge badge--gcal" title="Synced to Google Calendar">
        <svg width="9" height="9" viewBox="0 0 24 24" fill="none">
          <rect x="3" y="4" width="18" height="18" rx="3" stroke="currentColor" stroke-width="2.2"/>
          <path d="M3 9h18" stroke="currentColor" stroke-width="2.2"/>
          <path d="M8 2v4M16 2v4" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>
        </svg>
        Cal
      </span>`;
    }
    return `<span class="meta-badge badge--gcal is-syncing" title="Pending sync">
      <svg width="9" height="9" viewBox="0 0 24 24" fill="none">
        <path d="M4 4v5h5M20 20v-5h-5" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>
        <path d="M20 9a8 8 0 00-14.9-2.3M4 15a8 8 0 0014.9 2.3" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>
      </svg>
      Syncing…
    </span>`;
  },

  buildCategoryBadge(todo) {
    // Inbox is the default — only badge non-default categories to avoid visual noise
    if (!todo.category || todo.category === 'Inbox') return '';
    return `<span class="meta-badge badge--category">${utils.escapeHTML(todo.category)}</span>`;
  },

  buildSyncBtn(todo) {
    if (!window.googleCalendar?.isAuthenticated()) return '';
    const isSynced  = todo.calSync && !!todo.calEventId;
    const isSyncing = syncingIds.has(todo.id);
    const label     = isSynced ? 'Synced to Calendar (click to re-sync)' : 'Sync to Google Calendar';
    return `
      <button class="task-action-btn sync-btn ${isSynced ? 'is-synced' : ''} ${isSyncing ? 'is-syncing' : ''}"
        ${isSyncing ? 'disabled' : ''}
        aria-label="${label}" title="${label}">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
          <rect x="3" y="4" width="18" height="18" rx="3" stroke="currentColor" stroke-width="1.8"/>
          <path d="M3 9h18" stroke="currentColor" stroke-width="1.8"/>
          <path d="M8 2v4M16 2v4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
        </svg>
      </button>`;
  },

  // Animate an item out, then invoke onDone for the actual removal + re-render.
  animateRemove(el, onDone) {
    el.style.transition = 'opacity 180ms ease, transform 180ms ease, max-height 220ms ease 60ms, margin 220ms ease 60ms, padding 220ms ease 60ms';
    el.style.overflow   = 'hidden';
    el.style.maxHeight  = el.offsetHeight + 'px';
    requestAnimationFrame(() => {
      el.style.opacity       = '0';
      el.style.transform     = 'translateX(8px)';
      el.style.maxHeight     = '0';
      el.style.marginBottom  = '0';
      el.style.paddingTop    = '0';
      el.style.paddingBottom = '0';
    });
    setTimeout(onDone, 280);
  },
};

/* ═══════════════════════════════════════════════
   6. DRAG & DROP
═══════════════════════════════════════════════ */
const dnd = {
  bindToEl(el) {
    el.addEventListener('dragstart', dnd.onDragStart);
    el.addEventListener('dragend',   dnd.onDragEnd);
    el.addEventListener('dragover',  dnd.onDragOver);
    el.addEventListener('dragenter', dnd.onDragEnter);
    el.addEventListener('dragleave', dnd.onDragLeave);
    el.addEventListener('drop',      dnd.onDrop);
  },

  onDragStart(e) {
    state.dragState.draggedId = e.currentTarget.dataset.id;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', state.dragState.draggedId);
    requestAnimationFrame(() => e.currentTarget.classList.add('dragging'));
  },

  onDragEnd(e) {
    e.currentTarget.classList.remove('dragging');
    document.querySelectorAll('.task-item.drag-over').forEach(el => el.classList.remove('drag-over'));
    state.dragState.draggedId = null;
    state.dragState.overId    = null;
  },

  onDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  },

  onDragEnter(e) {
    e.preventDefault();
    const target = e.currentTarget;
    if (target.dataset.id === state.dragState.draggedId) return;
    document.querySelectorAll('.task-item.drag-over').forEach(el => el.classList.remove('drag-over'));
    target.classList.add('drag-over');
    state.dragState.overId = target.dataset.id;
  },

  onDragLeave(e) {
    if (!e.currentTarget.contains(e.relatedTarget)) {
      e.currentTarget.classList.remove('drag-over');
    }
  },

  onDrop(e) {
    e.preventDefault();
    e.currentTarget.classList.remove('drag-over');
    const { draggedId, overId } = state.dragState;
    if (!draggedId || !overId || draggedId === overId) return;
    if (state.sort !== 'manual') {
      window.googleCalendar?.toast.show('Switch to Manual order to drag-reorder tasks.', 'info');
      return;
    }
    controller.reorder(draggedId, overId);
  },
};

/* ═══════════════════════════════════════════════
   7. MODAL — form helpers only
   Saving is handled by controller.saveEdit()
═══════════════════════════════════════════════ */
const modal = {
  open(id) {
    const todo = store.find(id);
    if (!todo) return;
    state.editingId = id;

    DOM.modalText.value         = todo.text;
    DOM.modalPriority.value     = todo.priority;
    DOM.modalDate.value         = todo.dueDate || '';
    DOM.modalSyncToggle.checked = !!todo.calSync;
    if (DOM.modalCategory) DOM.modalCategory.value = todo.category || 'Inbox';

    DOM.modal.hidden = false;
    document.body.style.overflow = 'hidden';
    requestAnimationFrame(() => DOM.modalText.focus());
  },

  close() {
    DOM.modal.hidden = true;
    document.body.style.overflow = '';
    state.editingId = null;
  },

  // Returns raw form values — controller decides what to do with them.
  readForm() {
    return {
      text:     DOM.modalText.value.trim(),
      priority: DOM.modalPriority.value,
      dueDate:  DOM.modalDate.value,
      calSync:  DOM.modalSyncToggle.checked,
      category: DOM.modalCategory?.value || 'Inbox',
    };
  },
};

/* ═══════════════════════════════════════════════
   8. CONTROLLER — user actions → store → render

   applyCalSync — shared sync-then-persist pattern used by addTask, saveEdit, quickSync.
   Mutates todo.calEventId/calSyncedAt and calls store.save() on success.
   Returns true if the sync succeeded.
═══════════════════════════════════════════════ */
async function applyCalSync(todo) {
  const gcal = window.googleCalendar;
  if (!gcal?.isAuthenticated()) return false;
  const result = await gcal.syncTodo(todo);
  if (result.success) {
    todo.calEventId  = result.eventId;
    todo.calSyncedAt = Date.now();
    store.save();
    return true;
  }
  return false;
}

/* ═══════════════════════════════════════════════
   8. CONTROLLER (continued)
   The only layer allowed to call render().
   GCal async operations are handled here so that
   store stays synchronous and UI-free.
═══════════════════════════════════════════════ */
const controller = {
  async addTask() {
    const text = DOM.newTaskInput.value.trim();
    if (!text) { DOM.newTaskInput.focus(); return; }

    const calSync  = DOM.newSyncToggle?.checked ?? false;
    const category = DOM.newCategory?.value || 'Inbox';
    const todo = store.add(text, DOM.newPriority.value, DOM.newDate.value, calSync, category);

    // Reset add form
    DOM.newTaskInput.value = '';
    DOM.newDate.value      = '';
    DOM.newPriority.value  = 'medium';
    if (DOM.newSyncToggle) {
      DOM.newSyncToggle.checked = false;
      DOM.addCalLabel?.classList.remove('is-checked');
    }
    // Keep category at current filter selection for fast sequential adds
    if (DOM.newCategory && state.categoryFilter === 'all') DOM.newCategory.value = 'Inbox';
    // Reset date label
    if (DOM.newDateText) DOM.newDateText.textContent = 'Due date';
    DOM.newDateWrap?.classList.remove('has-date');
    DOM.newTaskInput.focus();
    render();

    // Re-render once GCal assigns an event ID (shows the Cal badge)
    if (calSync) {
      const synced = await applyCalSync(todo);
      if (synced) render();
    }
  },

  toggleTask(id) {
    const todo = store.toggle(id);
    render();
    // Silent calendar update — no re-render needed
    if (todo?.calSync && todo.calEventId && window.googleCalendar?.isAuthenticated()) {
      window.googleCalendar.syncTodo(todo, { silent: true });
    }
  },

  editTask(id) {
    modal.open(id);
  },

  deleteTask(id, el) {
    ui.animateRemove(el, () => {
      const todo = store.remove(id);
      if (todo?.calEventId && window.googleCalendar?.isAuthenticated()) {
        window.googleCalendar.unsyncTodo(todo.calEventId, todo.text);
      }
      render();
    });
  },

  async saveEdit() {
    const id = state.editingId;
    if (!id) return;

    const form = modal.readForm();
    if (!form.text) { DOM.modalText.focus(); return; }

    const result = store.update(id, form);
    modal.close();
    render();

    if (!result) return;
    const { todo, prev } = result;
    const gcal = window.googleCalendar;
    if (!gcal?.isAuthenticated()) return;

    if (form.calSync) {
      const synced = await applyCalSync(todo);
      if (synced) render();
    } else if (prev.calSync && todo.calEventId) {
      // Sync was turned off — remove the calendar event
      await gcal.unsyncTodo(todo.calEventId, prev.text);
      todo.calEventId  = null;
      todo.calSyncedAt = null;
      store.save();
      render();
    }
  },

  async quickSync(id) {
    if (!window.googleCalendar?.isAuthenticated()) {
      window.googleCalendar?.openSetupModal();
      return;
    }
    if (syncingIds.has(id)) return; // prevent double-tap
    const todo = store.find(id);
    if (!todo) return;
    todo.calSync = true;
    syncingIds.add(id);
    render(); // shows is-syncing state immediately
    await applyCalSync(todo);
    syncingIds.delete(id);
    render(); // shows final Cal badge
  },

  clearCompleted() {
    const removed = store.clearCompleted();
    const gcal = window.googleCalendar;
    if (gcal?.isAuthenticated()) {
      removed.filter(t => t.calEventId).forEach(t => gcal.unsyncTodo(t.calEventId, t.text));
    }
    render();
  },

  setFilter(filter) {
    state.filter = filter;
    DOM.navItems.forEach(btn => btn.classList.toggle('active', btn.dataset.filter === filter));
    render();
  },

  setSort(value) {
    state.sort = value;
    render();
  },

  reorder(draggedId, overId) {
    store.reorder(draggedId, overId);
    state.sort = 'manual';
    DOM.sortSelect.value = 'manual';
    render();
  },

  syncAll() {
    // Pass a combined callback: persist fields AND re-render per-todo
    const onUpdated = (todo) => { store.updateCalFields(todo); render(); };
    window.googleCalendar?.syncAllTodos(state.todos, onUpdated);
  },

  // ── Phase 2: Category filter ──────────────────
  setCategoryFilter(cat) {
    state.categoryFilter = cat;
    DOM.categoryNav?.querySelectorAll('.cat-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.cat === cat);
    });
    // Auto-set add form category to match filter for fast sequential adds
    if (DOM.newCategory && cat !== 'all') DOM.newCategory.value = cat;
    render();
  },

  // ── Phase 1: Export ───────────────────────────
  exportData() {
    const payload = {
      app:        'Doable',
      version:    1,
      exportedAt: new Date().toISOString(),
      todos:      state.todos,
    };
    const json = JSON.stringify(payload, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `doable-backup-${utils.todayISO()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    window.googleCalendar?.toast.show('Backup exported.', 'success');
  },

  // ── Phase 1: Import ───────────────────────────
  importData() {
    DOM.importFileInput?.click();
  },

  handleImportFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target.result);
        if (data.app !== 'Doable' || !Array.isArray(data.todos)) throw new Error('bad format');
        const count   = data.todos.length;
        const current = state.todos.length;
        if (!confirm(
          `Import ${count} task${count !== 1 ? 's' : ''}?\n` +
          `This will replace your current ${current} task${current !== 1 ? 's' : ''}.`
        )) return;

        // Ensure all fields exist on imported items
        data.todos.forEach((t, i) => {
          if (!t.id)                       t.id          = utils.uid();
          if (!t.category)                 t.category    = 'Inbox';
          if (t.order       === undefined) t.order       = i * 1000;
          if (t.calSync     === undefined) t.calSync     = false;
          if (t.calEventId  === undefined) t.calEventId  = null;
          if (t.calSyncedAt === undefined) t.calSyncedAt = null;
        });

        state.todos = data.todos;
        store.save();
        render();
        window.googleCalendar?.toast.show(
          `Imported ${count} task${count !== 1 ? 's' : ''}.`, 'success'
        );
      } catch {
        window.googleCalendar?.toast.show('Invalid backup file — import failed.', 'error');
      }
    };
    reader.readAsText(file);
    DOM.importFileInput.value = ''; // allow re-importing the same file
  },
};

/* ═══════════════════════════════════════════════
   9. EVENTS — thin wiring, delegates to controller
═══════════════════════════════════════════════ */
function bindEvents() {
  // Add task
  DOM.addTaskBtn.addEventListener('click', () => controller.addTask());
  DOM.newTaskInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') controller.addTask();
  });

  // Task list — event delegation replaces per-element click/change listeners.
  // DnD listeners remain per-element (see dnd.bindToEl in ui.buildTaskEl).
  DOM.taskList.addEventListener('change', (e) => {
    if (!e.target.matches('.task-checkbox')) return;
    controller.toggleTask(e.target.closest('[data-id]').dataset.id);
  });

  DOM.taskList.addEventListener('click', (e) => {
    const item = e.target.closest('[data-id]');
    if (!item) return;
    const id = item.dataset.id;
    if (e.target.closest('.edit-btn'))   return controller.editTask(id);
    if (e.target.closest('.delete-btn')) return controller.deleteTask(id, item);
    if (e.target.closest('.sync-btn'))   return controller.quickSync(id);
  });

  // Sidebar nav — delegated to avoid per-item listeners
  DOM.sidebarNav.addEventListener('click', (e) => {
    const btn = e.target.closest('.nav-item[data-filter]');
    if (btn) controller.setFilter(btn.dataset.filter);
  });
  DOM.sortSelect.addEventListener('change', (e) => controller.setSort(e.target.value));
  DOM.clearCompletedBtn.addEventListener('click', () => {
    if (state.todos.some(t => t.completed)) controller.clearCompleted();
  });
  DOM.gcalSyncAllBtn?.addEventListener('click', () => controller.syncAll());

  // Edit modal
  DOM.modalSaveBtn.addEventListener('click',   () => controller.saveEdit());
  DOM.modalCancelBtn.addEventListener('click', () => modal.close());
  DOM.modalCloseBtn.addEventListener('click',  () => modal.close());
  DOM.modal.addEventListener('click', (e) => {
    if (e.target === DOM.modal) modal.close();
  });

  // Due-date pill label — update visible text when user picks a date
  DOM.newDate?.addEventListener('change', () => {
    if (DOM.newDateText) {
      DOM.newDateText.textContent = DOM.newDate.value
        ? utils.formatDate(DOM.newDate.value)
        : 'Due date';
    }
    DOM.newDateWrap?.classList.toggle('has-date', !!DOM.newDate.value);
  });

  // Category filter
  DOM.categoryNav?.addEventListener('click', (e) => {
    const btn = e.target.closest('.cat-btn[data-cat]');
    if (btn) controller.setCategoryFilter(btn.dataset.cat);
  });

  // Export / Import
  DOM.exportBtn?.addEventListener('click', () => controller.exportData());
  DOM.importBtn?.addEventListener('click', () => controller.importData());
  DOM.importFileInput?.addEventListener('change', (e) => {
    if (e.target.files[0]) controller.handleImportFile(e.target.files[0]);
  });

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (!DOM.modal.hidden)                       { modal.close(); return; }
      if (DOM.setupModal && !DOM.setupModal.hidden) { window.googleCalendar?.closeSetupModal(); return; }
    }
    if (e.key === 'Enter' && !DOM.modal.hidden) {
      if (document.activeElement !== DOM.modalCancelBtn) controller.saveEdit();
    }
  });
}

/* ═══════════════════════════════════════════════
   10. INIT
═══════════════════════════════════════════════ */
function init() {
  initDOM();
  store.load();
  bindEvents();
  window.googleCalendar?.init();
  render();

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./service-worker.js').catch(() => {});
    });
  }
}

document.addEventListener('DOMContentLoaded', init);
