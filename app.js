// ======================
// STATE
// ======================
let todos = JSON.parse(localStorage.getItem("todos")) || [];
let currentFilter = "all";
let draggedId = null;

const CLIENT_ID = "576797485556-9gi7glhjmf65qfs4efaedc6fjc0k3n0g.apps.googleusercontent.com";
const SCOPES = "https://www.googleapis.com/auth/calendar.events";

let tokenClient;
let accessToken = null;

// ======================
// DOM
// ======================
const todoForm = document.getElementById("todo-form");
const todoInput = document.getElementById("todo-input");
const todoList = document.getElementById("todo-list");
const filterBtns = document.querySelectorAll(".filter-btn");
const activeCount = document.getElementById("active-count");

// ======================
// INIT
// ======================
document.addEventListener("DOMContentLoaded", () => {
    renderTodos();
    updateStats();
});

// ======================
// GOOGLE LOGIN
// ======================
window.onload = () => {
    tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID,
        scope: SCOPES,
        callback: (tokenResponse) => {
            accessToken = tokenResponse.access_token;
            localStorage.setItem("google_token", accessToken);
            console.log("Google login OK ✅");
        },
    });
};

document.getElementById("google-login").addEventListener("click", () => {
    tokenClient.requestAccessToken();
});

// ======================
// EVENTS
// ======================
todoForm.addEventListener("submit", addTodo);
todoList.addEventListener("click", handleClick);
filterBtns.forEach(btn => btn.addEventListener("click", handleFilter));

// ======================
// ADD TODO
// ======================
function addTodo(e) {
    e.preventDefault();

    const text = todoInput.value.trim();
    const priority = document.getElementById("priority").value;
    const dueDate = document.getElementById("due-date").value;

    if (!text) return;

    const todo = {
        id: crypto.randomUUID(),
        text,
        completed: false,
        priority,
        dueDate,
        createdAt: Date.now()
    };

    todos.unshift(todo);

    saveState();
    renderTodos();

    // optional: send to Google Calendar
    if (accessToken && dueDate) {
        createGoogleEvent(todo);
    }

    todoInput.value = "";
}

// ======================
// GOOGLE CALENDAR EVENT
// ======================
async function createGoogleEvent(todo) {
    const event = {
        summary: todo.text,
        start: { date: todo.dueDate },
        end: { date: todo.dueDate }
    };

    await fetch("https://www.googleapis.com/calendar/v3/calendars/primary/events", {
        method: "POST",
        headers: {
            "Authorization": "Bearer " + accessToken,
            "Content-Type": "application/json"
        },
        body: JSON.stringify(event)
    });

    console.log("Event added to Google Calendar 📅");
}

// ======================
// CLICK
// ======================
function handleClick(e) {
    const item = e.target.closest(".todo-item");
    if (!item) return;

    const id = item.dataset.id;
    const todo = todos.find(t => t.id === id);

    if (!todo) return;

    if (e.target.classList.contains("todo-checkbox")) {
        todo.completed = e.target.checked;
    }

    if (e.target.classList.contains("delete")) {
        todos = todos.filter(t => t.id !== id);
    }

    saveState();
    renderTodos();
}

// ======================
// FILTERS
// ======================
function handleFilter(e) {
    filterBtns.forEach(b => b.classList.remove("active"));
    e.target.classList.add("active");

    currentFilter = e.target.dataset.filter;
    renderTodos();
}

// ======================
// RENDER
// ======================
function renderTodos() {
    todoList.innerHTML = "";

    const filtered = todos.filter(t => {
        if (currentFilter === "active") return !t.completed;
        if (currentFilter === "completed") return t.completed;
        return true;
    });

    filtered.forEach(todo => {
        const li = document.createElement("li");

        li.dataset.id = todo.id;
        li.className = `todo-item ${todo.priority}`;

        li.innerHTML = `
            <div class="todo-main">
                <input type="checkbox" class="todo-checkbox" ${todo.completed ? "checked" : ""}>
                <div class="todo-content">
                    <div class="todo-text">${todo.text}</div>
                    <div class="todo-meta">
                        <span>${todo.dueDate || "no date"}</span>
                        <span class="priority ${todo.priority}">${todo.priority}</span>
                    </div>
                </div>
            </div>

            <div class="todo-actions">
                <button class="delete">🗑</button>
            </div>
        `;

        todoList.appendChild(li);
    });

    updateStats();
}

// ======================
// SAVE
// ======================
function saveState() {
    localStorage.setItem("todos", JSON.stringify(todos));
    updateStats();
}

function updateStats() {
    activeCount.textContent = todos.filter(t => !t.completed).length;
}