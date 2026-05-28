"use client";

/**
 * Client-only helpers for the feedback widget — page-context registration +
 * submit fetcher. No React imports needed by consumer pages; just call the
 * hook from any client component.
 */

import { useEffect } from "react";
import type { FeedbackPageContext, FeedbackSubmission } from "./types";

// Module-singleton — the current page's registered context. The button reads
// this at click-time, so pages only need to keep it fresh.
let currentContext: FeedbackPageContext | null = null;

export function readFeedbackContext(): FeedbackPageContext | null {
  return currentContext;
}

/**
 * Register the calling page's structured feedback context. Pass anything
 * JSON-serializable that helps locate the thing being commented on (date
 * window, selected tab, focused position, etc.). Pass `null` to clear.
 *
 *   useFeedbackContext({ from, to, book, ticker });
 *
 * Re-renders re-publish the latest value; unmount clears it.
 */
export function useFeedbackContext(ctx: FeedbackPageContext | null): void {
  currentContext = ctx;
  useEffect(
    () => () => {
      currentContext = null;
    },
    [],
  );
}

/**
 * Spread-helper for annotating an element with per-element feedback context
 * (SPEC §4.7). Each key becomes a `data-feedback-<kebab-key>` attribute on
 * the rendered element. Null/undefined values are dropped, so optional
 * fields stay clean. The widget walks the clicked element + 5 ancestors at
 * pin time and harvests every `data-feedback-*` attr into
 * `ElementSummary.data` — so the reviewer sees the entity context without
 * reverse-engineering selectors.
 *
 *   <tr {...feedbackData({ entityId: 42, ticker: "AAPL", momentumScore: 73 })}>
 *
 * Closer-to-the-target attrs win, so a row-level annotation is the right
 * default and per-cell overrides work when needed.
 */
export function feedbackData(
  ctx: Record<string, string | number | boolean | null | undefined>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(ctx)) {
    if (v === null || v === undefined) continue;
    const kebab = k.replace(/[A-Z]/g, (m) => "-" + m.toLowerCase());
    out[`data-feedback-${kebab}`] = String(v);
  }
  return out;
}

/** Submit feedback. Throws on non-2xx. */
export async function submitFeedback(s: FeedbackSubmission): Promise<void> {
  const res = await fetch("/api/feedback", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(s),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `Feedback submit failed (${res.status})`);
  }
}
