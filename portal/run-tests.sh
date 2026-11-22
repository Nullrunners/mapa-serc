#!/usr/bin/env bash
# Uruchamia testy rdzenia wykazów zbiorczych na kodzie portalu z nałożoną zmianą.
#
#   portal/run-tests.sh [katalog]      domyślnie portal/mcod-backend (pobierany i łatany, jeśli go nie ma)
#
# Testy potrzebują tylko Pythona 3.8+ z pakietami pandas, openpyxl, pytest i django (bez bazy danych,
# Elasticsearcha i reszty portalu). Bez takiego Pythona skrypt używa Nixa, jeśli jest zainstalowany.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
target="${1:-$here/mcod-backend}"
MCOD_ONLY_BACKEND=1 "$here/apply-patch.sh" "$target" >/dev/null

cd "$target"
tests=(mcod/resources/tests/test_aggregated_lists_core.py)
# The portal's pytest.ini adds options that need its whole test stack; the core tests need none of them.
args=(-m pytest -o addopts= --noconftest -p no:cacheprovider -q "${tests[@]}")

if command -v python3 >/dev/null && python3 -c 'import pandas, openpyxl, pytest, django' 2>/dev/null; then
  exec python3 "${args[@]}"
elif command -v nix >/dev/null; then
  exec nix shell --impure --expr \
    'let p = (builtins.getFlake "nixpkgs").legacyPackages.${builtins.currentSystem}; in p.python3.withPackages (ps: [ps.pandas ps.openpyxl ps.pytest ps.django])' \
    -c python "${args[@]}"
else
  echo "Potrzebny Python 3 z pakietami: pandas openpyxl pytest django (np. pip install pandas openpyxl pytest django)." >&2
  exit 1
fi
