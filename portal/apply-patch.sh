#!/usr/bin/env bash
# Pobiera kod portalu dane.gov.pl i nakłada na niego zmianę „wykazy zbiorcze”:
# backend (wersja 2.62.3) do portal/mcod-backend i stronę portalu (frontend, wersja 3.5.2) do portal/mcod-frontend.
#
#   portal/apply-patch.sh [katalog backendu] [katalog frontendu]
#
# Źródła można zmienić zmiennymi MCOD_REPO, MCOD_BRANCH, MCOD_FRONTEND_REPO i MCOD_FRONTEND_BRANCH
# (oficjalne repozytoria: gitlab.dane.gov.pl/mcod/backend i gitlab.dane.gov.pl/mcod/frontend).
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"

apply() { # apply <katalog> <repozytorium> <gałąź> <plik łatki>
  local target="$1" repo="$2" branch="$3" patch="$4"
  if [ ! -e "$target/.git" ]; then
    echo "Pobieram $repo ($branch) do $target"
    git clone --quiet --depth 1 --branch "$branch" "$repo" "$target"
  fi
  if git -C "$target" apply --reverse --check "$patch" 2>/dev/null; then
    echo "Zmiana jest już nałożona w $target"
    return
  fi
  git -C "$target" apply "$patch"
  echo "Nałożono zmianę w $target"
}

apply "${1:-$here/mcod-backend}" \
  "${MCOD_REPO:-https://github.com/olekstomek/mcod-backend-dane.gov.pl.git}" \
  "${MCOD_BRANCH:-backend_2.62.3}" "$here/mcod-backend.patch"

# Testy rdzenia (portal/run-tests.sh) potrzebują tylko backendu.
if [ -n "${MCOD_ONLY_BACKEND:-}" ]; then exit 0; fi

apply "${2:-$here/mcod-frontend}" \
  "${MCOD_FRONTEND_REPO:-https://github.com/olekstomek/mcod-frontend-dane.gov.pl.git}" \
  "${MCOD_FRONTEND_BRANCH:-frontend_3.5.2}" "$here/mcod-frontend.patch"
