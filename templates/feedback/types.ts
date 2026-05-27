/**
 * Shared types for the feedback widget.
 *
 * The widget keeps its dependency surface intentionally small: this file has
 * no React, no Next, no DB imports — safe to import from both client and
 * server code in any consumer project.
 */

export type FeedbackSeverity = "nice" | "bug" | "blocker";
export type FeedbackStatus = "open" | "triaged" | "fixed" | "wontfix";

/** What the page registered via setFeedbackContext / useFeedbackContext. */
export type FeedbackPageContext = Record<string, unknown>;

/** Wire format: client → /api/feedback. */
export interface FeedbackSubmission {
  comment: string;
  severity: FeedbackSeverity;
  pagePath: string;
  pageQuery?: string;
  pageContext?: FeedbackPageContext;
}

/** A persisted row, shape returned to the admin dashboard. */
export interface FeedbackRow {
  id: number;
  createdAt: string;
  submitterEmail: string;
  submitterSub: string | null;
  project: string;
  pagePath: string;
  pageQuery: string | null;
  pageContext: FeedbackPageContext;
  comment: string;
  severity: FeedbackSeverity;
  status: FeedbackStatus;
  resolvedAt: string | null;
  resolvedBy: string | null;
  resolutionNote: string | null;
}
