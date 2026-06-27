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
    <aside className="flex w-[248px] shrink-0 flex-col border-r border-border bg-sidebar">
      {/* Brand */}
      <div className="flex h-14 items-center border-b border-border px-4">
        <Link href="/" className="inline-flex">
          <Logo />
        </Link>
      </div>

      {/* Workspace switcher */}
      <div className="px-3 pt-3">
        <button className="flex w-full items-center justify-between rounded-lg border border-border bg-surface px-2.5 py-2 text-left transition hover:border-border-strong">
          <span className="flex items-center gap-2.5">
            <span className="flex h-6 w-6 items-center justify-center rounded-md bg-accent/15 text-[11px] font-bold text-accent">
              N
            </span>
            <span className="flex flex-col leading-tight">
              <span className="text-[13px] font-medium text-foreground">
                My Workspace
              </span>
              <span className="text-[11px] text-subtle">Free plan</span>
            </span>
          </span>
          <ChevronDownIcon size={15} className="text-subtle" />
        </button>
      </div>

      {/* Nav */}
      <nav className="flex flex-col gap-0.5 px-3 pt-4">
        <p className="px-2.5 pb-1.5 text-[11px] font-medium uppercase tracking-wider text-subtle">
          Console
        </p>
        {items.map((it) => {
          const isActive = it.key === active;
          return (
            <Link
              key={it.key}
              href={it.href}
              className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] font-medium transition ${
                isActive
                  ? "bg-surface-2 text-foreground"
                  : "text-muted hover:bg-surface/70 hover:text-foreground"
              }`}
            >
              <span className={isActive ? "text-accent" : "text-subtle"}>
                {it.icon}
              </span>
              {it.label}
            </Link>
          );
        })}
      </nav>

      {/* Footer status */}
      <div className="mt-auto border-t border-border p-3">
        <div className="flex items-center gap-2 px-1.5 py-1 text-[12px] text-muted">
          <span className="h-1.5 w-1.5 rounded-full bg-accent shadow-[0_0_8px_var(--accent)]" />
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
