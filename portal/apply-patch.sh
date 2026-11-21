#!/usr/bin/env bash
# Pobiera kod portalu dane.gov.pl (backend, wersja 2.62.3) i nakłada na niego zmianę „wykazy zbiorcze”.
#
#   portal/apply-patch.sh [katalog]      domyślnie portal/mcod-backend
#
# Źródło można zmienić zmiennymi MCOD_REPO i MCOD_BRANCH (oficjalne repozytorium: gitlab.dane.gov.pl/mcod/backend).
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
target="${1:-$here/mcod-backend}"
repo="${MCOD_REPO:-https://github.com/olekstomek/mcod-backend-dane.gov.pl.git}"
branch="${MCOD_BRANCH:-backend_2.62.3}"

if [ ! -e "$target/.git" ]; then
  echo "Pobieram $repo ($branch) do $target"
  git clone --quiet --depth 1 --branch "$branch" "$repo" "$target"
fi

cd "$target"
if git apply --reverse --check "$here/mcod-backend.patch" 2>/dev/null; then
  echo "Zmiana jest już nałożona w $target"
  exit 0
fi
git apply "$here/mcod-backend.patch"
echo "Nałożono zmianę w $target"
