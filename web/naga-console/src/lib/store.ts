// The project registry — the "control plane" that remembers which databases
// exist. It is intentionally simple: a JSON file on disk under .data/.
//
// In a real cloud product this would be a metadata database. For testing the
// "create a database, get a connection URL" flow, a JSON file is perfect.

import { promises as fs } from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import type { Project, ProjectWithConnection } from "./types";

const DATA_DIR = path.join(process.cwd(), ".data");
const PROJECTS_FILE = path.join(DATA_DIR, "projects.json");

/** Where apps connect. Overridable so the same console works on a VPS. */
const PUBLIC_HOST =
  process.env.NEXT_PUBLIC_NAGADB_HOST ?? "http://127.0.0.1:9000";

// --- low-level file helpers -------------------------------------------------

async function readAll(): Promise<Project[]> {
  try {
    const raw = await fs.readFile(PROJECTS_FILE, "utf8");
    return JSON.parse(raw) as Project[];
  } catch {
    return []; // file not created yet
  }
}

async function writeAll(projects: Project[]): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(PROJECTS_FILE, JSON.stringify(projects, null, 2), "utf8");
}

// --- id / key generation ----------------------------------------------------

const ADJECTIVES = [
  "blue", "green", "swift", "calm", "bold", "bright", "quiet", "lucky",
  "rapid", "solar", "lunar", "crimson", "amber", "violet", "noble",
];
const NOUNS = [
  "sky", "leaf", "wave", "stone", "river", "field", "cloud", "forest",
  "ember", "summit", "harbor", "meadow", "comet", "delta", "grove",
];

/** A friendly, unique-ish id like "swift-river-9f3a". */
function generateId(): string {
  const a = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const n = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  const suffix = randomBytes(2).toString("hex");
  return `${a}-${n}-${suffix}`;
}

/** A secret API key, shown once-ish in the connection string. */
function generateApiKey(): string {
  return "naga_" + randomBytes(24).toString("hex");
}

// --- connection details (derived) -------------------------------------------

/** Attach the HTTP URL and a Postgres-style connection string to a project. */
export function withConnection(p: Project): ProjectWithConnection {
  // Strip protocol for the connection-string host segment.
  const host = PUBLIC_HOST.replace(/^https?:\/\//, "");
  return {
    ...p,
    httpUrl: `${PUBLIC_HOST}/db/${p.id}`,
    // Looks like a database connection string people already know.
    connectionString: `nagadb://${p.id}:${p.apiKey}@${host}/${p.id}?ssl=require`,
  };
}

// --- public API -------------------------------------------------------------

export async function listProjects(): Promise<ProjectWithConnection[]> {
  const projects = await readAll();
  return projects
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map(withConnection);
}

export async function getProject(
  id: string
): Promise<ProjectWithConnection | null> {
  const projects = await readAll();
  const found = projects.find((p) => p.id === id);
  return found ? withConnection(found) : null;
}

export async function createProject(
  name: string,
  region: string
): Promise<ProjectWithConnection> {
  const projects = await readAll();

  // Generate an id, retrying on the rare collision.
  let id = generateId();
  while (projects.some((p) => p.id === id)) id = generateId();

  const project: Project = {
    id,
    name: name.trim() || "untitled",
    region: region || "local-dev",
    apiKey: generateApiKey(),
    createdAt: new Date().toISOString(),
  };
  projects.push(project);
  await writeAll(projects);
  return withConnection(project);
}

export async function deleteProject(id: string): Promise<boolean> {
  const projects = await readAll();
  const next = projects.filter((p) => p.id !== id);
  if (next.length === projects.length) return false;
  await writeAll(next);
  return true;
}
