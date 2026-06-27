// TypeScript type definitions for the nagadb client.
// These let TypeScript users get autocomplete and type-checking.

/** A single key/value pair returned by `scan()`. */
export interface Entry {
  key: string;
  value: string;
}

/** Database statistics returned by `stats()`. */
export interface Stats {
  /** Number of live key/value pairs. */
  entries: number;
  /** Number of on-disk SSTable files. */
  sstables: number;
}

/** Options accepted by the `NagaClient` constructor. */
export interface NagaClientOptions {
  /** How long to wait per request, in milliseconds. Default 10000. */
  timeoutMs?: number;
  /** Custom fetch implementation (for tests or older runtimes). */
  fetch?: typeof fetch;
}

/** Error thrown when the server responds with a problem. */
export class NagaError extends Error {
  name: "NagaError";
  /** HTTP status code, if a response was received. */
  status?: number;
  constructor(message: string, status?: number);
}

/** A connection to a nagadb server. */
export class NagaClient {
  readonly baseUrl: string;
  readonly timeoutMs: number;

  constructor(baseUrl?: string, options?: NagaClientOptions);

  /** Save a key/value pair, overwriting any existing value. */
  put(key: string, value: string): Promise<void>;

  /** Look up a key. Resolves to the value, or `null` if absent. */
  get(key: string): Promise<string | null>;

  /** Check whether a key exists. */
  has(key: string): Promise<boolean>;

  /** Delete a key. Deleting a missing key is not an error. */
  delete(key: string): Promise<void>;

  /** Read every key/value pair, sorted by key. */
  scan(): Promise<Entry[]>;

  /** Get all entries as a plain object `{ key: value }`. */
  toObject(): Promise<Record<string, string>>;

  /** Get database statistics. */
  stats(): Promise<Stats>;

  /** Flush the memtable to a new SSTable. Returns the new SSTable count. */
  flush(): Promise<{ sstables: number }>;

  /** Merge all SSTables into one. Returns the SSTable count afterwards. */
  compact(): Promise<{ sstables: number }>;

  /** Check that the server is reachable. */
  ping(): Promise<boolean>;
}

export default NagaClient;
