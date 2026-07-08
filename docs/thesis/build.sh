#!/usr/bin/env bash
# Budowanie pracy magisterskiej UniVerify (EE-dyplom, XeLaTeX).
# Uruchom:  bash docs/thesis/build.sh
# Doinstaluje brakujące pakiety TeX Live (wymaga sudo), potem kompiluje main.tex.
set -e

DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

# 1) Zależności — instaluj tylko, gdy czegoś brak
need_install=0
for cmd in xelatex biber latexmk; do
  command -v "$cmd" >/dev/null 2>&1 || need_install=1
done
kpsewhich biblatex.sty >/dev/null 2>&1 || need_install=1

if [ "$need_install" = "1" ]; then
  echo ":: Instaluję brakujące pakiety TeX Live (poda hasło sudo)..."
  sudo apt-get update
  sudo apt-get install -y texlive-xetex texlive-bibtex-extra \
    texlive-lang-polish texlive-fonts-extra biber latexmk
else
  echo ":: Wszystkie zależności obecne — pomijam instalację."
fi

# 2) Kompilacja (XeLaTeX + biber, właściwa liczba przebiegów)
echo ":: Kompiluję main.tex ..."
latexmk -xelatex -interaction=nonstopmode main.tex

echo ":: Gotowe → $DIR/main.pdf"
