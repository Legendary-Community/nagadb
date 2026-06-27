"use client";

import { useState } from "react";
import type { ProjectWithConnection } from "@/lib/types";
import ConnectionPanel from "./ConnectionPanel";
import CopyButton from "./CopyButton";
import { BoltIcon } from "./icons";

export default function DatabaseConnect({
  project,
}: {
  project: ProjectWithConnection;
}) {
  const [lang, setLang] = useState<"js" | "py" | "curl">("js");

  const jsSnippet = `import { NagaClient } from "nagadb";

// Initialize client
const db = new NagaClient("${project.httpUrl}");

// Write data (safe across crashes)
await db.put("user:1", "Alice");

// Read data
const value = await db.get("user:1"); // "Alice"

// Delete key
await db.delete("user:1");`;

  const pySnippet = `import urllib.request
import urllib.parse
import json

# Connection Details
url = "${project.httpUrl}/data"

# 1. Write key/value pair (POST)
payload = json.dumps({"key": "user:1", "value": "Alice"}).encode("utf-8")
req = urllib.request.Request(
    url, 
    data=payload, 
    headers={"Content-Type": "application/json"},
    method="POST"
)
with urllib.request.urlopen(req) as res:
    print(json.loads(res.read().decode()))  # {"ok": true}

# 2. Read key (GET)
with urllib.request.urlopen(f"{url}?key=user:1") as res:
    data = json.loads(res.read().decode())
    print(data.get("value"))  # "Alice"`;

  const curlSnippet = `# Write key/value pair
curl -X POST ${project.httpUrl}/data \\
  -H "Content-Type: application/json" \\
  -d '{"key": "user:1", "value": "Alice"}'

# Read key
curl "${project.httpUrl}/data?key=user:1"

# Delete key
curl -X DELETE "${project.httpUrl}/data?key=user:1"`;

  const snippets = {
    js: jsSnippet,
    py: pySnippet,
    curl: curlSnippet,
  };

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      {/* Connection details panel */}
      <div className="rounded-2xl border border-border bg-surface/50 p-5 shadow-sm backdrop-blur-sm">
        <h3 className="mb-4 text-[14px] font-bold text-foreground">
          Connection Strings
        </h3>
        <ConnectionPanel
          connectionString={project.connectionString}
          httpUrl={project.httpUrl}
          apiKey={project.apiKey}
        />
      </div>

      {/* Language snippets */}
      <div className="rounded-2xl border border-border bg-surface/50 p-5 shadow-sm backdrop-blur-sm">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-[14px] font-bold text-foreground">
            <BoltIcon size={15} className="text-accent" />
            Connect from code
          </h3>
          <CopyButton text={snippets[lang]} label="Copy snippet" />
        </div>

        {/* Tab switcher */}
        <div className="mb-3.5 flex border-b border-border">
          {(["js", "py", "curl"] as const).map((l) => (
            <button
              key={l}
              onClick={() => setLang(l)}
              className={`pb-2 px-3 text-[12px] font-semibold uppercase tracking-wider transition ${
                lang === l
                  ? "border-b-2 border-accent text-accent"
                  : "text-muted hover:text-foreground"
              }`}
            >
              {l === "js" ? "JS / TS" : l === "py" ? "Python" : "cURL"}
            </button>
          ))}
        </div>

        {/* Preformatted Snippet */}
        <pre className="max-h-96 overflow-x-auto rounded-xl border border-border bg-background/60 p-4 font-mono text-[12px] leading-relaxed text-foreground">
          {snippets[lang]}
        </pre>
      </div>
    </div>
  );
}
