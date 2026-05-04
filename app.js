console.log("APP RUNNING");

let todos = JSON.parse(localStorage.getItem('todos')) || [];
let currentFilter = 'all';
let draggedId = null;

// DOM
const todoForm = document.getElementById('todo-form');
const todoInput = document.getElementById('todo-input');
const todoList = document.getElementById('todo-list');
const filterBtns = document.querySelectorAll('.filter-btn');
const activeCount = document.getElementById('active-count');

// INIT
document.addEventListener('DOMContentLoaded', () => {
    renderTodos();
    updateStats();
});

// EVENTS
todoForm.addEventListener('submit', addTodo);
todoList.addEventListener('click', handleClick);
filterBtns.forEach(btn => btn.addEventListener('click', handleFilter));

// ADD
function addTodo(e) {
    e.preventDefault();

    const text = todoInput.value.trim();
    const priority = document.getElementById('priority').value;
    const dueDate = document.getElementById('due-date').value;

    if (!text) return;

    todos.unshift({
        id: crypto.randomUUID(),
        text,
        completed: false,
        priority,
        dueDate,
        createdAt: Date.now()
    });

    todoInput.value = '';
    save();
    renderTodos();
}

// CLICK
function handleClick(e) {
    const item = e.target.closest('.todo-item');
    if (!item) return;

    const id = item.dataset.id;
    const todo = todos.find(t => t.id === id);
    if (!todo) return;

    if (e.target.classList.contains('todo-checkbox')) {
        todo.completed = e.target.checked;
        save();
        renderTodos();
    }

    if (e.target.classList.contains('delete')) {
        todos = todos.filter(t => t.id !== id);
        save();
        renderTodos();
    }

    if (e.target.classList.contains('edit')) {
        const newText = prompt("Edit task:", todo.text);
        if (newText?.trim()) todo.text = newText.trim();

        save();
        renderTodos();
    }
}

// FILTER
function handleFilter(e) {
    filterBtns.forEach(b => b.classList.remove('active'));
    e.target.classList.add('active');

    currentFilter = e.target.dataset.filter;
    renderTodos();
}

// RENDER (KLJUČNO POPRAVLJENO)
function renderTodos() {
    todoList.innerHTML = '';

    const filtered = todos.filter(t => {
        if (currentFilter === 'active') return !t.completed;
        if (currentFilter === 'completed') return t.completed;
        return true;
    });

    if (!filtered.length) {
        todoList.innerHTML = `<li class="empty">No tasks</li>`;
        return;
    }

    filtered.forEach(todo => {
        const li = document.createElement('li');
        li.className = `todo-item ${todo.priority}`;
        li.dataset.id = todo.id;

        li.innerHTML = `
            <div class="todo-top">
                <input type="checkbox" class="todo-checkbox" ${todo.completed ? 'checked' : ''}>
                <span class="todo-text">${escapeHTML(todo.text)}</span>
                <div class="todo-actions">
                    <button class="edit">✏️</button>
                    <button class="delete">🗑</button>
                </div>
            </div>

            <div class="todo-meta">
                <span class="badge ${todo.priority}">${todo.priority}</span>
                ${todo.dueDate ? `<span>📅 ${todo.dueDate}</span>` : ''}
            </div>
        `;

        todoList.appendChild(li);
    });

    updateStats();
}

// SAVE
function save() {
    localStorage.setItem('todos', JSON.stringify(todos));
    updateStats();
}

// STATS
function updateStats() {
    activeCount.textContent = todos.filter(t => !t.completed).length;
}

// SECURITY
function escapeHTML(str = '') {
    return String(str).replace(/[&<>"']/g, m => ({
        '&':'&amp;',
        '<':'&lt;',
        '>':'&gt;',
        '"':'&quot;',
        "'":'&#39;'
    }[m]));
}