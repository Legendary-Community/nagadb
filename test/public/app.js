// Frontend logic for the nagadb auth demo.
// The browser only collects email/password and calls our server. All hashing
// and database access happens on the server (server.js).

const form = document.getElementById("authForm");
const emailEl = document.getElementById("email");
const passwordEl = document.getElementById("password");
const submitBtn = document.getElementById("submitBtn");
const messageEl = document.getElementById("message");
const tabs = document.querySelectorAll(".tab");
const loggedIn = document.getElementById("loggedIn");
const whoEmail = document.getElementById("whoEmail");
const whoDb = document.getElementById("whoDb");
const logoutBtn = document.getElementById("logoutBtn");
const usersEl = document.getElementById("users");
const refreshUsers = document.getElementById("refreshUsers");

let mode = "login"; // or "signup"

// --- tab switching ----------------------------------------------------------

tabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    tabs.forEach((t) => t.classList.remove("active"));
    tab.classList.add("active");
    mode = tab.dataset.tab;
    submitBtn.textContent = mode === "login" ? "Log in" : "Sign up";
    setMessage("");
  });
});

// --- helpers ----------------------------------------------------------------

function setMessage(text, kind = "") {
  messageEl.textContent = text;
  messageEl.className = "message" + (kind ? " " + kind : "");
}

async function api(path, options) {
  const res = await fetch(path, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `request failed (${res.status})`);
  return data;
}

// --- submit (login or signup) ----------------------------------------------

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = emailEl.value.trim();
  const password = passwordEl.value;

  submitBtn.disabled = true;
  setMessage(mode === "login" ? "Logging in…" : "Creating account…");

  try {
    const endpoint = mode === "login" ? "/api/login" : "/api/signup";
    const data = await api(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    showLoggedIn(data.user);
    loadUsers();
  } catch (err) {
    setMessage(err.message, "error");
  } finally {
    submitBtn.disabled = false;
  }
});

// --- logged-in view ---------------------------------------------------------

function showLoggedIn(user) {
  form.classList.add("hidden");
  document.querySelector(".tabs").classList.add("hidden");
  loggedIn.classList.remove("hidden");
  whoEmail.textContent = user.email;
  whoDb.textContent = whoDb.dataset.db || "nagadb";
  form.reset();
}

logoutBtn.addEventListener("click", () => {
  loggedIn.classList.add("hidden");
  form.classList.remove("hidden");
  document.querySelector(".tabs").classList.remove("hidden");
  setMessage("Logged out.", "success");
});

// --- users panel ------------------------------------------------------------

async function loadUsers() {
  try {
    const { users } = await api("/api/users");
    whoDb.dataset.db = "nagadb";
    if (!users.length) {
      usersEl.innerHTML = `<div class="empty">No users yet. Sign up to add one.</div>`;
      return;
    }
    usersEl.innerHTML = users
      .map(
        (u) => `
        <div class="user-row">
          <div class="email">${escapeHtml(u.email)}</div>
          <div class="when">joined ${new Date(u.createdAt).toLocaleString()}</div>
        </div>`
      )
      .join("");
  } catch (err) {
    usersEl.innerHTML = `<div class="empty">${escapeHtml(err.message)}</div>`;
  }
}

function escapeHtml(s) {
  return s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]
  );
}

refreshUsers.addEventListener("click", loadUsers);

// Initial load.
loadUsers();
