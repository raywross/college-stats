export function pct(value: number, digits = 0): string {
  return `${(value * 100).toFixed(digits)}%`;
}

/** Percent with one decimal only when it matters (e.g. 3.4% but 52%). */
export function pctSmart(value: number): string {
  return value < 0.1 ? pct(value, 1) : pct(value, 0);
}

export function num(value: number): string {
  return Math.round(value).toLocaleString("en-US");
}

export function compact(value: number): string {
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

/** $12,548 */
export function money(value: number): string {
  return `$${Math.round(value).toLocaleString("en-US")}`;
}

/** $12.5K */
export function moneyCompact(value: number): string {
  return `$${compact(value)}`;
}

export function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
}

export function range([lo, hi]: [number, number]): string {
  return `${lo}–${hi}`;
}

export function typeLabel(type: string): string {
  switch (type) {
    case "public":
      return "Public";
    case "private-nonprofit":
      return "Private nonprofit";
    case "private-forprofit":
      return "Private for-profit";
    default:
      return type;
  }
}

export function typeShort(type: string): string {
  return type === "public" ? "Public" : "Private";
}

/** Serializable formatter names, for passing formats into client components. */
export type FormatKind = "pct" | "pctSmart" | "int" | "num" | "compact" | "fixed2" | "money" | "moneyCompact" | "ratio" | "pts";

/** A difference of two shares in percentage points, signed, one decimal: −0.023 → "−2.3 pts". */
export function points(value: number): string {
  const v = Math.round(value * 1000) / 10;
  const sign = v > 0 ? "+" : v < 0 ? "−" : "";
  return `${sign}${Math.abs(v).toFixed(1)} pts`;
}

export function formatBy(kind: FormatKind, value: number): string {
  switch (kind) {
    case "pct":
      return pct(value);
    case "pctSmart":
      return pctSmart(value);
    case "num":
      return num(value);
    case "compact":
      return compact(value);
    case "fixed2":
      return value.toFixed(2);
    case "money":
      return money(value);
    case "moneyCompact":
      return moneyCompact(value);
    case "pts":
      return points(value);
    case "ratio":
      // Student-to-faculty ratio: "8 to 1".
      return `${Math.round(value)} to 1`;
    case "int":
    default:
      return String(Math.round(value));
  }
}
