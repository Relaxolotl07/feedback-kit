"use client";

/**
 * Floating "Feedback" pill + submission modal. Mount once at the app root —
 * appears on every page (and pages can register structured context via
 * `useFeedbackContext()` from "./client").
 *
 * Self-contained UI: uses Radix Dialog + Tailwind only, so this whole module
 * is portable across projects with no dependency on the host app's component
 * library.
 */

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import * as Dialog from "@radix-ui/react-dialog";
import { MessageSquare, X } from "lucide-react";

import { readFeedbackContext, submitFeedback } from "./client";
import type { FeedbackSeverity } from "./types";

const SEVERITY_LABELS: Record<FeedbackSeverity, string> = {
  nice: "Nice-to-have",
  bug: "Bug",
  blocker: "Blocker",
};

type SubmitState = { kind: "idle" } | { kind: "saving" } | { kind: "ok"; id: number } | { kind: "err"; msg: string };

export function FeedbackButton() {
  const pathname = usePathname() ?? "";

  // Hide on /auth/* — those pages are pre-session.
  if (pathname.startsWith("/auth")) return null;

  // Read the query string at click-time (inside FeedbackForm) instead of via
  // `useSearchParams()`. The hook requires a Suspense boundary for static
  // prerender (Next 16's /_not-found page in particular), which would make the
  // module less drop-in. `window.location.search` inside an effect is fine.

  return (
    <Dialog.Root>
      <Dialog.Trigger asChild>
        <button
          className="fixed bottom-4 right-4 z-40 inline-flex items-center gap-1.5 rounded-full bg-text-primary px-3 py-2 text-xs font-medium text-surface shadow-lg hover:bg-text-primary/90 transition-colors"
          aria-label="Send feedback"
        >
          <MessageSquare className="size-3.5" />
          Feedback
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[92vw] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg border border-line bg-surface p-5 shadow-2xl focus:outline-none">
          <FeedbackForm pagePath={pathname} />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function FeedbackForm({ pagePath }: { pagePath: string }) {
  const [comment, setComment] = useState("");
  const [severity, setSeverity] = useState<FeedbackSeverity>("nice");
  const [state, setState] = useState<SubmitState>({ kind: "idle" });

  // Snapshot path-side data once at modal mount — gives a stable payload even
  // if the user starts navigating in the background. window.location is read in
  // a lazy state initializer rather than via useSearchParams() so the module
  // doesn't require a Suspense boundary in the host shell.
  const [pageQuery] = useState(() =>
    typeof window !== "undefined" ? window.location.search : "",
  );
  const [pageContext] = useState(() => readFeedbackContext() ?? {});
  const contextKeys = Object.keys(pageContext);

  // Auto-focus the textarea when the modal opens.
  useEffect(() => {
    const id = setTimeout(() => document.getElementById("feedback-comment")?.focus(), 50);
    return () => clearTimeout(id);
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!comment.trim()) return;
    setState({ kind: "saving" });
    try {
      await submitFeedback({
        comment: comment.trim(),
        severity,
        pagePath,
        pageQuery: pageQuery || undefined,
        pageContext: contextKeys.length > 0 ? pageContext : undefined,
      });
      // (Optimistic ID — the real id is returned but we don't surface it here.)
      setState({ kind: "ok", id: 0 });
    } catch (err) {
      setState({ kind: "err", msg: err instanceof Error ? err.message : "Submit failed" });
    }
  }

  if (state.kind === "ok") {
    return (
      <div className="flex flex-col items-start gap-3">
        <Dialog.Title className="text-base font-semibold text-text-primary">Thanks — logged.</Dialog.Title>
        <p className="text-sm text-text-muted">
          A dev will pick it up in the next review pass. You can keep working.
        </p>
        <Dialog.Close asChild>
          <button className="mt-1 rounded-md border border-line bg-surface px-3 py-1.5 text-xs font-medium text-text-primary hover:bg-surface-card-hover transition-colors">
            Close
          </button>
        </Dialog.Close>
      </div>
    );
  }

  const disabled = state.kind === "saving" || !comment.trim();

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <div className="flex items-start justify-between">
        <div>
          <Dialog.Title className="text-base font-semibold text-text-primary">Send feedback</Dialog.Title>
          <Dialog.Description className="text-xs text-text-muted mt-0.5">
            Tell us what looks off and what should change.
          </Dialog.Description>
        </div>
        <Dialog.Close className="text-text-muted hover:text-text-primary" aria-label="Close">
          <X className="size-4" />
        </Dialog.Close>
      </div>

      <fieldset className="flex gap-1.5">
        {(Object.keys(SEVERITY_LABELS) as FeedbackSeverity[]).map((sev) => (
          <label
            key={sev}
            className={`flex-1 cursor-pointer rounded-md border px-2.5 py-1.5 text-center text-xs font-medium transition-colors ${
              severity === sev
                ? "border-text-primary bg-text-primary text-surface"
                : "border-line bg-surface text-text-muted hover:text-text-primary"
            }`}
          >
            <input
              type="radio"
              name="severity"
              value={sev}
              checked={severity === sev}
              onChange={() => setSeverity(sev)}
              className="sr-only"
            />
            {SEVERITY_LABELS[sev]}
          </label>
        ))}
      </fieldset>

      <textarea
        id="feedback-comment"
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        placeholder="Example: BN-short on the actual book shows phantom weight before September — looks like backfill"
        rows={5}
        maxLength={4000}
        className="w-full resize-none rounded-md border border-line bg-surface px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-text-primary focus:outline-none"
      />

      <div className="text-[11px] text-text-muted">
        <div className="font-mono">
          <span className="text-text-primary">{pagePath}</span>
          {pageQuery && <span>{pageQuery}</span>}
        </div>
        {contextKeys.length > 0 && (
          <details className="mt-1">
            <summary className="cursor-pointer hover:text-text-primary">
              Page context ({contextKeys.length} field{contextKeys.length === 1 ? "" : "s"})
            </summary>
            <pre className="mt-1 max-h-32 overflow-auto rounded bg-surface-card-hover p-2 font-mono text-[10px]">
              {JSON.stringify(pageContext, null, 2)}
            </pre>
          </details>
        )}
      </div>

      {state.kind === "err" && <p className="text-xs text-destructive">{state.msg}</p>}

      <div className="flex justify-end gap-2">
        <Dialog.Close asChild>
          <button
            type="button"
            className="rounded-md border border-line bg-surface px-3 py-1.5 text-xs font-medium text-text-primary hover:bg-surface-card-hover transition-colors"
          >
            Cancel
          </button>
        </Dialog.Close>
        <button
          type="submit"
          disabled={disabled}
          className="rounded-md bg-text-primary px-3 py-1.5 text-xs font-medium text-surface hover:bg-text-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {state.kind === "saving" ? "Sending…" : "Send"}
        </button>
      </div>
    </form>
  );
}
