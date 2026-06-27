import Link from "next/link";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md";

const VARIANTS: Record<Variant, string> = {
  primary:
    "bg-accent text-accent-fg hover:bg-accent-dim font-bold shadow-[0_2px_10px_rgba(0,229,153,0.15)] border border-transparent cursor-pointer",
  secondary:
    "bg-surface-2/65 text-foreground border border-border hover:border-border-strong hover:bg-surface-2 hover:text-foreground cursor-pointer",
  ghost:
    "bg-transparent text-muted border border-transparent hover:bg-surface-2 hover:text-foreground cursor-pointer",
  danger:
    "bg-transparent text-danger border border-danger/30 hover:bg-danger/10 hover:border-danger/65 cursor-pointer",
};

const SIZES: Record<Size, string> = {
  sm: "h-8 px-3 text-[12px] gap-1.5 rounded-lg",
  md: "h-9.5 px-4 text-[13px] gap-2 rounded-xl",
};

function classes(variant: Variant, size: Size, extra = "") {
  return `inline-flex items-center justify-center font-bold tracking-wide transition-all duration-200 disabled:opacity-50 disabled:pointer-events-none ${VARIANTS[variant]} ${SIZES[size]} ${extra}`;
}

export function Button({
  variant = "secondary",
  size = "md",
  className = "",
  ...props
}: {
  variant?: Variant;
  size?: Size;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button className={classes(variant, size, className)} {...props} />;
}

export function ButtonLink({
  variant = "secondary",
  size = "md",
  className = "",
  href,
  children,
}: {
  variant?: Variant;
  size?: Size;
  className?: string;
  href: string;
  children: React.ReactNode;
}) {
  return (
    <Link href={href} className={classes(variant, size, className)}>
      {children}
    </Link>
  );
}
