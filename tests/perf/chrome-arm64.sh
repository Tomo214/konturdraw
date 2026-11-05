#!/bin/sh
# Node läuft hier als x86_64 → Playwright würde Chrome unter Rosetta starten (Zeiten 5–20× falsch). Erzwingt arm64.
exec arch -arm64 "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" "$@"
