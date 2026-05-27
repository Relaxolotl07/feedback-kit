# Feedback Kit

## Add it

```bash
git clone https://github.com/Relaxolotl07/feedback-kit && feedback-kit/install.sh --global
```
```powershell
git clone https://github.com/Relaxolotl07/feedback-kit; .\feedback-kit\install.ps1 -Global
```

Two skills land in `~/.claude/skills/`:

- **`/feedback-widget`** — install the widget into the project you're in.
  Audits the repo, copies the module, wires the API route to your real
  `sql` + auth helpers, mounts the button, and applies the dev DDL.
- **`/feedback`** — walk the open feedback queue. For each row, locate the
  code from the captured pointer / cursor / region context, propose a fix,
  apply it, commit, and mark the row resolved with the commit SHA.

## What you get

A floating **Feedback** pill on every authed page → modal with severity, textarea,
and auto-captured path + page-registered JSON context → one row in a `feedback`
table in your project's Postgres. Built for vibe-coded side projects where a
non-engineer should be able to flag issues without GitHub-Issue friction.

**Different stack?** The widget's design is portable. The
[`SPEC.md`](SPEC.md) at the root of this repo describes the data model, wire
format, client behavior, and triage flow in architecture-agnostic terms — with
sketches for FastAPI, Django, and Rails in §9. The `/feedback-widget` skill
follows the port path automatically when it finds a non-Next.js project.

## Without Claude Code

```powershell
.\feedback-kit\install.ps1 -Target C:\path\to\your\repo   # or --target on bash
```

Copies `templates/feedback/` to `<repo>/src/feedback/`. Then follow the three
wiring steps in [templates/feedback/README.md](templates/feedback/README.md).

## Safety

Module is project-agnostic; nothing here writes to other repos unless you point
`-Target` at one. The skill never runs production DDL without confirmation in
chat. `install.* --global` only adds files under `~/.claude/skills/`.
