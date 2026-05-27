# Feedback Kit

## Add it

```bash
git clone https://github.com/Relaxolotl07/feedback-kit && feedback-kit/install.sh --global
```
```powershell
git clone https://github.com/Relaxolotl07/feedback-kit; .\feedback-kit\install.ps1 -Global
```

Then in any Next.js + Postgres + session-auth project:

```
/feedback-widget
```

The skill audits the repo, copies the module, wires the API route to your real
`sql` + auth helpers, mounts the button, and applies the dev DDL — interactively.

## What you get

A floating **Feedback** pill on every authed page → modal with severity, textarea,
and auto-captured path + page-registered JSON context → one row in a `feedback`
table in your project's Postgres. Built for vibe-coded side projects where a
non-engineer should be able to flag issues without GitHub-Issue friction.

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
