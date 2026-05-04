/**
 * DOABLE — app.js
 * ─────────────────────────────────────────────────
 * Sections:
 *   1. State
 *   2. DOM references
 *   3. Utils
 *   4. CRUD logic
 *   5. UI rendering
 *   6. Drag & drop
 *   7. Modal
 *   8. Event binding
 *   9. Init
 * ─────────────────────────────────────────────────
 */

/* ═══════════════════════════════════════════════
   1. STATE
═══════════════════════════════════════════════ */
const state = {
  todos:     [],
  filter:    'all',    // 'all' | 'active' | 'completed'
  sort:      'manual', // 'manual' | 'priority' | 'dueDate' | 'created'
  editingId: null,
  dragState: { draggedId: null, overId: null },
};

const STORAGE_KEY = 'doable_todos_v3'; // bumped from v2 to handle new fields

/* ═══════════════════════════════════════════════
   2. DOM REFERENCES
═══════════════════════════════════════════════ */
const DOM = {
  // List & empty
  taskList:      () => document.getElementById('task-list'),
  emptyState:    () => document.getElementById('empty-state'),
  emptyTitle:    () => document.getElementById('empty-title'),
  emptySub:      () => document.getElementById('empty-sub'),
  overdueBanner: () => document.getElementById('overdue-banner'),
  overdueText:   () => document.getElementById('overdue-text'),
  pageSubtitle:  () => document.getElementById('page-subtitle'),

  // Add form
  newTaskInput:  () => document.getElementById('new-task-input'),
  newPriority:   () => document.getElementById('new-priority'),
  newDate:       () => document.getElementById('new-date'),
  newSyncToggle: () => document.getElementById('new-sync-toggle'),
  addTaskBtn:    () => document.getElementById('add-task-btn'),

  // Sidebar controls
  navItems:          () => document.querySelectorAll('.nav-item'),
  sortSelect:        () => document.getElementById('sort-select'),
  clearCompletedBtn: () => document.getElementById('clear-completed-btn'),
  gcalSyncAllBtn:    () => document.getElementById('gcal-sync-all-btn'),

  // Badges
  badgeAll:       () => document.getElementById('badge-all'),
  badgeActive:    () => document.getElementById('badge-active'),
  badgeCompleted: () => document.getElementById('badge-completed'),

  // Edit modal
  modal:           () => document.getElementById('edit-modal'),
  modalText:       () => document.getElementById('modal-text'),
  modalPriority:   () => document.getElementById('modal-priority'),
  modalDate:       () => document.getElementById('modal-date'),
  modalSyncToggle: () => document.getElementById('modal-sync-toggle'),
  modalSaveBtn:    () => document.getElementById('modal-save-btn'),
  modalCancelBtn:  () => document.getElementById('modal-cancel-btn'),
  modalCloseBtn:   () => document.getElementById('modal-close-btn'),
};

/* ═══════════════════════════════════════════════
   3. UTILS
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
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
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
   4. CRUD LOGIC
═══════════════════════════════════════════════ */
const crud = {
  load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      state.todos = raw ? JSON.parse(raw) : [];

      // Migrate from v2: ensure new fields exist
      state.todos.forEach(t => {
        if (t.calSync      === undefined) t.calSync      = false;
        if (t.calEventId   === undefined) t.calEventId   = null;
        if (t.calSyncedAt  === undefined) t.calSyncedAt  = null;
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

  add(text, priority, dueDate, calSync = false) {
    const todo = {
      id:          utils.uid(),
      text:        text.trim(),
      completed:   false,
      priority:    priority || 'medium',
      dueDate:     dueDate || '',
      createdAt:   Date.now(),
      // Calendar fields
      calSync:     calSync,
      calEventId:  null,
      calSyncedAt: null,
    };
    state.todos.unshift(todo);
    crud.save();

    // Sync to Google Calendar if requested
    if (calSync && window.googleCalendar?.isAuthenticated()) {
      window.googleCalendar.syncTodo(todo).then(result => {
        if (result.success) {
          todo.calEventId  = result.eventId;
          todo.calSyncedAt = Date.now();
          crud.save();
          ui.render(); // re-render to show sync badge
        }
      });
    }

    return todo;
  },

  toggle(id) {
    const todo = state.todos.find(t => t.id === id);
    if (!todo) return;
    todo.completed = !todo.completed;
    crud.save();

    // Update calendar event status if synced
    if (todo.calSync && todo.calEventId && window.googleCalendar?.isAuthenticated()) {
      window.googleCalendar.syncTodo(todo, { silent: true });
    }
  },

  update(id, { text, priority, dueDate, calSync }) {
    const todo = state.todos.find(t => t.id === id);
    if (!todo) return;

    const wasText     = todo.text;
    const wasSync     = todo.calSync;
    const wasDueDate  = todo.dueDate;
    const wasPriority = todo.priority;

    if (text     !== undefined) todo.text     = text.trim();
    if (priority !== undefined) todo.priority = priority;
    if (dueDate  !== undefined) todo.dueDate  = dueDate;
    if (calSync  !== undefined) todo.calSync  = calSync;
    crud.save();

    // Handle calendar sync
    const gcal = window.googleCalendar;
    if (!gcal) return;

    const isAuth = gcal.isAuthenticated();

    if (calSync && isAuth) {
      // User wants sync: create or update event
      gcal.syncTodo(todo).then(result => {
        if (result.success) {
          todo.calEventId  = result.eventId;
          todo.calSyncedAt = Date.now();
          crud.save();
          ui.render();
        }
      });
    } else if (!calSync && wasSync && todo.calEventId && isAuth) {
      // User turned off sync: remove event
      gcal.unsyncTodo(todo.calEventId, wasText).then(() => {
        todo.calEventId  = null;
        todo.calSyncedAt = null;
        crud.save();
        ui.render();
      });
    } else if (calSync && todo.calEventId && isAuth) {
      // Content changed, event exists: patch it
      const changed = text !== wasText || dueDate !== wasDueDate || priority !== wasPriority;
      if (changed) {
        gcal.syncTodo(todo).then(result => {
          if (result.success) {
            todo.calSyncedAt = Date.now();
            crud.save();
            ui.render();
          }
        });
      }
    }
  },

  remove(id) {
    const todo = state.todos.find(t => t.id === id);
    // Delete from Google Calendar if synced
    if (todo?.calEventId && window.googleCalendar?.isAuthenticated()) {
      window.googleCalendar.unsyncTodo(todo.calEventId, todo.text);
    }
    state.todos = state.todos.filter(t => t.id !== id);
    crud.save();
  },

  clearCompleted() {
    const gcal = window.googleCalendar;
    if (gcal?.isAuthenticated()) {
      state.todos.filter(t => t.completed && t.calEventId).forEach(t => {
        gcal.unsyncTodo(t.calEventId, t.text);
      });
    }
    state.todos = state.todos.filter(t => !t.completed);
    crud.save();
  },

  reorder(draggedId, overId) {
    if (draggedId === overId) return;
    const from = state.todos.findIndex(t => t.id === draggedId);
    const to   = state.todos.findIndex(t => t.id === overId);
    if (from === -1 || to === -1) return;
    const [item] = state.todos.splice(from, 1);
    state.todos.splice(to, 0, item);
    crud.save();
  },

  // Called by gcal sync-all to persist updated event ids
  updateCalFields(todo) {
    const existing = state.todos.find(t => t.id === todo.id);
    if (existing) {
      existing.calEventId  = todo.calEventId;
      existing.calSyncedAt = todo.calSyncedAt;
    }
    crud.save();
    ui.render();
  },

  getVisible() {
    let list = state.todos.filter(t => {
      if (state.filter === 'active')    return !t.completed;
      if (state.filter === 'completed') return  t.completed;
      return true;
    });

    if (state.sort === 'priority') {
      list = [...list].sort((a,b) =>
        utils.priorityOrder[a.priority] - utils.priorityOrder[b.priority]
      );
    } else if (state.sort === 'dueDate') {
      list = [...list].sort((a,b) => {
        if (!a.dueDate && !b.dueDate) return 0;
        if (!a.dueDate) return 1;
        if (!b.dueDate) return -1;
        return a.dueDate.localeCompare(b.dueDate);
      });
    } else if (state.sort === 'created') {
      list = [...list].sort((a,b) => b.createdAt - a.createdAt);
    }
    return list;
  },
};

/* ═══════════════════════════════════════════════
   5. UI RENDERING
═══════════════════════════════════════════════ */
const ui = {
  render() {
    const visible   = crud.getVisible();
    const all       = state.todos;
    const active    = all.filter(t => !t.completed);
    const completed = all.filter(t => t.completed);
    const overdue   = active.filter(t => utils.isOverdue(t.dueDate));

    // Badges
    DOM.badgeAll().textContent       = all.length;
    DOM.badgeActive().textContent    = active.length;
    DOM.badgeCompleted().textContent = completed.length;

    // Subtitle
    DOM.pageSubtitle().textContent = active.length === 0
      ? 'Nothing pending — great job! 🎉'
      : active.length === 1
        ? '1 task remaining.'
        : `${active.length} tasks remaining.`;

    // Overdue banner
    const ob = DOM.overdueBanner();
    ob.hidden = overdue.length === 0;
    if (overdue.length > 0) {
      DOM.overdueText().textContent = overdue.length === 1
        ? '1 task is overdue'
        : `${overdue.length} tasks are overdue`;
    }

    // Empty state
    const es = DOM.emptyState();
    es.hidden = visible.length > 0;
    if (visible.length === 0) {
      const msgs = {
        completed: ['No completed tasks yet',      'Finish something to see it here.'],
        active:    ['All done!',                   'Everything is taken care of.'],
        all:       ['All clear here',              'Add your first task above to get started.'],
      };
      const [title, sub] = msgs[state.filter] || msgs.all;
      DOM.emptyTitle().textContent = title;
      DOM.emptySub().textContent   = sub;
    }

    // Build task list via DocumentFragment (one DOM write)
    const frag = document.createDocumentFragment();
    visible.forEach(todo => frag.appendChild(ui.buildTaskEl(todo)));
    DOM.taskList().innerHTML = '';
    DOM.taskList().appendChild(frag);
  },

  buildTaskEl(todo) {
    const isOverdue = !todo.completed && utils.isOverdue(todo.dueDate);
    const isSynced  = todo.calSync && !!todo.calEventId;

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
          <circle cx="4.5" cy="3.5" r="1" fill="currentColor"/>
          <circle cx="4.5" cy="7"   r="1" fill="currentColor"/>
          <circle cx="4.5" cy="10.5" r="1" fill="currentColor"/>
          <circle cx="9.5" cy="3.5" r="1" fill="currentColor"/>
          <circle cx="9.5" cy="7"   r="1" fill="currentColor"/>
          <circle cx="9.5" cy="10.5" r="1" fill="currentColor"/>
        </svg>
      </span>

      <input
        type="checkbox"
        class="task-checkbox"
        aria-label="Mark complete"
        ${todo.completed ? 'checked' : ''}
      />

      <div class="task-content">
        <span class="task-text">${utils.escapeHTML(todo.text)}</span>
        <div class="task-meta">
          ${ui.buildPriorityBadge(todo.priority)}
          ${ui.buildDateMeta(todo.dueDate, isOverdue)}
          ${ui.buildCalBadge(todo)}
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

    // Event listeners
    li.querySelector('.task-checkbox').addEventListener('change', () => {
      crud.toggle(todo.id);
      ui.render();
    });
    li.querySelector('.edit-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      modal.open(todo.id);
    });
    li.querySelector('.delete-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      ui.removeWithAnimation(li, todo.id);
    });

    // Sync button (quick-sync per task)
    const syncBtn = li.querySelector('.sync-btn');
    if (syncBtn) {
      syncBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        ui.handleQuickSync(todo, syncBtn);
      });
    }

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
    const gcal = window.googleCalendar;
    if (!gcal?.isAuthenticated() || !todo.calSync) return '';
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
    if (todo.calSync) {
      return `<span class="meta-badge badge--gcal is-syncing" title="Pending sync">
        <svg width="9" height="9" viewBox="0 0 24 24" fill="none">
          <path d="M4 4v5h5M20 20v-5h-5" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>
          <path d="M20 9a8 8 0 00-14.9-2.3M4 15a8 8 0 0014.9 2.3" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>
        </svg>
        Syncing…
      </span>`;
    }
    return '';
  },

  buildSyncBtn(todo) {
    const gcal = window.googleCalendar;
    if (!gcal?.isAuthenticated()) return '';

    const isSynced = todo.calSync && !!todo.calEventId;
    const title    = isSynced ? 'Synced to Calendar (click to re-sync)' : 'Sync to Google Calendar';
    return `
      <button class="task-action-btn sync-btn ${isSynced ? 'is-synced' : ''}" aria-label="${title}" title="${title}">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
          <rect x="3" y="4" width="18" height="18" rx="3" stroke="currentColor" stroke-width="1.8"/>
          <path d="M3 9h18" stroke="currentColor" stroke-width="1.8"/>
          <path d="M8 2v4M16 2v4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
        </svg>
      </button>`;
  },

  async handleQuickSync(todo, btn) {
    if (!window.googleCalendar?.isAuthenticated()) {
      window.googleCalendar?.openSetupModal();
      return;
    }
    btn.classList.add('is-syncing');
    btn.disabled = true;

    // Toggle calSync on
    todo.calSync = true;
    const result = await window.googleCalendar.syncTodo(todo);
    if (result.success) {
      todo.calEventId  = result.eventId;
      todo.calSyncedAt = Date.now();
      const t = state.todos.find(t => t.id === todo.id);
      if (t) { t.calSync = true; t.calEventId = result.eventId; t.calSyncedAt = todo.calSyncedAt; }
      crud.save();
    }

    btn.classList.remove('is-syncing');
    btn.disabled = false;
    ui.render();
  },

  removeWithAnimation(el, id) {
    el.style.transition = 'opacity 180ms ease, transform 180ms ease, max-height 220ms ease 60ms, margin 220ms ease 60ms, padding 220ms ease 60ms';
    el.style.overflow   = 'hidden';
    el.style.maxHeight  = el.offsetHeight + 'px';
    requestAnimationFrame(() => {
      el.style.opacity      = '0';
      el.style.transform    = 'translateX(8px)';
      el.style.maxHeight    = '0';
      el.style.marginBottom = '0';
      el.style.paddingTop   = '0';
      el.style.paddingBottom = '0';
    });
    setTimeout(() => {
      crud.remove(id);
      ui.render();
    }, 280);
  },

  setFilter(filter) {
    state.filter = filter;
    DOM.navItems().forEach(btn => {
      btn.classList.toggle('active', btn.dataset.filter === filter);
    });
    ui.render();
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
    crud.reorder(draggedId, overId);
    state.sort = 'manual';
    DOM.sortSelect().value = 'manual';
    ui.render();
  },
};

/* ═══════════════════════════════════════════════
   7. MODAL
═══════════════════════════════════════════════ */
const modal = {
  open(id) {
    const todo = state.todos.find(t => t.id === id);
    if (!todo) return;
    state.editingId = id;

    DOM.modalText().value     = todo.text;
    DOM.modalPriority().value = todo.priority;
    DOM.modalDate().value     = todo.dueDate || '';
    DOM.modalSyncToggle().checked = !!todo.calSync;

    DOM.modal().hidden = false;
    document.body.style.overflow = 'hidden';
    requestAnimationFrame(() => DOM.modalText().focus());
  },

  close() {
    DOM.modal().hidden = true;
    document.body.style.overflow = '';
    state.editingId = null;
  },

  save() {
    const id = state.editingId;
    if (!id) return;
    const text = DOM.modalText().value.trim();
    if (!text) { DOM.modalText().focus(); return; }

    crud.update(id, {
      text,
      priority: DOM.modalPriority().value,
      dueDate:  DOM.modalDate().value,
      calSync:  DOM.modalSyncToggle().checked,
    });
    modal.close();
    ui.render();
  },
};

/* ═══════════════════════════════════════════════
   8. EVENT BINDING
═══════════════════════════════════════════════ */
function bindEvents() {
  // Add task
  DOM.addTaskBtn().addEventListener('click', handleAddTask);
  DOM.newTaskInput().addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleAddTask();
  });

  // Nav filters
  DOM.navItems().forEach(btn => {
    btn.addEventListener('click', () => ui.setFilter(btn.dataset.filter));
  });

  // Sort
  DOM.sortSelect().addEventListener('change', (e) => {
    state.sort = e.target.value;
    ui.render();
  });

  // Clear completed
  DOM.clearCompletedBtn().addEventListener('click', () => {
    if (state.todos.some(t => t.completed)) {
      crud.clearCompleted();
      ui.render();
    }
  });

  // Google Calendar — sync all
  DOM.gcalSyncAllBtn()?.addEventListener('click', () => {
    window.googleCalendar?.syncAllTodos(state.todos, crud.updateCalFields.bind(crud));
  });

  // Edit modal
  DOM.modalSaveBtn().addEventListener('click',   modal.save);
  DOM.modalCancelBtn().addEventListener('click', modal.close);
  DOM.modalCloseBtn().addEventListener('click',  modal.close);
  DOM.modal().addEventListener('click', (e) => {
    if (e.target === DOM.modal()) modal.close();
  });

  // Global keyboard
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (!DOM.modal().hidden) { modal.close(); return; }
      const setup = document.getElementById('setup-modal');
      if (setup && !setup.hidden) { window.googleCalendar?.closeSetupModal(); return; }
    }
    if (e.key === 'Enter' && !DOM.modal().hidden) {
      // Only save if focus is not on cancel button
      if (document.activeElement !== DOM.modalCancelBtn()) modal.save();
    }
  });
}

function handleAddTask() {
  const input    = DOM.newTaskInput();
  const text     = input.value.trim();
  if (!text) { input.focus(); return; }

  const priority  = DOM.newPriority().value;
  const dueDate   = DOM.newDate().value;
  const syncToggle = DOM.newSyncToggle();
  const calSync   = syncToggle ? syncToggle.checked : false;

  crud.add(text, priority, dueDate, calSync);

  // Reset form
  input.value                   = '';
  DOM.newDate().value           = '';
  DOM.newPriority().value       = 'medium';
  if (syncToggle) {
    syncToggle.checked = false;
    document.getElementById('add-cal-label')?.classList.remove('is-checked');
  }
  input.focus();
  ui.render();
}

/* ═══════════════════════════════════════════════
   9. INIT
═══════════════════════════════════════════════ */
function init() {
  crud.load();
  bindEvents();

  // Init Google Calendar module (defined in googleCalendar.js)
  window.googleCalendar?.init();

  ui.render();
}

document.addEventListener('DOMContentLoaded', init);