/**
 * Server-side POST handler factory for the feedback widget.
 *
 * Designed for portability: each consumer project supplies its own `sql`
 * tagged-template client and its own `requireAuth()` resolver. The module
 * never imports project-specific code, so the same file works in militiahub,
 * militia-capital-hub, forensic-earnings, etc.
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
 *     project: "militiahub",
 *   });
 */

import { z } from "zod";
import type { FeedbackSeverity } from "./types";

const submissionSchema = z.object({
  comment: z.string().trim().min(1).max(4000),
  severity: z.enum(["nice", "bug", "blocker"]).default("nice"),
  pagePath: z.string().min(1).max(500),
  pageQuery: z.string().max(2000).optional(),
  pageContext: z.record(z.string(), z.unknown()).optional(),
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

    const rows = (await opts.sql`
      INSERT INTO feedback
        (submitter_email, submitter_sub, project, page_path, page_query, page_context, comment, severity)
      VALUES
        (${auth.email}, ${auth.userId}, ${opts.project}, ${s.pagePath}, ${pageQuery},
         ${JSON.stringify(pageContext)}::jsonb, ${s.comment}, ${severity})
      RETURNING id, created_at
    `) as Array<{ id: number; created_at: string }>;

    return Response.json({ id: rows[0]?.id, createdAt: rows[0]?.created_at }, { status: 201 });
  };
}
