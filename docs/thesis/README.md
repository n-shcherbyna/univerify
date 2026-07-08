# Praca magisterska — UniVerify

Zbudowana na **oficjalnym szablonie Wydziału Elektrycznego PW — EE-dyplom**
(aut. Łukasz Makowski, licencja CC-BY 4.0,
<https://github.com/SP5LMA/EE-dyplom>), ten sam co Twoja praca inżynierska.

- Dokument główny: `main.tex` (klasa `EE-dyplom`, opcje `thesis=mgr, faculty=ee`).
- **Silnik: XeLaTeX** (+ biber). Na Overleaf: Menu → Compiler → **XeLaTeX**.
- `\frontpages` generuje automatycznie: stronę tytułową, streszczenie, abstract
  i oświadczenie — dane wypełniasz w preambule `main.tex` (nie ma osobnych plików
  strony tytułowej).

## Kompilacja

Najprościej — **Overleaf**: załaduj folder `docs/thesis`, ustaw kompilator na
XeLaTeX, ustaw `main.tex` jako dokument główny.

Lokalnie wymaga pełnego TeX Live (XeLaTeX + biblatex + biber):
```bash
cd docs/thesis
latexmk -xelatex main.tex      # albo: xelatex; biber main; xelatex; xelatex
```
> Uwaga: to środowisko dev ma niekompletny TeX Live (brak xelatex/biblatex/biber),
> więc lokalna kompilacja tutaj nie przejdzie — kompiluj na Overleaf.

## Układ plików

```
main.tex            dokument główny: konfiguracja (tytuł, promotor, streszczenia) + \input rozdziałów
EE-dyplom.cls       klasa szablonu Wydziału Elektrycznego PW
EE-dyplom.bib       bibliografia (biblatex + biber); nazwa wymagana przez klasę
gfx/                nagłówki/logo używane przez \frontpages (mgrhead, HeadEEPL, ...)
tekst/              rozdziały 01–08 + glossary.tex (wykaz skrótów)
dane/l2/            dane pomiarowe rozdz. 5 (CSV/DAT) — kopia z docs/l2-benchmarks/data,
                    aby folder thesis był samowystarczalny na Overleaf (\DataDir=dane/l2)
```

Pakiety do wykresów/tabel (`pgfplots`, `pgfplotstable`, `booktabs`, `float`) są
dołączane w~preambule `main.tex` (klasa EE-dyplom ich nie ładuje).

## Konfiguracja w `main.tex` (do potwierdzenia)

Uzupełnij/potwierdź pola oznaczone `% TODO`:
- `\instytut{...}` — instytut promotora,
- `\specjalnosc{...}` — specjalność dla studiów mgr,
- `\promotor{...}` — dokładny tytuł (obecnie: dr hab. inż. Bartosz Sawicki, prof. uczelni),
- `\longdate{...}` — data złożenia.

Wypełnione: `thesis=mgr`, `faculty=ee`, `\kierunek{Informatyka Stosowana}`,
`\album{323777}`, `\author{inż. Nazar Shcherbyna}`, tytuł PL/EN.

## Mapa rozdziałów: źródło → status

| Rozdział | Plik | Źródło materiału | Status |
|----------|------|------------------|:------:|
| 1. Wstęp | `tekst/01-wstep.tex` | do napisania | 🔴 pisać |
| 2. Podstawy | `tekst/02-podstawy.tex` | do napisania (jedyny teoretyczny) | 🔴 pisać |
| 3. Architektura | `tekst/03-architektura.tex` | `CLAUDE.md`, kod (kontrakt, pakiety, web) | 🟡 zebrać |
| 4. Koszt gazu (L1) | `tekst/04-koszt-gazu.tex` | `docs/univerify-gas-experiments.tex` (+ wchłonąć `experiments-sample.tex`) | 🟢 przenieść |
| 5. Benchmarki L2 | `tekst/05-benchmarki-l2.tex` | `docs/univerify-l2-benchmarks.tex` + `docs/l2-benchmarks/data/` | ✅ **napisane** |
| 6. Prywatność | `tekst/06-prywatnosc.tex` | spec `2026-04-18-thesis-privacy-l2-design.md` + `packages/verifier-core/src/privacy.ts` | 🔴 pisać |
| 7. Governance + wartość | `tekst/07-governance-wartosc.tex` | `docs/governance-threat-model.md` + kod `RegistryMultisig.sol` | 🔴 pisać |
| 8. Podsumowanie | `tekst/08-podsumowanie.tex` | synteza rozdz. 4–7 | 🟡 spiąć |

Legenda: 🟢 gotowy materiał do przeniesienia · 🟡 zebranie/synteza · 🔴 pisanie od zera.

## Konwencje

- Znaczniki `\TODO{...}` renderują się na czerwono w PDF — usuń przed oddaniem
  (`grep -rn 'TODO' tekst main.tex`). Makra `\TODO` i `\code` są zdefiniowane w `main.tex`.
- Rozdziały to zwykłe `\chapter`/`\section` — wchodzą przez `\input` w `main.tex`.
- Przy przenoszeniu gotowego materiału (rozdz. 4–5): skopiuj treść sekcji ze
  wskazanego pliku, usuń jego preambułę/`\documentclass`/`\title`, dopasuj poziomy nagłówków.
- Spec Fazy 1 (`2026-04-18-thesis-privacy-l2-design.md`) jest obecnie tylko
  w worktree `feat/l2-benchmarks` — przenieś go na `main`.
- Wykaz skrótów: dodawaj hasła w `tekst/glossary.tex`, używaj `\gls{...}` w tekście,
  odkomentuj `\acronymslist` w `main.tex`, gdy zechcesz wydrukować wykaz.
