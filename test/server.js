// A tiny auth website backend that tests nagadb.
//
// The browser (public/index.html) talks to THIS server. This server does the
// password hashing and talks to the nagadb engine. That's the correct shape:
// passwords are only ever hashed/checked on the server, never in the browser.
//
// Run the engine first (cd api && cargo run), then:  npm run web
// Open http://127.0.0.1:4000

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import bcrypt from "bcrypt";
import { NagaClient } from "nagadb";

// --- connection -------------------------------------------------------------

// Your real connection string. Paste a different one to point at another db.
const CONNECTION_STRING =
  "nagadb://noble-delta-535a:naga_298438132d9211965bb1d13fe08732be640cc71c45848e01@127.0.0.1:9000/noble-delta-535a?ssl=require";

/** Pull the host and database id out of a nagadb:// connection string. */
function parseConnection(connStr) {
  const u = new URL(connStr.replace(/^nagadb:\/\//, "http://"));
  const dbId = u.pathname.replace(/^\/+/, "");
  return { engineUrl: `http://${u.host}`, dbId };
}

const { engineUrl, dbId } = parseConnection(CONNECTION_STRING);
const db = new NagaClient(engineUrl);

// Keys are namespaced by database id so each database is isolated, exactly like
// the console does it:  db:<id>:user:<email>
const userKey = (email) => `db:${dbId}:user:${email.toLowerCase().trim()}`;
const USER_PREFIX = `db:${dbId}:user:`;

// --- auth logic -------------------------------------------------------------

async function signUp(email, password) {
  if (!email || !password) throw new Error("email and password are required");
  if (password.length < 6)
    throw new Error("password must be at least 6 characters");

  const existing = await db.get(userKey(email));
  if (existing) throw new Error("that email is already registered");

  const passwordHash = await bcrypt.hash(password, 10);
  const profile = {
    email: email.toLowerCase().trim(),
    passwordHash,
    createdAt: new Date().toISOString(),
  };
  await db.put(userKey(email), JSON.stringify(profile));
  return { email: profile.email, createdAt: profile.createdAt };
}

async function logIn(email, password) {
  const raw = await db.get(userKey(email));
  if (!raw) throw new Error("invalid email or password");

  const profile = JSON.parse(raw);
  const ok = await bcrypt.compare(password, profile.passwordHash);
  if (!ok) throw new Error("invalid email or password");

  return { email: profile.email, createdAt: profile.createdAt };
}

/** List registered users (without the password hash) for the demo panel. */
async function listUsers() {
  const all = await db.scan();
  return all
    .filter((e) => e.key.startsWith(USER_PREFIX))
    .map((e) => {
      const p = JSON.parse(e.value);
      return { email: p.email, createdAt: p.createdAt };
    });
}

// --- tiny HTTP server -------------------------------------------------------

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, "public");
const PORT = 4000;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
};

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(body);
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
}

async function serveStatic(res, urlPath) {
  const file = urlPath === "/" ? "index.html" : urlPath.replace(/^\/+/, "");
  const full = path.join(PUBLIC_DIR, file);
  // Keep requests inside public/.
  if (!full.startsWith(PUBLIC_DIR)) {
    res.writeHead(403).end("Forbidden");
    return;
  }
  try {
    const data = await readFile(full);
    res.writeHead(200, {
      "Content-Type": MIME[path.extname(full)] ?? "application/octet-stream",
    });
    res.end(data);
  } catch {
    res.writeHead(404).end("Not Found");
  }
}

const server = createServer(async (req, res) => {
  const { method, url } = req;
  const urlPath = (url ?? "/").split("?")[0];

  try {
    if (method === "POST" && urlPath === "/api/signup") {
      const { email, password } = await readBody(req);
      const user = await signUp(email, password);
      return sendJson(res, 201, { ok: true, user });
    }

    if (method === "POST" && urlPath === "/api/login") {
      const { email, password } = await readBody(req);
      const user = await logIn(email, password);
      return sendJson(res, 200, { ok: true, user });
    }

    if (method === "GET" && urlPath === "/api/users") {
      return sendJson(res, 200, { users: await listUsers() });
    }

    if (method === "GET") {
      return await serveStatic(res, urlPath);
    }

    sendJson(res, 404, { ok: false, error: "not found" });
  } catch (err) {
    // EngineOfflineError or a thrown auth error.
    const offline = err?.name === "NagaError" && /reach/i.test(err.message);
    sendJson(res, offline ? 503 : 400, {
      ok: false,
      error: offline ? "nagadb engine is offline" : err.message,
    });
  }
});

server.listen(PORT, () => {
  console.log("============================================");
  console.log("  nagadb auth demo website");
  console.log(`  Database:  ${dbId}`);
  console.log(`  Engine:    ${engineUrl}`);
  console.log(`  Open:      http://127.0.0.1:${PORT}`);
  console.log("============================================");
});

// If the port is already taken (e.g. the server is already running), show a
// clear message instead of a crash with a stack trace.
server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(
      `\nPort ${PORT} is already in use — the auth website is probably already ` +
        `running.\nJust open http://127.0.0.1:${PORT} in your browser.\n` +
        `(To stop the other instance: lsof -ti:${PORT} | xargs kill)\n`
    );
    process.exit(0);
  }
  throw err;
});
