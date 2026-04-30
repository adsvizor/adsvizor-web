# push.ps1 — Helper script to commit and push without git lock conflicts
# Usage: .\push.ps1 "your commit message"

param(
    [Parameter(Mandatory=$true)]
    [string]$Message
)

$gitDir = Join-Path $PSScriptRoot ".git"

# Remove stale lock files
Remove-Item "$gitDir\HEAD.lock"  -Force -ErrorAction SilentlyContinue
Remove-Item "$gitDir\index.lock" -Force -ErrorAction SilentlyContinue

git add -A
git commit -m $Message
git push
