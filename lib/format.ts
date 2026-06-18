// Pure formatting helpers — safe to import from client and server.

export function fmtTokens(n: number): string {
  if (n == null || isNaN(n)) return "0";
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000) return (n / 1_000_000_000).toFixed(2) + "B";
  if (abs >= 1_000_000) return (n / 1_000_000).toFixed(2) + "M";
  if (abs >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return String(Math.round(n));
}

export function fmtInt(n: number): string {
  if (n == null || isNaN(n)) return "0";
  return Math.round(n).toLocaleString("en-US");
}

// Compact follower/subscriber count, e.g. 104407192 -> "104.4M", 1800 -> "1.8K".
export function fmtCount(n: number | null | undefined): string {
  if (n == null || isNaN(n)) return "—";
  const f = (x: number) => x.toFixed(1).replace(/\.0$/, "");
  const a = Math.abs(n);
  if (a >= 1e9) return f(n / 1e9) + "B";
  if (a >= 1e6) return f(n / 1e6) + "M";
  if (a >= 1e3) return f(n / 1e3) + "K";
  return String(Math.round(n));
}

// Signed delta, e.g. 1234 -> "+1.2K", -5 -> "-5".
export function fmtDelta(n: number | null | undefined): string {
  if (n == null || isNaN(n) || n === 0) return "";
  return (n > 0 ? "+" : "-") + fmtCount(Math.abs(n));
}

export function fmtUsd(n: number): string {
  if (n == null || isNaN(n)) return "$0.00";
  if (n >= 1000) return "$" + (n / 1000).toFixed(2) + "K";
  if (n >= 100) return "$" + n.toFixed(0);
  if (n > 0 && n < 0.01) return "<$0.01"; // don't render real sub-cent spend as $0.00
  return "$" + n.toFixed(2);
}

export function fmtPct(n: number): string {
  if (n == null || isNaN(n)) return "0%";
  return (n * 100).toFixed(0) + "%";
}

// Relative "time ago" in compact form.
export function ago(ms: number | null, now: number = Date.now()): string {
  if (!ms) return "—";
  const d = Math.max(0, now - ms);
  const s = Math.floor(d / 1000);
  if (s < 60) return s + "s";
  const m = Math.floor(s / 60);
  if (m < 60) return m + "m";
  const h = Math.floor(m / 60);
  if (h < 24) return h + "h";
  const days = Math.floor(h / 24);
  if (days < 30) return days + "d";
  const mo = Math.floor(days / 30);
  return mo + "mo";
}

export function clockHHMMSS(date: Date): string {
  const p = (x: number) => String(x).padStart(2, "0");
  return `${p(date.getHours())}:${p(date.getMinutes())}:${p(date.getSeconds())}`;
}
