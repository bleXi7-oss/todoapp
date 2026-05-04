// ======================
// STATE
// ======================
let todos = JSON.parse(localStorage.getItem("todos")) || [];
let currentFilter = "all";
let draggedId = null;

const CLIENT_ID = "576797485556-9gi7glhjmf65qfs4efaedc6fjc0k3n0g.apps.googleusercontent.com";
const SCOPES = "https://www.googleapis.com/auth/calendar.events";

let tokenClient;
let accessToken = localStorage.getItem("google_token") || null;

// ======================
// DOM
// ======================
const todoForm = document.getElementById("todo-form");
const todoInput = document.getElementById("todo-input");
const todoList = document.getElementById("todo-list");
const filterBtns = document.querySelectorAll(".filter-btn");
const activeCount = document.getElementById("active-count");
const loginStatus = document.getElementById("login-status");

// ======================
// INIT
// ======================
document.addEventListener("DOMContentLoaded", () => {
    renderTodos();
    updateStats();
    updateLoginUI();
});

// ======================
// GOOGLE INIT
// ======================
window.onload = () => {
    tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID,
        scope: SCOPES,
        callback: (tokenResponse) => {
            accessToken = tokenResponse.access_token;
            localStorage.setItem("google_token", accessToken);

            updateLoginUI();
            console.log("Google login success ✅");
        },
    });
};

// ======================
// LOGIN
// ======================
document.getElementById("google-login").addEventListener("click", () => {
    tokenClient.requestAccessToken();
});

// ======================
// LOGIN UI STATUS
// ======================
function updateLoginUI() {
    if (accessToken) {
        loginStatus.textContent = "Signed in to Google ✅";
        loginStatus.style.color = "#10b981";
    } else {
        loginStatus.textContent = "Not signed in";
        loginStatus.style.color = "#94a3b8";
    }
}

// ======================
// ADD TODO
// ======================
todoForm.addEventListener("submit", addTodo);

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

    // 🟢 SAFE calendar sync
    if (accessToken && dueDate) {
        createGoogleEvent(todo);
    }

    todoInput.value = "";
}

// ======================
// ROBUST GOOGLE CALENDAR SYNC
// ======================
async function createGoogleEvent(todo) {
    try {
        const event = {
            summary: todo.text,
            description: `Priority: ${todo.priority}`,
            start: {
                date: todo.dueDate
            },
            end: {
                date: todo.dueDate
            }
        };

        const res = await fetch(
            "https://www.googleapis.com/calendar/v3/calendars/primary/events",
            {
                method: "POST",
                headers: {
                    Authorization: "Bearer " + accessToken,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify(event)
            }
        );

        if (!res.ok) {
            const err = await res.json();
            console.error("Calendar error:", err);
            alert("Failed to add to Google Calendar");
            return;
        }

        console.log("Event added 📅");
    } catch (err) {
        console.error("Network error:", err);
        alert("Network error while adding event");
    }
}

// ======================
// CLICK HANDLER
// ======================
todoList.addEventListener("click", handleClick);

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
filterBtns.forEach(btn =>
    btn.addEventListener("click", handleFilter)
);

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
            <input type="checkbox" class="todo-checkbox" ${todo.completed ? "checked" : ""}>
            <span class="todo-text">${todo.text}</span>
            <small>${todo.dueDate || ""}</small>
            <button class="delete">🗑</button>
        `;

        todoList.appendChild(li);
    });

    updateStats();
}

// ======================
// STORAGE
// ======================
function saveState() {
    localStorage.setItem("todos", JSON.stringify(todos));
    updateStats();
}

function updateStats() {
    activeCount.textContent = todos.filter(t => !t.completed).length;
}