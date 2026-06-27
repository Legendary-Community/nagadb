"use client";

import { useState } from "react";
import type { ProjectWithConnection } from "@/lib/types";
import DatabaseOverview from "./DatabaseOverview";
import DataBrowser from "./DataBrowser";
import DatabaseConnect from "./DatabaseConnect";
import DatabaseSettings from "./DatabaseSettings";

type Tab = "overview" | "data" | "connect" | "settings";

export default function ProjectDashboard({
  project,
}: {
  project: ProjectWithConnection;
}) {
  const [activeTab, setActiveTab] = useState<Tab>("overview");

  const tabs = [
    { id: "overview" as const, label: "Overview" },
    { id: "data" as const, label: "Data Browser" },
    { id: "connect" as const, label: "Connect SDK" },
    { id: "settings" as const, label: "Settings" },
  ];

  return (
    <div className="space-y-6">
      {/* Tab Navigation Menu */}
      <div className="flex border-b border-border bg-sidebar/30 rounded-lg p-1">
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex-1 sm:flex-none text-center pb-2.5 pt-2.5 px-6 text-[12px] font-bold uppercase tracking-wider rounded-md transition ${
                isActive
                  ? "bg-surface-2 text-accent shadow-sm border border-border"
                  : "text-muted hover:text-foreground"
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Active Tab Panel */}
      <div className="pt-1">
        {activeTab === "overview" && <DatabaseOverview project={project} />}
        {activeTab === "data" && <DataBrowser projectId={project.id} />}
        {activeTab === "connect" && <DatabaseConnect project={project} />}
        {activeTab === "settings" && <DatabaseSettings project={project} />}
      </div>
    </div>
  );
}
