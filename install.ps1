<#
.SYNOPSIS
  Install the feedback widget kit. Two independent, additive modes — safe by default.

.EXAMPLE
  ./install.ps1 -Global
      Copies the inert /feedback-widget skill into ~/.claude/skills/.
      Does nothing until the skill is invoked.

.EXAMPLE
  ./install.ps1 -Target "C:\path\to\target-repo"
      Adds templates/feedback/ into the target repo's src/feedback/. Skips files
      that already exist (use -Force to overwrite). Doesn't wire the API route
      or layout — that's the skill's job; run /feedback-widget afterwards.
#>
param(
  [switch]$Global,
  [string]$Target,
  [switch]$Force
)
$ErrorActionPreference = "Stop"
$kit = $PSScriptRoot

function Copy-IfAbsent($src, $dst) {
  if ((Test-Path $dst) -and -not $Force) { Write-Host "  skip (exists): $dst"; return }
  New-Item -ItemType Directory -Force -Path (Split-Path $dst) | Out-Null
  Copy-Item -Path $src -Destination $dst -Force
  Write-Host "  wrote: $dst"
}

if (-not $Global -and -not $Target) {
  Write-Host "Nothing to do. Use -Global and/or -Target <repo>. See: ./install.ps1 -?"
  exit 0
}

if ($Global) {
  $claude = Join-Path $HOME ".claude"
  Write-Host "Installing global (inert) skills into $claude ..."
  Get-ChildItem (Join-Path $kit "claude\skills") -Directory | ForEach-Object {
    $src = Join-Path $_.FullName "SKILL.md"
    if (Test-Path $src) {
      Copy-IfAbsent $src (Join-Path $claude "skills\$($_.Name)\SKILL.md")
    }
  }
  Write-Host "Done. /feedback-widget + /feedback are available across repos (inert until invoked)."
}

if ($Target) {
  if (-not (Test-Path $Target)) { throw "Target not found: $Target" }
  # Find the source root: prefer <target>/src/, fall back to <target>/.
  $srcRoot = if (Test-Path (Join-Path $Target "src")) { Join-Path $Target "src" } else { $Target }
  $dstFeedback = Join-Path $srcRoot "feedback"
  Write-Host "Copying feedback module into $dstFeedback ..."
  Get-ChildItem (Join-Path $kit "templates\feedback") -File | ForEach-Object {
    Copy-IfAbsent $_.FullName (Join-Path $dstFeedback $_.Name)
  }
  Write-Host "Done. Module copied. Next steps:"
  Write-Host "  1. Wire src/app/api/feedback/route.ts (use createFeedbackPOST from ./server)."
  Write-Host "  2. Mount <FeedbackButton/> in your root client shell."
  Write-Host "  3. Apply src/feedback/schema.sql to your dev + prod DBs."
  Write-Host "  TIP: with Claude Code installed (-Global), run /feedback-widget in the repo to do steps 1-3 from the actual code."
}