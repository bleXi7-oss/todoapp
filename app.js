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
  todos:       [],
  filter:      'all',   // 'all' | 'active' | 'completed'
  sort:        'manual', // 'manual' | 'priority' | 'dueDate' | 'created'
  editingId:   null,    // id of task being edited in modal
  dragState: {
    draggedId:  null,
    overId:     null,
  },
};

const STORAGE_KEY = 'doable_todos_v2';

/* ═══════════════════════════════════════════════
   2. DOM REFERENCES
═══════════════════════════════════════════════ */
const DOM = {
  taskList:        () => document.getElementById('task-list'),
  emptyState:      () => document.getElementById('empty-state'),
  emptyTitle:      () => document.getElementById('empty-title'),
  emptySub:        () => document.getElementById('empty-sub'),
  overdueBanner:   () => document.getElementById('overdue-banner'),
  overdueText:     () => document.getElementById('overdue-text'),
  pageSubtitle:    () => document.getElementById('page-subtitle'),

  // Add form
  newTaskInput:    () => document.getElementById('new-task-input'),
  newPriority:     () => document.getElementById('new-priority'),
  newDate:         () => document.getElementById('new-date'),
  addTaskBtn:      () => document.getElementById('add-task-btn'),

  // Filters / sort
  navItems:        () => document.querySelectorAll('.nav-item'),
  sortSelect:      () => document.getElementById('sort-select'),
  clearCompletedBtn: () => document.getElementById('clear-completed-btn'),

  // Badges
  badgeAll:        () => document.getElementById('badge-all'),
  badgeActive:     () => document.getElementById('badge-active'),
  badgeCompleted:  () => document.getElementById('badge-completed'),

  // Modal
  modal:           () => document.getElementById('edit-modal'),
  modalText:       () => document.getElementById('modal-text'),
  modalPriority:   () => document.getElementById('modal-priority'),
  modalDate:       () => document.getElementById('modal-date'),
  modalSaveBtn:    () => document.getElementById('modal-save-btn'),
  modalCancelBtn:  () => document.getElementById('modal-cancel-btn'),
  modalCloseBtn:   () => document.getElementById('modal-close-btn'),
};

/* ═══════════════════════════════════════════════
   3. UTILS
═══════════════════════════════════════════════ */
const utils = {
  /** Sanitise user text to prevent XSS */
  escapeHTML(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  },

  /** Generate a simple unique id */
  uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  },

  /** Return ISO date string for today (local time) */
  todayISO() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  },

  /** Check if an ISO date string is strictly before today */
  isOverdue(dateISO) {
    if (!dateISO) return false;
    return dateISO < utils.todayISO();
  },

  /** Format ISO date → readable string */
  formatDate(dateISO) {
    if (!dateISO) return '';
    const [y, m, d] = dateISO.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    const today = new Date();
    today.setHours(0,0,0,0);
    const diff = Math.round((date - today) / 86400000);

    if (diff === 0) return 'Today';
    if (diff === 1) return 'Tomorrow';
    if (diff === -1) return 'Yesterday';
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  },

  /** Priority sort order */
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
    } catch {
      state.todos = [];
    }
  },

  save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state.todos));
    } catch (e) {
      console.warn('Could not save to localStorage', e);
    }
  },

  add(text, priority, dueDate) {
    const todo = {
      id:        utils.uid(),
      text:      text.trim(),
      completed: false,
      priority:  priority || 'medium',
      dueDate:   dueDate || '',
      createdAt: Date.now(),
    };
    state.todos.unshift(todo);
    crud.save();
    return todo;
  },

  toggle(id) {
    const todo = state.todos.find(t => t.id === id);
    if (todo) {
      todo.completed = !todo.completed;
      crud.save();
    }
  },

  update(id, { text, priority, dueDate }) {
    const todo = state.todos.find(t => t.id === id);
    if (todo) {
      if (text !== undefined)     todo.text     = text.trim();
      if (priority !== undefined) todo.priority = priority;
      if (dueDate !== undefined)  todo.dueDate  = dueDate;
      crud.save();
    }
  },

  remove(id) {
    state.todos = state.todos.filter(t => t.id !== id);
    crud.save();
  },

  clearCompleted() {
    state.todos = state.todos.filter(t => !t.completed);
    crud.save();
  },

  /** Reorder: move dragged item before the over item */
  reorder(draggedId, overId) {
    if (draggedId === overId) return;
    const from = state.todos.findIndex(t => t.id === draggedId);
    const to   = state.todos.findIndex(t => t.id === overId);
    if (from === -1 || to === -1) return;
    const [item] = state.todos.splice(from, 1);
    state.todos.splice(to, 0, item);
    crud.save();
  },

  /** Get todos filtered and sorted for display */
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
    // 'manual' = state.todos order (preserved via reorder)

    return list;
  },
};

/* ═══════════════════════════════════════════════
   5. UI RENDERING
═══════════════════════════════════════════════ */
const ui = {
  /** Full re-render of the task list and surrounding chrome */
  render() {
    const visible  = crud.getVisible();
    const all      = state.todos;
    const active   = all.filter(t => !t.completed);
    const completed = all.filter(t => t.completed);
    const overdue  = active.filter(t => utils.isOverdue(t.dueDate));

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
    if (overdue.length > 0) {
      ob.hidden = false;
      DOM.overdueText().textContent = overdue.length === 1
        ? '1 task is overdue'
        : `${overdue.length} tasks are overdue`;
    } else {
      ob.hidden = true;
    }

    // Empty state
    const es = DOM.emptyState();
    if (visible.length === 0) {
      es.hidden = false;
      if (state.filter === 'completed') {
        DOM.emptyTitle().textContent = 'No completed tasks yet';
        DOM.emptySub().textContent   = 'Finish something to see it here.';
      } else if (state.filter === 'active') {
        DOM.emptyTitle().textContent = 'All done!';
        DOM.emptySub().textContent   = 'Everything is taken care of.';
      } else {
        DOM.emptyTitle().textContent = 'All clear here';
        DOM.emptySub().textContent   = 'Add your first task above to get started.';
      }
    } else {
      es.hidden = true;
    }

    // Task list — use fragment for performance
    const list = DOM.taskList();
    const frag = document.createDocumentFragment();

    visible.forEach(todo => {
      frag.appendChild(ui.buildTaskEl(todo));
    });

    list.innerHTML = '';
    list.appendChild(frag);
  },

  /** Build a single task <li> element */
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
        </div>
      </div>

      <div class="task-actions" role="group" aria-label="Task actions">
        <button class="task-action-btn edit-btn" aria-label="Edit task" title="Edit">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M9.5 2.5l2 2-7 7H2.5v-2l7-7z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>
          </svg>
        </button>
        <button class="task-action-btn delete-btn" aria-label="Delete task" title="Delete">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M2 4h10M5 4V2.5a.5.5 0 01.5-.5h3a.5.5 0 01.5.5V4M10 4l-.7 7.5a.5.5 0 01-.5.5H5.2a.5.5 0 01-.5-.5L4 4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
      </div>
    `;

    // Wire up events directly on the element
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

    // Drag events
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
          <svg width="9" height="9" viewBox="0 0 9 9" fill="none"><circle cx="4.5" cy="4.5" r="4" stroke="currentColor" stroke-width="1.1"/><path d="M4.5 2.5v2.2M4.5 6.2v.3" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/></svg>
          Overdue · ${label}
        </span>`;
    }
    return `
      <span class="meta-date">
        <svg width="11" height="11" viewBox="0 0 11 11" fill="none"><rect x="1" y="2" width="9" height="8" rx="1.5" stroke="currentColor" stroke-width="1.1"/><path d="M3.5 1v2M7.5 1v2M1 5h9" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/></svg>
        ${label}
      </span>`;
  },

  /** Animate removal then delete from state */
  removeWithAnimation(el, id) {
    el.style.transition = 'opacity 180ms ease, transform 180ms ease, max-height 220ms ease 60ms, margin 220ms ease 60ms, padding 220ms ease 60ms';
    el.style.overflow   = 'hidden';
    el.style.maxHeight  = el.offsetHeight + 'px';
    requestAnimationFrame(() => {
      el.style.opacity   = '0';
      el.style.transform = 'translateX(8px)';
      el.style.maxHeight = '0';
      el.style.marginBottom = '0';
      el.style.paddingTop   = '0';
      el.style.paddingBottom = '0';
    });
    setTimeout(() => {
      crud.remove(id);
      ui.render();
    }, 280);
  },

  /** Update nav active state */
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
    const id = e.currentTarget.dataset.id;
    state.dragState.draggedId = id;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', id);
    // Delay class so the ghost image captures the un-dimmed state
    requestAnimationFrame(() => {
      e.currentTarget.classList.add('dragging');
    });
  },

  onDragEnd(e) {
    e.currentTarget.classList.remove('dragging');
    // Clean up all drag-over highlights
    document.querySelectorAll('.task-item.drag-over').forEach(el => {
      el.classList.remove('drag-over');
    });
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
    // Only remove if leaving the element entirely (not a child)
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
    // Switch to manual sort so order is preserved
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
    if (!text) {
      DOM.modalText().focus();
      return;
    }
    crud.update(id, {
      text,
      priority: DOM.modalPriority().value,
      dueDate:  DOM.modalDate().value,
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

  // Filter nav
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

  // Modal buttons
  DOM.modalSaveBtn().addEventListener('click',   modal.save);
  DOM.modalCancelBtn().addEventListener('click', modal.close);
  DOM.modalCloseBtn().addEventListener('click',  modal.close);

  // Close modal on backdrop click
  DOM.modal().addEventListener('click', (e) => {
    if (e.target === DOM.modal()) modal.close();
  });

  // Close modal on Escape
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !DOM.modal().hidden) modal.close();
    if (e.key === 'Enter'  && !DOM.modal().hidden) modal.save();
  });
}

function handleAddTask() {
  const input    = DOM.newTaskInput();
  const text     = input.value.trim();
  if (!text) {
    input.focus();
    return;
  }
  const priority = DOM.newPriority().value;
  const dueDate  = DOM.newDate().value;

  crud.add(text, priority, dueDate);

  // Reset form
  input.value          = '';
  DOM.newDate().value  = '';
  DOM.newPriority().value = 'medium';
  input.focus();

  ui.render();
}

/* ═══════════════════════════════════════════════
   9. INIT
═══════════════════════════════════════════════ */
function init() {
  crud.load();
  bindEvents();
  ui.render();
}

document.addEventListener('DOMContentLoaded', init);