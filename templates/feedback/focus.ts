"use client";

/**
 * Passive focus capture for the feedback widget.
 *
 * The widget should land richer context in each row WITHOUT making the user do
 * anything new — they click "Feedback", type, send. This module hosts the
 * background listeners that watch their cursor, clicks, text selection, console
 * errors, and visible named regions. When the modal opens, FeedbackButton calls
 * snapshotFocus() and stuffs the result into the submission.
 *
 * Every signal is cheap and bounded:
 *   - cursorTarget: one rAF-throttled mousemove writes the latest element.
 *   - recentClicks: capture-phase listener, ring buffer of 5 in the last 60s.
 *   - consoleErrors: monkey-patched console.error, ring buffer of 20 in 30s.
 *   - visibleRegions: IntersectionObserver, named regions register themselves
 *     via <FeedbackRegion> (or any [data-feedback-region] node).
 *   - textSelection + viewport: read at snapshot time, no listeners needed.
 *
 * Idempotent setup — safe under React StrictMode and re-mounts.
 */

export interface ElementSummary {
  tag: string;
  text: string;
  selector: string;
  ariaLabel: string | null;
  role: string | null;
  rect: { x: number; y: number; w: number; h: number };
}

export interface ClickRecord extends ElementSummary {
  at: number; // ms ago at snapshot time (or absolute ms during recording)
}

export interface ConsoleErrorRecord {
  at: number; // ms ago at snapshot time
  message: string;
}

export interface FocusSnapshot {
  cursorTarget: ElementSummary | null;
  textSelection: string | null;
  recentClicks: ClickRecord[];
  visibleRegions: string[];
  consoleErrors: ConsoleErrorRecord[];
  viewport: { w: number; h: number; scrollY: number };
}

// --- Module state (browser-only) -------------------------------------------

let cursorEl: Element | null = null;
const recentClicks: Array<ClickRecord & { absAt: number }> = [];
const consoleErrors: Array<{ absAt: number; message: string }> = [];
const visibleRegions = new Map<Element, string>();

const MAX_RECENT_CLICKS = 5;
const RECENT_CLICK_WINDOW_MS = 60_000;
const MAX_CONSOLE_ERRORS = 20;
const CONSOLE_ERROR_WINDOW_MS = 30_000;

let initialized = false;
let io: IntersectionObserver | null = null;

// --- Setup -----------------------------------------------------------------

/** One-shot initialization. Safe to call repeatedly. No-op on server. */
export function setupFocusTracking(): void {
  if (initialized || typeof window === "undefined") return;
  initialized = true;

  // Cursor: rAF-throttle so it's near-free even on noisy mousemoves.
  let pending = false;
  document.addEventListener(
    "mousemove",
    (e) => {
      if (pending) return;
      pending = true;
      requestAnimationFrame(() => {
        pending = false;
        const el = document.elementFromPoint(e.clientX, e.clientY);
        if (el) cursorEl = el;
      });
    },
    { passive: true },
  );

  // Recent clicks: capture-phase, so we see the actual target before React
  // synthetic-event handlers can swap it.
  document.addEventListener(
    "click",
    (e) => {
      const t = e.target as Element | null;
      if (!t) return;
      const summary = summarize(t);
      recentClicks.push({ ...summary, at: 0, absAt: Date.now() });
      trimRecentClicks();
    },
    { capture: true, passive: true },
  );

  // Console errors: monkey-patch console.error + window error events.
  const origError = console.error;
  console.error = (...args: unknown[]) => {
    consoleErrors.push({ absAt: Date.now(), message: serializeArgs(args) });
    trimConsoleErrors();
    return origError.apply(console, args as never[]);
  };
  window.addEventListener("error", (e) => {
    consoleErrors.push({ absAt: Date.now(), message: `Uncaught: ${e.message}` });
    trimConsoleErrors();
  });
  window.addEventListener("unhandledrejection", (e) => {
    const msg = e.reason instanceof Error ? e.reason.message : String(e.reason);
    consoleErrors.push({ absAt: Date.now(), message: `Unhandled rejection: ${msg}` });
    trimConsoleErrors();
  });

  // Visible regions: IntersectionObserver shared across all <FeedbackRegion>s.
  io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const name = (entry.target as HTMLElement).dataset.feedbackRegion;
        if (!name) continue;
        if (entry.isIntersecting) visibleRegions.set(entry.target, name);
        else visibleRegions.delete(entry.target);
      }
    },
    { threshold: 0.4 },
  );
}

/**
 * Register a DOM element as a named feedback region (used by the
 * <FeedbackRegion> component, but exported for any custom integration).
 * Returns a cleanup function that unregisters on unmount.
 */
export function registerRegion(el: Element, name: string): () => void {
  setupFocusTracking();
  (el as HTMLElement).dataset.feedbackRegion = name;
  io?.observe(el);
  return () => {
    io?.unobserve(el);
    visibleRegions.delete(el);
  };
}

// --- Snapshot --------------------------------------------------------------

/** Read all current focus signals. Called by FeedbackButton when the modal opens. */
export function snapshotFocus(): FocusSnapshot {
  if (typeof window === "undefined") {
    return {
      cursorTarget: null,
      textSelection: null,
      recentClicks: [],
      visibleRegions: [],
      consoleErrors: [],
      viewport: { w: 0, h: 0, scrollY: 0 },
    };
  }
  const now = Date.now();
  trimRecentClicks();
  trimConsoleErrors();
  return {
    cursorTarget: cursorEl ? summarize(cursorEl) : null,
    textSelection: window.getSelection()?.toString().trim().slice(0, 500) || null,
    recentClicks: recentClicks.map((r) => ({
      ...({ tag: r.tag, text: r.text, selector: r.selector, ariaLabel: r.ariaLabel, role: r.role, rect: r.rect }),
      at: now - r.absAt, // ms ago, positive
    })),
    visibleRegions: [...new Set(visibleRegions.values())],
    consoleErrors: consoleErrors.map((e) => ({ at: now - e.absAt, message: e.message })),
    viewport: { w: window.innerWidth, h: window.innerHeight, scrollY: window.scrollY },
  };
}

// --- Helpers ---------------------------------------------------------------

/** Public alias of the internal summarizer — used by the "Point at it" overlay. */
export function summarizeForPointer(el: Element): ElementSummary {
  return summarize(el);
}

function summarize(el: Element): ElementSummary {
  const rect = el.getBoundingClientRect();
  const text = (el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 120);
  const ariaLabel = el.getAttribute("aria-label");
  const role = el.getAttribute("role");
  return {
    tag: el.tagName,
    text,
    selector: getSelector(el),
    ariaLabel,
    role,
    rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
  };
}

/**
 * Build a short stable-ish CSS-ish path to the element, capped at 5 levels.
 * Prefers #id where present; otherwise tag + nth-of-type. Tailwind utility
 * classes are skipped (too noisy and not stable enough to match in code anyway
 * — text content is the more useful matcher).
 */
function getSelector(el: Element): string {
  const parts: string[] = [];
  let cur: Element | null = el;
  let depth = 0;
  while (cur && cur !== document.body && cur.nodeType === 1 && depth < 5) {
    if (cur.id) {
      parts.unshift(`#${cur.id}`);
      break;
    }
    let part = cur.tagName.toLowerCase();
    const parent = cur.parentElement;
    if (parent) {
      const sameTag = [...parent.children].filter((c) => c.tagName === cur!.tagName);
      if (sameTag.length > 1) part += `:nth-of-type(${sameTag.indexOf(cur) + 1})`;
    }
    parts.unshift(part);
    cur = cur.parentElement;
    depth++;
  }
  return parts.join(" > ");
}

function serializeArgs(args: unknown[]): string {
  return args
    .map((a) => {
      if (a instanceof Error) return `${a.name}: ${a.message}`;
      if (typeof a === "string") return a;
      try {
        return JSON.stringify(a);
      } catch {
        return String(a);
      }
    })
    .join(" ")
    .slice(0, 500);
}

function trimRecentClicks(): void {
  const cutoff = Date.now() - RECENT_CLICK_WINDOW_MS;
  while (recentClicks.length > 0 && recentClicks[0].absAt < cutoff) recentClicks.shift();
  while (recentClicks.length > MAX_RECENT_CLICKS) recentClicks.shift();
}
function trimConsoleErrors(): void {
  const cutoff = Date.now() - CONSOLE_ERROR_WINDOW_MS;
  while (consoleErrors.length > 0 && consoleErrors[0].absAt < cutoff) consoleErrors.shift();
  while (consoleErrors.length > MAX_CONSOLE_ERRORS) consoleErrors.shift();
}
