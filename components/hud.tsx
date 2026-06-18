import React from "react";

export function cn(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

// The Nerve Center neural mark — inherits color via currentColor.
export function BrainMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 400 400"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <path d="M60.4363 145.826L98.4346 125.95C99.1398 125.581 99.5818 124.851 99.5818 124.055V79.0967C99.5818 78.2072 100.133 77.4105 100.965 77.0963L159.125 55.1379C159.867 54.8578 160.702 55.0112 161.296 55.5363L197.473 87.5182C197.932 87.9241 198.195 88.5074 198.195 89.1202V311.623C198.195 312.218 197.947 312.786 197.512 313.19L163.867 344.429C163.228 345.022 162.294 345.168 161.505 344.798L104.532 318.092C103.781 317.74 103.301 316.985 103.301 316.156V273.007C103.301 272.175 102.819 271.419 102.064 271.068L60.5261 251.762C59.7716 251.411 59.2891 250.655 59.2891 249.823V147.721C59.2891 146.925 59.7311 146.195 60.4363 145.826Z" stroke="currentColor" strokeWidth="26.297" strokeMiterlimit="10" />
      <path d="M335.946 145.826L297.948 125.95C297.243 125.581 296.801 124.851 296.801 124.055V79.0967C296.801 78.2072 296.25 77.4105 295.418 77.0963L237.258 55.1379C236.516 54.8578 235.68 55.0112 235.086 55.5363L198.909 87.5182C198.45 87.9241 198.188 88.5074 198.188 89.1202V311.623C198.188 312.218 198.435 312.786 198.871 313.19L232.515 344.429C233.154 345.022 234.089 345.168 234.878 344.798L291.851 318.092C292.602 317.74 293.081 316.985 293.081 316.156V273.007C293.081 272.175 293.564 271.419 294.318 271.068L335.856 251.762C336.611 251.411 337.093 250.655 337.093 249.823V147.721C337.093 146.925 336.651 146.195 335.946 145.826Z" stroke="currentColor" strokeWidth="26.297" strokeMiterlimit="10" />
      <path d="M154.129 65.0625V120.397" stroke="currentColor" strokeWidth="20.1923" strokeMiterlimit="10" />
      <path d="M154.128 113.188C164.636 113.188 173.154 121.706 173.154 132.214C173.154 142.722 164.636 151.24 154.128 151.24C143.62 151.24 135.102 142.722 135.102 132.214C135.102 121.706 143.62 113.188 154.128 113.188Z" fill="currentColor" stroke="currentColor" strokeWidth="0.469589" />
      <path d="M59 193.852H97.1612" stroke="currentColor" strokeWidth="20.1923" strokeMiterlimit="10" />
      <path d="M108.987 174.828C119.495 174.828 128.014 183.347 128.014 193.854C128.014 204.362 119.495 212.881 108.987 212.881C98.4796 212.881 89.9609 204.362 89.9609 193.854C89.9609 183.347 98.4796 174.828 108.987 174.828Z" fill="currentColor" stroke="currentColor" strokeWidth="0.469589" />
      <path d="M195.748 236.312H172.721L159.176 249.858" stroke="currentColor" strokeWidth="20.1923" strokeMiterlimit="10" />
      <path d="M148.003 240.223C158.511 240.223 167.029 248.741 167.029 259.249C167.029 269.757 158.511 278.275 148.003 278.275C137.495 278.275 128.977 269.757 128.977 259.249C128.977 248.741 137.495 240.223 148.003 240.223Z" fill="currentColor" stroke="currentColor" strokeWidth="0.469589" />
      <path d="M198.188 200.359H268.763" stroke="currentColor" strokeWidth="20.1923" strokeMiterlimit="10" />
      <path d="M279.972 181.328C290.479 181.328 298.998 189.847 298.998 200.354C298.998 210.862 290.479 219.381 279.972 219.381C269.464 219.381 260.945 210.862 260.945 200.354C260.945 189.847 269.464 181.328 279.972 181.328Z" fill="currentColor" stroke="currentColor" strokeWidth="0.469589" />
      <path d="M315.217 137.125H259.883" stroke="currentColor" strokeWidth="20.1923" strokeMiterlimit="10" />
      <path d="M248.05 118.102C258.558 118.102 267.076 126.62 267.076 137.128C267.076 147.636 258.558 156.154 248.05 156.154C237.542 156.154 229.023 147.636 229.023 137.128C229.023 126.62 237.542 118.102 248.05 118.102Z" fill="currentColor" stroke="currentColor" strokeWidth="0.469589" />
      <path d="M293.451 304.646L250.988 262.184" stroke="currentColor" strokeWidth="20.1923" strokeMiterlimit="10" />
      <path d="M243.812 235.031C254.319 235.031 262.838 243.55 262.838 254.058C262.838 264.565 254.319 273.084 243.812 273.084C233.304 273.084 224.785 264.565 224.785 254.058C224.785 243.55 233.304 235.031 243.812 235.031Z" fill="currentColor" stroke="currentColor" strokeWidth="0.469589" />
    </svg>
  );
}

// L-shaped crop-mark brackets at the four corners of a relative parent.
export function Corners({ accent }: { accent?: boolean }) {
  const c = accent ? "border-accent-line" : "border-line-strong";
  const base = "pointer-events-none absolute h-2 w-2";
  return (
    <>
      <span className={cn(base, "left-0 top-0 border-l border-t", c)} />
      <span className={cn(base, "right-0 top-0 border-r border-t", c)} />
      <span className={cn(base, "left-0 bottom-0 border-l border-b", c)} />
      <span className={cn(base, "right-0 bottom-0 border-r border-b", c)} />
    </>
  );
}

export function Panel({
  children,
  className,
  corners = true,
  accent = false,
}: {
  children: React.ReactNode;
  className?: string;
  corners?: boolean;
  accent?: boolean;
}) {
  return (
    <div className={cn("panel relative", accent && "border-accent-line", className)}>
      {corners && <Corners accent={accent} />}
      {children}
    </div>
  );
}

// Section header: a small index tag, an uppercase title, a dotted leader that
// fills the row, and an optional right-aligned control cluster.
export function SectionHeader({
  index,
  title,
  right,
  className,
}: {
  index?: string;
  title: string;
  right?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center gap-3", className)}>
      {index && (
        <span className="label text-accent shrink-0" style={{ letterSpacing: "0.12em" }}>
          {index}
        </span>
      )}
      <h2 className="font-display text-[13px] font-semibold uppercase tracking-[0.22em] text-ink shrink-0">
        {title}
      </h2>
      <span className="leader" />
      {right && <div className="shrink-0">{right}</div>}
    </div>
  );
}

export function Hair({ className }: { className?: string }) {
  return <div className={cn("h-px w-full bg-line", className)} />;
}

export function Chip({
  children,
  tone = "dim",
  pulse = false,
  className,
}: {
  children: React.ReactNode;
  tone?: "dim" | "online" | "accent" | "cool";
  pulse?: boolean;
  className?: string;
}) {
  const map: Record<string, string> = {
    dim: "text-ink-dim",
    online: "text-online",
    accent: "text-accent",
    cool: "text-cool",
  };
  const dot: Record<string, string> = {
    dim: "bg-ink-dim",
    online: "bg-online",
    accent: "bg-accent",
    cool: "bg-cool",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 border border-line px-2 py-1 text-[10px] uppercase tracking-[0.16em]",
        map[tone],
        className
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", dot[tone], pulse && "pulse")} />
      {children}
    </span>
  );
}

export function Tag({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "inline-block border border-line-soft px-1.5 py-0.5 text-[9px] uppercase tracking-[0.16em] text-ink-dim",
        className
      )}
    >
      {children}
    </span>
  );
}

// A labelled metric: tiny uppercase label over a big tabular-mono value.
export function Stat({
  label,
  value,
  unit,
  sub,
  glow,
  className,
}: {
  label: string;
  value: React.ReactNode;
  unit?: string;
  sub?: React.ReactNode;
  glow?: "accent" | "online";
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <span className="label">{label}</span>
      <div className="flex items-baseline gap-1">
        <span
          className={cn(
            "tnum font-display text-2xl font-semibold leading-none text-ink",
            glow === "accent" && "glow-accent",
            glow === "online" && "glow-online"
          )}
        >
          {value}
        </span>
        {unit && <span className="label text-ink-dim">{unit}</span>}
      </div>
      {sub && <span className="text-[10px] tracking-wide text-ink-dim">{sub}</span>}
    </div>
  );
}
