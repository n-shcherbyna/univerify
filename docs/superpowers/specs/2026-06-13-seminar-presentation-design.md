# Spec: Prezentacja seminarium magisterskiego — UniVerify

**Data:** 2026-06-13  
**Format:** HTML/Reveal.js (single file)  
**Język:** Polski  
**Długość:** 9 slajdów, ~15–20 minut  
**Publiczność:** Informatycy (seminarium WUT)  
**Struktura:** „3 pytania badawcze"

---

## Plik wyjściowy

`docs/presentation/seminarium.html` — samodzielny plik HTML z wbudowanym Reveal.js (CDN), stylami i treścią.

---

## Motyw i styl

- Motyw Reveal.js: `black` (ciemne tło) — czytelne na projektorze
- Akcent kolorystyczny: niebieski (`#3b82f6`) dla wyróżnień i ikon
- Czcionka nagłówków: domyślna Reveal.js (sans-serif)
- Przejścia slajdów: `slide` (poziome)
- Fragmenty (`.fragment`): używane do stopniowego odsłaniania punktów

---

## Slajd 1 — Tytuł

**Tytuł:** UniVerify  
**Podtytuł:** Weryfikacja dyplomów na blockchainie  
**Autor:** Nazar Shcherbyna  
**Info:** Praca magisterska | Politechnika Warszawska | 2026  

---

## Slajd 2 — Problem

**Nagłówek:** Rynek fałszywych dyplomów — ~$1 mld/rok

Dwie kolumny:  
- **Problem:** Rynek fałszywych dyplomów wyceniany na >$1 mld/rok (Ezell 2012). Weryfikacja = e-mail do uczelni, oczekiwanie tygodniami, niemożliwa cross-border.  
- **Cel:** Każdy powinien móc zweryfikować dyplom bez kontaktu z uczelnią — szybko, tanio, niezależnie.  

**Punchline na dole:** „Jak zaprojektować taki rejestr tanio i zgodnie z RODO?"

---

## Slajd 3 — Q1: Architektura składowania

**Nagłówek:** Pytanie 1: Jak tanio przechowywać dyplomy on-chain?

Dwa bloki porównawcze:  
- **Per-record:** każdy dyplom = osobny slot w storage Ethereum → koszt rośnie liniowo z n  
- **Merkle-batch:** cały rocznik = jeden `bytes32` merkleRoot → koszt praktycznie stały  

Prosty diagram ASCII/SVG: drzewo Merkle z 4 liśćmi (diplomy) → root.  
Podpis pod diagramem: `issueBatch(root)` on-chain, `statusWithProof(hash, proof[])` do weryfikacji.

---

## Slajd 4 — Wynik Q1

**Nagłówek:** Merkle-batch: −98,9% przy n=100, −1000× przy n=1000

Tabela (Sepolia L1, ceny szacunkowe z artykułu SITEE):

| | n=1 | n=100 | n=1000 |
|---|---|---|---|
| Per-record | ~$0.032 | ~$3.20 | ~$32.00 |
| Merkle-batch | ~$0.032 | ~$0.032 | ~$0.032 |

**Punchline:** „Model analityczny odtwarza wynik z błędem <0,2%. Opublikowane: SITEE 2026."

---

## Slajd 5 — Q2: Prywatność

**Nagłówek:** Pytanie 2: Jak chronić dane studenta (RODO)?

Trzy sekcje (fragmenty):  
1. **Problem:** weryfikacja ujawnia wszystkie dane (imię, oceny, nr dyplomu) — kolizja z RODO  
2. **Rozwiązanie:** 4 pola jako commitments z solą:  
   `docHash = keccak256(c_student ‖ c_degree ‖ c_issuedAt ‖ c_diplomaNr)`  
   gdzie `c_i = keccak256(serialize(field_i) ‖ salt_i)`  
3. **Efekt:** student ujawnia tylko wybrane pola (np. stopień + data) — kontrakt bez zmian  

**Callout:** „Zero zmian w smart kontrakcie. Nowa trasa `/present` w web appce."

---

## Slajd 6 — Q3: Setup benchmarków L2

**Nagłówek:** Pytanie 3: Które L2 jest najtańsze?

4 sieci (ikony/badge):  
- Sepolia — L1 baseline  
- Arbitrum Sepolia — Nitro (optimistic rollup)  
- Base Sepolia — OP-Stack (Coinbase)  
- zkSync Sepolia — ZK rollup (Era)  

Metodologia (fragmenty):  
- 3 niezależne uruchomienia pipeline, zagregowane wyniki  
- Rozmiary paczki: n ∈ {1, 10, 100, 1 000, 10 000}  
- Koszt USD: model z 90-dniowej historii baseFee (p10/p50/p90)  
- Każda sieć: osobny model kosztów L1 (EIP-4844 / Ecotone scalars / Arbitrum blob)

---

## Slajd 7 — Wynik Q3

**Nagłówek:** Base: ~35× taniej niż Ethereum L1 przy n=10 000

Tabela (koszt/dyplom, p50, n=10 000):

| Sieć | USD/dyplom (p50, n=10k) |
|---|---|
| Sepolia (L1) | $3,2 × 10⁻⁶ |
| Arbitrum | $1,8 × 10⁻⁶ |
| zkSync | $2,3 × 10⁻⁶ |
| **Base** | **$9 × 10⁻⁸** |

**Punchline:** „Base wygrywa przy każdym n. Wynik stabilny przy ±2× zmianach ETH/USD i ceny sequencera (tabele wrażliwości)."

---

## Slajd 8 — Co zostało: Phase 3

**Nagłówek:** Co jeszcze: benchmarki kosztu prywatności off-chain

Dwa bloki:  
- **Znane już:** gaz on-chain identyczny dla privacy i plain — sam w sobie ważny wynik!  
- **TODO (~1 dzień):** zmierzyć off-chain overhead: czas budowania envelope, czas weryfikacji, rozmiar danych (pełne vs selektywne ujawnienie)  

**Callout:** „Reużywa pipeline `@univerify/benchmarks` — 3 nowe operacje w `src/ops/`"

---

## Slajd 9 — Podsumowanie

**Nagłówek:** UniVerify — wkład pracy

Trzy punkty z ikonami:  
- Merkle-batch: **−3 rzędy wielkości** kosztu przy n=1000 *(opublikowane: SITEE 2026)*  
- Privacy: **selektywne ujawnianie bez zmiany kontraktu** *(RODO-compatible)*  
- L2: **Base 35× taniej niż Ethereum L1** *(wynik stabilny na wrażliwość)*  

Dół: link GitHub + `github.com/n-shcherbyna/univerify` + napis „Pytania?"

---

## Szczegóły techniczne implementacji

- Reveal.js ładowany z CDN (`unpkg.com/reveal.js`)
- Jeden plik `.html` — bez zewnętrznych zależności poza CDN
- Motywy: `black` z nadpisaniem akcentu na `#3b82f6`
- `data-transition="slide"` między slajdami
- Fragmenty (`.fragment.fade-up`) dla stopniowego ujawniania punktów
- Tabele jako `<table>` HTML z klasą Reveal.js
- Diagram Merkle: SVG inline (prosta wizualizacja, nie wymagająca zewnętrznych bibliotek)
- Responsywny: działa w przeglądarce na pełnym ekranie
