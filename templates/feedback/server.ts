/**
 * Server-side POST handler factory for the feedback widget.
 *
 * Designed for portability: each consumer project supplies its own `sql`
 * tagged-template client and its own `requireAuth()` resolver. The module
 * never imports project-specific code, so the same file works in any
 * Next.js + Postgres + session-auth app.
 *
 * Wire it up from `app/api/feedback/route.ts`:
 *
 *   import { sql } from "@/lib/db";
 *   import { requireAuth } from "@/lib/auth/guard";
 *   import { createFeedbackPOST } from "@/feedback/server";
 *
 *   export const POST = createFeedbackPOST({
 *     sql,
 *     requireAuth,
 *     project: "my-app",
 *   });
 */

import { z } from "zod";
import type { FeedbackSeverity } from "./types";

const rectSchema = z.object({
  x: z.number(),
  y: z.number(),
  w: z.number(),
  h: z.number(),
});
const elementSummarySchema = z.object({
  tag: z.string(),
  text: z.string(),
  selector: z.string(),
  ariaLabel: z.string().nullable().optional(),
  role: z.string().nullable().optional(),
  rect: rectSchema,
});
const focusSchema = z.object({
  cursorTarget: elementSummarySchema.nullable().optional(),
  textSelection: z.string().nullable().optional(),
  recentClicks: z.array(elementSummarySchema.extend({ at: z.number() })).optional(),
  visibleRegions: z.array(z.string()).optional(),
  consoleErrors: z.array(z.object({ at: z.number(), message: z.string() })).optional(),
  viewport: z.object({ w: z.number(), h: z.number(), scrollY: z.number() }).optional(),
});
const submissionSchema = z.object({
  comment: z.string().trim().min(1).max(4000),
  severity: z.enum(["nice", "bug", "blocker"]).default("nice"),
  pagePath: z.string().min(1).max(500),
  pageQuery: z.string().max(2000).optional(),
  pageContext: z.record(z.string(), z.unknown()).optional(),
  focus: focusSchema.optional(),
  pointers: z.array(elementSummarySchema).max(20).optional(),
});

export interface AuthResult {
  error: Response | null;
  userId: string | null;
  email: string | null;
}

export interface FeedbackHandlerOptions {
  /** Neon-style tagged-template SQL client (or any compatible). */
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown[]>;
  /** Returns auth context; project-provided. */
  requireAuth: () => Promise<AuthResult>;
  /** Identifier for the project, persisted on each row. */
  project: string;
}

export function createFeedbackPOST(opts: FeedbackHandlerOptions) {
  return async function POST(req: Request): Promise<Response> {
    const auth = await opts.requireAuth();
    if (auth.error) return auth.error;

    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      return Response.json({ error: "Invalid JSON" }, { status: 400 });
    }
    const parsed = submissionSchema.safeParse(raw);
    if (!parsed.success) {
      return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid submission" }, { status: 400 });
    }
    const s = parsed.data;

    const severity: FeedbackSeverity = s.severity;
    const pageContext = s.pageContext ?? {};
    const pageQuery = s.pageQuery ?? null;
    const focus = s.focus ?? {};
    const pointers = s.pointers ?? [];

    const rows = (await opts.sql`
      INSERT INTO feedback
        (submitter_email, submitter_sub, project, page_path, page_query, page_context,
         comment, severity, focus, pointers)
      VALUES
        (${auth.email}, ${auth.userId}, ${opts.project}, ${s.pagePath}, ${pageQuery},
         ${JSON.stringify(pageContext)}::jsonb, ${s.comment}, ${severity},
         ${JSON.stringify(focus)}::jsonb, ${JSON.stringify(pointers)}::jsonb)
      RETURNING id, created_at
    `) as Array<{ id: number; created_at: string }>;

    return Response.json({ id: rows[0]?.id, createdAt: rows[0]?.created_at }, { status: 201 });
  };
}
