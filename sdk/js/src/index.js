// nagadb JavaScript/TypeScript client
// ------------------------------------
//
// This is the "steering wheel and pedals" for nagadb: a small library that lets
// any program talk to the database with clean method calls, instead of writing
// raw HTTP requests by hand.
//
// It works in Node.js (>= 18) and in modern browsers, because it relies only on
// the built-in `fetch` function that both provide.
//
// Quick start:
//
//   import { NagaClient } from "nagadb";
//
//   const db = new NagaClient("http://127.0.0.1:9000");
//   await db.put("user:1", "Alice");
//   const name = await db.get("user:1");   // "Alice"
//   await db.delete("user:1");
//

/**
 * Error thrown when the database server responds with a problem
 * (a non-2xx status, or a JSON body that says `ok: false`).
 */
export class NagaError extends Error {
  /**
   * @param {string} message  human-readable description
   * @param {number} [status] HTTP status code, if there was a response
   */
  constructor(message, status) {
    super(message);
    this.name = "NagaError";
    this.status = status;
  }
}

/**
 * A connection to a nagadb server.
 *
 * One client points at one server URL. It holds no open sockets — every call
 * is a fresh HTTP request — so a single client can be shared everywhere.
 */
export class NagaClient {
  /**
   * @param {string} [baseUrl="http://127.0.0.1:9000"] the server address
   * @param {object} [options]
   * @param {number} [options.timeoutMs=10000] how long to wait per request
   * @param {typeof fetch} [options.fetch] custom fetch (for tests/old runtimes)
   */
  constructor(baseUrl = "http://127.0.0.1:9000", options = {}) {
    // Drop any trailing slash so we can safely join paths with `+`.
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.timeoutMs = options.timeoutMs ?? 10000;
    this._fetch = options.fetch ?? globalThis.fetch;

    if (typeof this._fetch !== "function") {
      throw new NagaError(
        "No `fetch` available. Use Node 18+, a browser, or pass options.fetch."
      );
    }
  }

  // --------------------------------------------------------------------------
  // Public API — the methods you actually call.
  // --------------------------------------------------------------------------

  /**
   * Save a key/value pair. Overwrites any existing value for that key.
   * @param {string} key
   * @param {string} value
   * @returns {Promise<void>}
   */
  async put(key, value) {
    requireString("key", key);
    requireString("value", value);
    const body = new URLSearchParams({ key, value }).toString();
    await this._post("/api/put", body);
  }

  /**
   * Look up a key.
   * @param {string} key
   * @returns {Promise<string | null>} the value, or `null` if the key is absent
   */
  async get(key) {
    requireString("key", key);
    const query = new URLSearchParams({ key }).toString();
    const data = await this._get(`/api/get?${query}`);
    return data.found ? data.value : null;
  }

  /**
   * Check whether a key exists.
   * @param {string} key
   * @returns {Promise<boolean>}
   */
  async has(key) {
    return (await this.get(key)) !== null;
  }

  /**
   * Delete a key. Deleting a missing key is not an error.
   * @param {string} key
   * @returns {Promise<void>}
   */
  async delete(key) {
    requireString("key", key);
    const body = new URLSearchParams({ key }).toString();
    await this._post("/api/delete", body);
  }

  /**
   * Read every key/value pair currently in the database, sorted by key.
   * @returns {Promise<Array<{ key: string, value: string }>>}
   */
  async scan() {
    const data = await this._get("/api/list");
    return Array.isArray(data) ? data : [];
  }

  /**
   * Get all entries as a plain object: `{ key: value, ... }`.
   * Convenient, but loads everything into memory — use `scan()` for big data.
   * @returns {Promise<Record<string, string>>}
   */
  async toObject() {
    const items = await this.scan();
    const out = {};
    for (const { key, value } of items) out[key] = value;
    return out;
  }

  /**
   * Get database statistics.
   * @returns {Promise<{ entries: number, sstables: number }>}
   */
  async stats() {
    return await this._get("/api/stats");
  }

  /**
   * Flush the in-memory memtable to a new on-disk SSTable.
   * @returns {Promise<{ sstables: number }>} the new SSTable count
   */
  async flush() {
    const data = await this._post("/api/flush", "");
    return { sstables: data.sstables };
  }

  /**
   * Compact (merge) all SSTables into one, dropping deleted entries.
   * @returns {Promise<{ sstables: number }>} the SSTable count afterwards
   */
  async compact() {
    const data = await this._post("/api/compact", "");
    return { sstables: data.sstables };
  }

  /**
   * Check that the server is reachable.
   * @returns {Promise<boolean>}
   */
  async ping() {
    try {
      await this.stats();
      return true;
    } catch {
      return false;
    }
  }

  // --------------------------------------------------------------------------
  // Internals — HTTP plumbing. You don't call these directly.
  // --------------------------------------------------------------------------

  /** @returns {Promise<any>} parsed JSON */
  async _get(path) {
    return this._request("GET", path, undefined);
  }

  /** @returns {Promise<any>} parsed JSON */
  async _post(path, body) {
    return this._request("POST", path, body);
  }

  /**
   * Send one request, parse JSON, and turn failures into NagaError.
   * @returns {Promise<any>}
   */
  async _request(method, path, body) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let res;
    try {
      const init = { method, signal: controller.signal };
      if (body !== undefined) {
        init.headers = { "Content-Type": "application/x-www-form-urlencoded" };
        init.body = body;
      }
      res = await this._fetch(this.baseUrl + path, init);
    } catch (err) {
      clearTimeout(timer);
      if (err && err.name === "AbortError") {
        throw new NagaError(`Request timed out after ${this.timeoutMs}ms`);
      }
      throw new NagaError(`Cannot reach nagadb at ${this.baseUrl}: ${err.message}`);
    } finally {
      clearTimeout(timer);
    }

    const text = await res.text();
    let data;
    try {
      data = text.length ? JSON.parse(text) : {};
    } catch {
      throw new NagaError(`Server sent invalid JSON: ${text.slice(0, 200)}`, res.status);
    }

    if (!res.ok || data.ok === false) {
      const msg = data.error || `Request failed (HTTP ${res.status})`;
      throw new NagaError(msg, res.status);
    }
    return data;
  }
}

/** Throw a clear error if a value isn't a string. */
function requireString(name, value) {
  if (typeof value !== "string") {
    throw new NagaError(`\`${name}\` must be a string, got ${typeof value}`);
  }
}

export default NagaClient;
