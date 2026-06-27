import Link from "next/link";
import {
  DatabaseIcon,
  BookIcon,
  SettingsIcon,
  ChevronDownIcon,
} from "./icons";

/** The nagadb wordmark with its green node glyph. */
export function Logo({ size = 18 }: { size?: number }) {
  return (
    <span className="flex items-center gap-2">
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
        <circle cx="12" cy="12" r="9" stroke="var(--accent)" strokeWidth="2.2" />
        <circle cx="12" cy="12" r="3.2" fill="var(--accent)" />
      </svg>
      <span className="text-[15px] font-semibold tracking-tight text-foreground">
        naga<span className="text-accent">db</span>
      </span>
    </span>
  );
}

type NavKey = "projects" | "docs" | "settings";

/** The left navigation rail shared by every console page. */
export function Sidebar({ active }: { active?: NavKey }) {
  const items: {
    href: string;
    label: string;
    key: NavKey;
    icon: React.ReactNode;
  }[] = [
    {
      href: "/",
      label: "Databases",
      key: "projects",
      icon: <DatabaseIcon size={16} />,
    },
    {
      href: "/#connect",
      label: "Connect",
      key: "docs",
      icon: <BookIcon size={16} />,
    },
    {
      href: "/#settings",
      label: "Settings",
      key: "settings",
      icon: <SettingsIcon size={16} />,
    },
  ];

  return (
    <aside className="flex w-[248px] shrink-0 flex-col border-r border-border bg-sidebar/95 backdrop-blur-md">
      {/* Brand Logo Header */}
      <div className="flex h-14 items-center border-b border-border/80 px-5">
        <Link href="/" className="inline-flex items-center transform hover:scale-[1.02] transition-transform">
          <Logo size={20} />
        </Link>
      </div>

      {/* Workspace Switcher */}
      <div className="px-4 pt-4">
        <div className="group relative rounded-xl border border-border bg-surface/40 p-3 shadow-sm transition hover:border-border-strong hover:bg-surface/70">
          <div className="flex items-center gap-3">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent/15 text-[11px] font-bold text-accent shadow-[0_0_8px_rgba(0,229,153,0.15)]">
              N
            </span>
            <div className="flex flex-col min-w-0 flex-1">
              <span className="truncate text-[12px] font-bold text-foreground leading-tight">
                My Workspace
              </span>
              <span className="text-[10px] font-medium text-subtle mt-0.5">Free plan</span>
            </div>
            <ChevronDownIcon size={14} className="text-subtle transition-transform group-hover:translate-y-[1px]" />
          </div>
        </div>
      </div>

      {/* Nav Menu */}
      <nav className="flex flex-col gap-1.5 px-4 pt-6">
        <p className="px-2.5 pb-1 text-[10px] font-extrabold uppercase tracking-widest text-subtle/80">
          Console Workspace
        </p>
        {items.map((it) => {
          const isActive = it.key === active;
          return (
            <Link
              key={it.key}
              href={it.href}
              className={`flex items-center gap-3 rounded-lg px-2.5 py-2.5 text-[13px] font-semibold transition-all duration-200 relative group ${
                isActive
                  ? "bg-surface-2 text-foreground shadow-[inset_1px_0_0_var(--accent)]"
                  : "text-muted hover:bg-surface/45 hover:text-foreground hover:translate-x-[2px]"
              }`}
            >
              {/* Active Tab Glow Marker */}
              {isActive && (
                <span className="absolute left-0 top-1/4 bottom-1/4 w-[2.2px] rounded bg-accent shadow-[0_0_8px_var(--accent)]" />
              )}
              <span className={`transition-colors duration-200 ${isActive ? "text-accent" : "text-subtle group-hover:text-foreground"}`}>
                {it.icon}
              </span>
              {it.label}
            </Link>
          );
        })}
      </nav>

      {/* Footer Status Box */}
      <div className="mt-auto p-4 border-t border-border/80">
        <div className="flex items-center gap-2.5 px-2.5 py-2 rounded-xl bg-surface/30 border border-border/50 text-[11px] font-medium text-muted">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-accent opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-accent shadow-[0_0_8px_var(--accent)]"></span>
          </span>
          All systems operational
        </div>
      </div>
    </aside>
  );
}

/** Page shell: sidebar + a main column with a sticky topbar. */
export function Shell({
  active,
  breadcrumb,
  actions,
  children,
}: {
  active?: NavKey;
  breadcrumb: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-full">
      <Sidebar active={active} />
      <main className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 flex h-14 items-center justify-between border-b border-border bg-background/80 px-6 backdrop-blur">
          <div className="flex min-w-0 items-center gap-2 text-[13px]">
            {breadcrumb}
          </div>
          <div className="flex items-center gap-3">
            {actions}
            <div className="ml-1 h-7 w-7 rounded-full bg-gradient-to-br from-accent/80 to-accent-dim" />
          </div>
        </header>
        <div className="mx-auto w-full max-w-6xl flex-1 px-6 py-7">
          {children}
        </div>
      </main>
    </div>
  );
}
