/**
 * The family income Compare's slider was last set to, kept in this browser only (specs/product/cost-by-income.md
 * "Explore": a per-viewer convenience, never sent anywhere or saved to an account). Every read and write is guarded:
 * storage can be blocked or full, and the page works the same without it. Client-side only.
 */
const KEY = "cost-income";
const EVENT = "cost-income-change";

/** The remembered income in dollars, or null when none is stored or storage is unavailable. */
export function readIncome(): number | null {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw === null) return null;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? n : null;
  } catch {
    return null;
  }
}

export function writeIncome(income: number): void {
  try {
    window.localStorage.setItem(KEY, String(income));
  } catch {
    // Storage blocked or full: the slider still works for this visit.
  }
  window.dispatchEvent(new Event(EVENT));
}

/** For `useSyncExternalStore`: re-read after a write in this tab or another. */
export function subscribeIncome(onChange: () => void): () => void {
  window.addEventListener(EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}
