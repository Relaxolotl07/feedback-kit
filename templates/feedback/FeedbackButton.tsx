"use client";

/**
 * Floating "Feedback" pill + submission modal. Mount once at the app root —
 * appears on every page (and pages can register structured context via
 * `useFeedbackContext()` from "./client").
 *
 * Self-contained UI: uses Radix Dialog + Tailwind only, so this whole module
 * is portable across projects with no dependency on the host app's component
 * library.
 *
 * Two context-capture layers in addition to the free-text comment:
 *  - Passive: focus.ts auto-collects cursor target, recent clicks, text
 *    selection, visible <FeedbackRegion>s, and console errors. Snapshot
 *    happens when the modal opens. The user does nothing.
 *  - Explicit: "Point at it" mode lets the user click any element on the
 *    page to pin it; pinned elements show as chips in the modal and stack.
 */

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import * as Dialog from "@radix-ui/react-dialog";
import { MessageSquare, MousePointerClick, X } from "lucide-react";

import { readFeedbackContext, submitFeedback } from "./client";
import {
  setupFocusTracking,
  snapshotFocus,
  summarizeForPointer,
  type ElementSummary,
  type FocusSnapshot,
} from "./focus";
import type { FeedbackSeverity } from "./types";

const SEVERITY_LABELS: Record<FeedbackSeverity, string> = {
  nice: "Nice-to-have",
  bug: "Bug",
  blocker: "Blocker",
};

type SubmitState = { kind: "idle" } | { kind: "saving" } | { kind: "ok" } | { kind: "err"; msg: string };

export function FeedbackButton() {
  const pathname = usePathname() ?? "";
  const [open, setOpen] = useState(false);
  const [pointerMode, setPointerMode] = useState(false);
  const [pinned, setPinned] = useState<ElementSummary[]>([]);

  // Bring up the passive trackers once the button mounts (which is at app-shell
  // level, so effectively at first paint). Idempotent, safe under StrictMode.
  useEffect(() => {
    setupFocusTracking();
  }, []);

  // Reset pinned state once the dialog fully closes — so a re-open starts clean.
  useEffect(() => {
    if (!open && !pointerMode) setPinned([]);
  }, [open, pointerMode]);

  // Hide on /auth/* — those pages are pre-session.
  if (pathname.startsWith("/auth")) return null;

  return (
    <>
      {!pointerMode && (
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-4 right-4 z-40 inline-flex items-center gap-1.5 rounded-full bg-text-primary px-3 py-2 text-xs font-medium text-surface shadow-lg hover:bg-text-primary/90 transition-colors"
          aria-label="Send feedback"
        >
          <MessageSquare className="size-3.5" />
          Feedback
        </button>
      )}

      <Dialog.Root open={open && !pointerMode} onOpenChange={setOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm data-[state=open]:animate-in data-[state=open]:fade-in-0" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[92vw] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg border border-line bg-surface p-5 shadow-2xl focus:outline-none max-h-[85vh] overflow-y-auto">
            <FeedbackForm
              pagePath={pathname}
              pinned={pinned}
              setPinned={setPinned}
              onStartPointer={() => setPointerMode(true)}
              onDone={() => setOpen(false)}
            />
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {pointerMode && (
        <PointerOverlay
          onPin={(el) => {
            setPinned((p) => [...p, el]);
            setPointerMode(false);
          }}
          onCancel={() => setPointerMode(false)}
        />
      )}
    </>
  );
}

// --- Submission form -------------------------------------------------------

function FeedbackForm({
  pagePath,
  pinned,
  setPinned,
  onStartPointer,
  onDone,
}: {
  pagePath: string;
  pinned: ElementSummary[];
  setPinned: React.Dispatch<React.SetStateAction<ElementSummary[]>>;
  onStartPointer: () => void;
  onDone: () => void;
}) {
  const [comment, setComment] = useState("");
  const [severity, setSeverity] = useState<FeedbackSeverity>("nice");
  const [state, setState] = useState<SubmitState>({ kind: "idle" });

  // Snapshot path-side data once at modal mount. window.location is read in a
  // lazy state initializer rather than via useSearchParams() so the module
  // doesn't require a Suspense boundary in the host shell.
  const [pageQuery] = useState(() =>
    typeof window !== "undefined" ? window.location.search : "",
  );
  const [pageContext] = useState(() => readFeedbackContext() ?? {});
  const [focus] = useState<FocusSnapshot>(() => snapshotFocus());
  const contextKeys = Object.keys(pageContext);

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
        focus,
        pointers: pinned.length > 0 ? pinned : undefined,
      });
      setState({ kind: "ok" });
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
          <button
            onClick={onDone}
            className="mt-1 rounded-md border border-line bg-surface px-3 py-1.5 text-xs font-medium text-text-primary hover:bg-surface-card-hover transition-colors"
          >
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

      <PointerSection pinned={pinned} setPinned={setPinned} onStartPointer={onStartPointer} />

      <CapturedContextDisclosure
        pagePath={pagePath}
        pageQuery={pageQuery}
        pageContext={pageContext}
        focus={focus}
      />

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

// --- Pointer chips + "Point at it" button ----------------------------------

function PointerSection({
  pinned,
  setPinned,
  onStartPointer,
}: {
  pinned: ElementSummary[];
  setPinned: React.Dispatch<React.SetStateAction<ElementSummary[]>>;
  onStartPointer: () => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      {pinned.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {pinned.map((p, i) => (
            <span
              key={i}
              className="inline-flex items-center gap-1 rounded-md border border-line bg-surface-card-hover px-2 py-1 text-[11px] font-mono text-text-primary"
              title={p.selector}
            >
              <span className="text-text-muted">#{i + 1}</span>
              <span className="text-text-muted">&lt;{p.tag.toLowerCase()}&gt;</span>
              {p.text && <span className="max-w-[120px] truncate">{p.text}</span>}
              <button
                type="button"
                onClick={() => setPinned((all) => all.filter((_, j) => j !== i))}
                className="text-text-muted hover:text-text-primary"
                aria-label={`Remove pin ${i + 1}`}
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      <button
        type="button"
        onClick={onStartPointer}
        className="inline-flex items-center gap-1.5 self-start rounded-md border border-dashed border-line px-2 py-1 text-[11px] font-medium text-text-muted hover:text-text-primary hover:border-text-muted transition-colors"
      >
        <MousePointerClick className="size-3.5" />
        {pinned.length === 0 ? "Point at it" : "Point at another"}
      </button>
    </div>
  );
}

// --- "What's being sent" disclosure ----------------------------------------

function CapturedContextDisclosure({
  pagePath,
  pageQuery,
  pageContext,
  focus,
}: {
  pagePath: string;
  pageQuery: string;
  pageContext: Record<string, unknown>;
  focus: FocusSnapshot;
}) {
  const contextKeys = Object.keys(pageContext);
  const hasAnyFocus =
    !!focus.cursorTarget ||
    !!focus.textSelection ||
    (focus.recentClicks?.length ?? 0) > 0 ||
    (focus.visibleRegions?.length ?? 0) > 0 ||
    (focus.consoleErrors?.length ?? 0) > 0;
  return (
    <div className="text-[11px] text-text-muted">
      <div className="font-mono">
        <span className="text-text-primary">{pagePath}</span>
        {pageQuery && <span>{pageQuery}</span>}
      </div>
      {(contextKeys.length > 0 || hasAnyFocus) && (
        <details className="mt-1">
          <summary className="cursor-pointer hover:text-text-primary">
            Captured context (auto)
          </summary>
          <div className="mt-1 space-y-1 pl-3 text-[11px]">
            {focus.cursorTarget && (
              <Line label="Hovered">
                <code>&lt;{focus.cursorTarget.tag.toLowerCase()}&gt;</code>{" "}
                {focus.cursorTarget.text && <span>&quot;{focus.cursorTarget.text}&quot;</span>}
              </Line>
            )}
            {focus.textSelection && (
              <Line label="Selection">&quot;{focus.textSelection.slice(0, 120)}&quot;</Line>
            )}
            {focus.visibleRegions && focus.visibleRegions.length > 0 && (
              <Line label="Sections">
                <code>{focus.visibleRegions.join(", ")}</code>
              </Line>
            )}
            {focus.recentClicks && focus.recentClicks.length > 0 && (
              <Line label="Recent clicks">
                <span>
                  {focus.recentClicks
                    .slice(-3)
                    .map((c) => `<${c.tag.toLowerCase()}>${c.text ? ` "${c.text.slice(0, 24)}"` : ""}`)
                    .join(" → ")}
                </span>
              </Line>
            )}
            {focus.consoleErrors && focus.consoleErrors.length > 0 && (
              <Line label="Console">
                <span className="text-destructive">
                  {focus.consoleErrors.length} error{focus.consoleErrors.length === 1 ? "" : "s"}
                </span>
              </Line>
            )}
            {contextKeys.length > 0 && (
              <pre className="mt-1 max-h-32 overflow-auto rounded bg-surface-card-hover p-2 font-mono text-[10px]">
                {JSON.stringify(pageContext, null, 2)}
              </pre>
            )}
          </div>
        </details>
      )}
    </div>
  );
}

function Line({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-1.5">
      <span className="shrink-0 text-text-muted">{label}:</span>
      <span className="min-w-0 break-words text-text-primary">{children}</span>
    </div>
  );
}

// --- Pointer mode overlay --------------------------------------------------

function PointerOverlay({ onPin, onCancel }: { onPin: (el: ElementSummary) => void; onCancel: () => void }) {
  const [hoverRect, setHoverRect] = useState<DOMRect | null>(null);

  useEffect(() => {
    let lastEl: Element | null = null;
    function onMove(e: MouseEvent) {
      const el = document.elementFromPoint(e.clientX, e.clientY);
      if (!el || el === lastEl) return;
      lastEl = el;
      setHoverRect(el.getBoundingClientRect());
    }
    function onClick(e: MouseEvent) {
      e.preventDefault();
      e.stopPropagation();
      const el = document.elementFromPoint(e.clientX, e.clientY);
      if (el) onPin(summarizeForPointer(el));
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    document.addEventListener("mousemove", onMove, { passive: true });
    document.addEventListener("click", onClick, { capture: true });
    document.addEventListener("keydown", onKey);
    const prevCursor = document.body.style.cursor;
    document.body.style.cursor = "crosshair";
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("click", onClick, { capture: true });
      document.removeEventListener("keydown", onKey);
      document.body.style.cursor = prevCursor;
    };
  }, [onPin, onCancel]);

  return (
    <>
      {hoverRect && (
        <div
          className="pointer-events-none fixed z-[60] rounded-sm border-2 border-blue-500 bg-blue-500/10 transition-[transform,width,height] duration-75"
          style={{
            transform: `translate(${hoverRect.x}px, ${hoverRect.y}px)`,
            width: hoverRect.width,
            height: hoverRect.height,
            top: 0,
            left: 0,
          }}
        />
      )}
      <div className="pointer-events-none fixed left-1/2 top-4 z-[61] -translate-x-1/2 rounded-full bg-text-primary px-3 py-1.5 text-xs font-medium text-surface shadow-lg">
        Click any element to pin it · press Esc to cancel
      </div>
    </>
  );
}
