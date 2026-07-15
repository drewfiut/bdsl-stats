#!/usr/bin/env bash
# Refresh BDSL data, commit, and push to main.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"

python3 update_data.py "$@"

git add data/

if git diff --cached --quiet; then
    echo "No data changes to commit."
    exit 0
fi

git commit -m "Refresh BDSL data"
git push origin main
