// Shared types for the nagadb console.

/** A database a user created in the console (Neon calls these "projects"). */
export interface Project {
  /** Stable unique id used in URLs and as the data namespace, e.g. "blue-sky-1a2b". */
  id: string;
  /** Human-friendly name the user typed. */
  name: string;
  /** Cosmetic region label, like a cloud provider region. */
  region: string;
  /** Secret API key the user uses to authenticate. */
  apiKey: string;
  /** ISO timestamp of when it was created. */
  createdAt: string;
}

/** A project plus its derived connection details (never persisted — computed). */
export interface ProjectWithConnection extends Project {
  /** HTTP base URL an app/SDK points at. */
  httpUrl: string;
  /** A Postgres/Mongo-style connection string for show. */
  connectionString: string;
}

/** A key/value pair stored inside a project's database. */
export interface Entry {
  key: string;
  value: string;
}
