// nagadb JavaScript/TypeScript client auth demo
// ---------------------------------------------
//
// This reads your exact connection string:
//   nagadb://noble-delta-535a:naga_298438132d9211965bb1d13fe08732be640cc71c45848e01@127.0.0.1:9000/noble-delta-535a?ssl=require

import { NagaClient } from "nagadb";
import bcrypt from "bcrypt";

const CONNECTION_STRING = "nagadb://noble-delta-535a:naga_298438132d9211965bb1d13fe08732be640cc71c45848e01@127.0.0.1:9000/noble-delta-535a?ssl=require";

// Parse connection string to target the Next.js dev server's data endpoint (port 3001).
const dbId = "noble-delta-535a";
const httpUrl = `http://127.0.0.1:3001/api/projects/${dbId}`;
console.log(`Connecting to database: ${dbId} via console proxy at: ${httpUrl}\n`);

// 2. Initialize the client.
// We override the default client methods slightly to adapt to Next.JS route structure.
class ConsoleClient extends NagaClient {
  constructor(url) {
    super(url);
  }

  // Override to talk to the unified data proxy endpoint: /api/projects/:id/data
  async put(key, value) {
    const res = await fetch(`${this.baseUrl}/data`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, value }),
    });
    if (!res.ok) throw new Error(`Write failed: ${res.status}`);
  }

  async get(key) {
    const res = await fetch(`${this.baseUrl}/data`);
    if (!res.ok) throw new Error(`Read failed: ${res.status}`);
    const { entries } = await res.json();
    const found = entries.find(e => e.key === key);
    return found ? found.value : null;
  }

  async delete(key) {
    const res = await fetch(`${this.baseUrl}/data?key=${encodeURIComponent(key)}`, {
      method: "DELETE",
    });
    if (!res.ok) throw new Error(`Delete failed: ${res.status}`);
  }

  async scan() {
    const res = await fetch(`${this.baseUrl}/data`);
    if (!res.ok) throw new Error(`Scan failed: ${res.status}`);
    const { entries } = await res.json();
    return entries;
  }

  async ping() {
    try {
      const res = await fetch(`${this.baseUrl}`);
      return res.ok;
    } catch {
      return false;
    }
  }
}

const db = new ConsoleClient(httpUrl);

// --- User Auth Logic --------------------------------------------------------

/** Sign up a new user if their email doesn't exist yet. */
async function signUp(email, password) {
  const normEmail = email.toLowerCase().trim();
  const dbKey = `user:${normEmail}`;

  // Check if user already exists
  const existing = await db.get(dbKey);
  if (existing) {
    throw new Error(`Email "${email}" is already registered`);
  }

  // Hash the password so we never store raw passwords (standard security practice)
  const saltRounds = 10;
  const passwordHash = await bcrypt.hash(password, saltRounds);

  // Store the user profile as a JSON string
  const profile = {
    email: normEmail,
    passwordHash,
    createdAt: new Date().toISOString(),
  };

  await db.put(dbKey, JSON.stringify(profile));
  console.log(`[Success] Registered new user: ${normEmail}`);
}

/** Log in a user by comparing their password with the stored hash. */
async function logIn(email, password) {
  const normEmail = email.toLowerCase().trim();
  const dbKey = `user:${normEmail}`;

  // Look up user
  const rawData = await db.get(dbKey);
  if (!rawData) {
    throw new Error("Invalid email or password");
  }

  const profile = JSON.parse(rawData);

  // Compare the typed password with the stored hash
  const match = await bcrypt.compare(password, profile.passwordHash);
  if (!match) {
    throw new Error("Invalid email or password");
  }

  console.log(`[Success] Logged in successfully as: ${normEmail}`);
  return profile;
}

// --- Run the Test Tour ------------------------------------------------------

async function testAuth() {
  console.log("=== RUNNING AUTHENTICATION TEST ===");

  // Check server is up first
  if (!(await db.ping())) {
    console.error("Error: Could not reach the nagadb engine.\nEnsure it is running in another terminal:\n  cd api && cargo run\n");
    process.exit(1);
  }

  try {
    // 1. Create two test accounts
    console.log("--- 1. Registering Users ---");
    await signUp("alice@example.com", "supersecret123");
    await signUp("bob@example.com", "password456");

    // 2. Try to register a duplicate email
    console.log("\n--- 2. Duplicate Registration Test ---");
    try {
      await signUp("alice@example.com", "newpassword");
    } catch (err) {
      console.log(`[Caught Expected Error]: ${err.message}`);
    }

    // 3. Log in with correct password
    console.log("\n--- 3. Correct Log In Test ---");
    await logIn("alice@example.com", "supersecret123");

    // 4. Log in with wrong password
    console.log("\n--- 4. Wrong Password Test ---");
    try {
      await logIn("alice@example.com", "wrongpassword");
    } catch (err) {
      console.log(`[Caught Expected Error]: ${err.message}`);
    }

    // 5. Log in with a non-existent email
    console.log("\n--- 5. Non-existent Email Test ---");
    try {
      await logIn("stranger@example.com", "somepassword");
    } catch (err) {
      console.log(`[Caught Expected Error]: ${err.message}`);
    }

    // 6. View database records
    console.log("\n--- 6. Raw Data Dump ---");
    const entries = await db.scan();
    console.log("Entries in database space:");
    for (const { key, value } of entries) {
      console.log(`  ${key} -> ${value}`);
    }

    // Clean up our test users so the test is reusable
    console.log("\n--- 7. Cleaning Up Test Users ---");
    await db.delete("user:alice@example.com");
    await db.delete("user:bob@example.com");
    console.log("Deleted test users.");

  } catch (err) {
    console.error("Test error:", err.message);
  }
}

testAuth();
