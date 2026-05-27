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
