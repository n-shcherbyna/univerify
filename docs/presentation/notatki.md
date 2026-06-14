# Notatki prelegenta — UniVerify (seminarium magisterskie)

**Czas docelowy:** 15–20 minut · 10 slajdów · ~1,5–2 min na slajd
**Widok prelegenta w Reveal.js:** otwórz `seminarium.html` i naciśnij **`S`** — notatki te są też wbudowane w deck (`<aside class="notes">`).
**Sterowanie:** strzałki / spacja = dalej · `Esc` = podgląd siatki · `F` = pełny ekran.

---

## Slajd 1 — Tytuł (ok. 0:45)

Dzień dobry. Nazywam się Nazar Shcherbyna, przedstawię pracę magisterską „UniVerify — weryfikacja dyplomów na blockchainie Ethereum", realizowaną pod opieką dr. hab. inż. Bartosza Sawickiego.

Praca rozszerza mój artykuł konferencyjny: system pozwala każdemu samodzielnie zweryfikować autentyczność dyplomu, bez kontaktu z uczelnią.

Prezentację zbudowałem wokół **trzech pytań badawczych** — koszt przechowywania, prywatność i wybór warstwy L2. Na końcu pokażę, co jeszcze zostało do zrobienia.

---

## Slajd 2 — Problem (ok. 1:30)

Skala podróbek dyplomów to **rząd miliarda dolarów** — przytaczam to za książką Ezella i Beara z 2012 roku. To liczba motywująca skalę zjawiska, **nie wynik mojej pracy**.

Dziś weryfikacja oznacza mail do uczelni i tygodnie oczekiwania, a w skali międzynarodowej często jest niemożliwa. Weryfikator musi też **bezwarunkowo ufać** uczelni i jej bazie danych.

Z tego wyrastają trzy pytania badawcze: jak tanio przechowywać dane on-chain, jak chronić prywatność studenta zgodnie z RODO, i która warstwa L2 daje najniższy koszt. **Te trzy pytania są osią całej prezentacji.**

---

## Slajd 3 — Pytanie 1: architektura (ok. 1:45)

Naiwne podejście „per-record" zapisuje każdy dyplom jako osobny wpis w stanie kontraktu — **n dyplomów to n transakcji**, koszt rośnie liniowo.

Moje podejście to **Merkle-batch**: cały rocznik haszujemy w drzewo Merkle i on-chain trafia tylko jeden korzeń — 32 bajty. To **jedna transakcja** niezależnie od liczby dyplomów.

Diagram pokazuje cztery dyplomy łączone parami aż do korzenia. Weryfikacja jest publiczna i bezpłatna — funkcja `statusWithProof` sprawdza ścieżkę Merkle dla danego dyplomu. **Kluczowa obserwacja: on-chain idzie tylko korzeń, reszta zostaje poza łańcuchem.**

---

## Slajd 4 — Wynik 1 (ok. 1:45)

Przy stu dyplomach koszt jednostkowy spada o około **99 procent**, a przy tysiącu — **tysiąckrotnie**. Liczby są dla Sepolii L1, przy kursie ETH/USD 3500 ze snapshotu z 13 maja.

Najważniejsze jest **„dlaczego"**. Koszt transakcji jest zdominowany przez zapis stanu i calldata na L1. Per-record płaci ten koszt n razy; batching płaci go raz, bo on-chain idzie jeden korzeń. Reszta pracy — budowa dowodu — przenosi się do **darmowego off-chain**. Stąd asymptota **O(1) zamiast O(n)**.

Zbudowałem też analityczny model dekompozycji kosztu — odtwarza pomiary z **błędem poniżej 0,2 %**, co znaczy, że rozumiemy, skąd bierze się każdy składnik kosztu.

> Zastrzeżenie (jeśli ktoś dopyta): per-record to *model* n niezależnych transakcji, nie 1000 osobno wykonanych.

---

## Slajd 5 — Pytanie 2: prywatność (ok. 1:45)

Naiwna weryfikacja na blockchainie ujawnia **wszystko** — imię, oceny, numer dyplomu — co kłóci się z zasadą minimalizacji danych z RODO.

Rozwiązanie: każde z czterech pól zastępuję **zobowiązaniem kryptograficznym z losową solą** — `cᵢ = keccak256(fieldᵢ ‖ saltᵢ)`. Hasz dokumentu to keccak z czterech zobowiązań. On-chain trafia tylko ten hasz.

Efekt: student ujawnia **tylko wybrane pola** — np. sam stopień i datę — a weryfikator potwierdza ich autentyczność, nie poznając pozostałych. Soli nie da się odwrócić, więc nieujawnione pola pozostają tajne.

Inżyniersko najważniejsze: **smart kontrakt nie wymaga żadnej zmiany** — nie odróżnia zobowiązania od zwykłego hasza. Cała logika prywatności jest off-chain, w nowej trasie `/present`.

---

## Slajd 6 — Czym jest L2 (ok. 1:45)

Krótkie wprowadzenie, bo dotyczy warstw drugich. L1, czyli sam Ethereum, jest bezpieczny, ale **drogi**: każdy bajt danych konkuruje o miejsce w bloku.

**Rollup** wykonuje setki transakcji poza łańcuchem i publikuje na L1 tylko jedną skompresowaną paczkę z dowodem poprawności. Koszt najdroższego zasobu — miejsca na dane — **dzieli się na wszystkie transakcje w paczce**. Od EIP-4844 dane idą do tanich „blobów", co dodatkowo obniża koszt.

Są dwie rodziny: **optimistic** (Arbitrum, Base) zakłada poprawność i pozwala ją zakwestionować w okresie sporu; **ZK-rollup** (zkSync) dołącza dowód z wiedzą zerową — poprawność gwarantowana od razu. **Ta różnica wróci przy interpretacji wyników.**

---

## Slajd 7 — Pytanie 3: setup (ok. 1:45)

Badam cztery sieci — Sepolię jako punkt odniesienia L1, Arbitrum i Base jako optimistic, oraz zkSync Era jako ZK-rollup.

Metodologia: pipeline uruchamiałem **trzy razy niezależnie** i agregowałem. Rozmiary paczek od 1 do 10 000. Latencję mierzyłem 30 razy z odchyleniem standardowym.

**Uczciwość pomiaru** (podkreślam to sam): pomiary są na **sieciach testowych**, a koszty w USD są **modelowane** — biorę zmierzone zużycie gazu × osobny model kosztów L1 dla każdej rodziny rollupów, z 90-dniowej historii baseFee i snapshotu cen z 13 maja. Gaz zkSync nie jest wprost porównywalny z EVM — między rodzinami porównuję **wyłącznie koszt w dolarach**. To świadomy wybór na rzecz reprodukowalności.

---

## Slajd 8 — Wynik 3 (ok. 2:00, kluczowy slajd)

Wynik: **Base jest ok. 35× tańszy** niż Ethereum L1 — `$9×10⁻⁸` za dyplom wobec `$3,2×10⁻⁶` na Sepolii. Arbitrum i zkSync są tańsze od L1 tylko 1,8× i 1,4×.

**Dlaczego akurat Base?** Przy dużych paczkach koszt na dyplom sprowadza się do **opłaty za dane na L1 ÷ n**. Base na OP-Stack agresywnie kompresuje paczkę i publikuje ją w tanich blobach, więc ten dominujący składnik jest najniższy. zkSync musi dopłacić za **generowanie dowodu ZK i bootloader abstrakcji konta** — narzut, który przy takich rozmiarach amortyzuje się słabiej niż sama kompresja danych. **To jest sedno interpretacji.**

O odporności: świadomie **nie** mówię „wynik niezależny od założeń". Mówię dokładnie tyle, ile zmierzyłem — w zbadanym zakresie Base jest najtańszy na każdym n, a ranking nie zmienia się przy **±2×** zmianie kursu ETH/USD i ceny sekwencera. Pokazują to tabele wrażliwości w pracy.

---

## Slajd 9 — Co zostało (Faza 3) (ok. 1:15)

Jedną rzecz już ustaliłem: koszt gazu on-chain jest **identyczny** dla schematu z prywatnością i bez niej, bo kontrakt nie odróżnia zobowiązania od zwykłego hasza. To **wynik zerowy, ale wart raportowania** — prywatność nie kosztuje nic na łańcuchu.

Do zmierzenia został narzut **off-chain**: czas budowania koperty, czas weryfikacji selektywnej kontra pełnej, oraz rozmiar danych przy pełnym i selektywnym ujawnieniu. Reużywam istniejącego pipeline z fazy benchmarków — szacuję to na ok. jeden dzień pracy. Liczby zasilą rozdział ewaluacji.

---

## Slajd 10 — Podsumowanie (ok. 1:00)

Praca wnosi trzy rzeczy:
1. **Architektura Merkle-batch** — koszt niżej o trzy rzędy wielkości przy n = 1000, model analityczny z błędem < 0,2 %.
2. **Selektywne ujawnianie danych** zgodne z zasadą minimalizacji RODO, **bez zmiany w smart kontrakcie**.
3. **Benchmarki L2** — Base ok. 35× tańszy od Ethereum L1, wynik stabilny na analizę wrażliwości.

Kod jest publiczny: `github.com/n-shcherbyna/univerify`. Dziękuję za uwagę — chętnie odpowiem na pytania.

---

## Zaplecze na pytania (Q&A)

**„Dlaczego nie mainnet?"**
Zużycie gazu na testnecie jest reprezentatywne — ten sam bytecode i opcode'y. Koszt w USD pochodzi z modeli L1 + 90-dniowego snapshotu cen mainnet. To świadomy wybór reprodukowalności, udokumentowany w rozdziale *Ograniczenia*.

**„Skąd liczba miliarda dolarów?"**
Z książki Ezella i Beara (2012), tytuł: *Degree Mills: The Billion-Dollar Industry…*. Źródło popularnonaukowe, traktuję je jako rząd wielkości motywujący problem, nie jako wynik pomiarowy.

**„Czy to naprawdę jest zgodne z RODO?"**
Realizuję konkretną zasadę — **minimalizację danych** (art. 5 ust. 1 lit. c). Nie twierdzę pełnej zgodności prawnej; pokazuję mechanizm techniczny, który tę zasadę wspiera.

**„Czy zkSync nie jest niesprawiedliwie traktowany?"**
Gaz zkSync łączy wykonanie, pubdata, dowód i bootloader AA — nie jest współmierny z gazem EVM. Dlatego między rodzinami rollupów porównuję **tylko koszt w USD**, nigdy gaz.

**„Czy commitment z niską entropią pola nie jest podatny na atak słownikowy?"**
Tak — dlatego każde pole ma losową, wysokoentropijną sól; bez znajomości soli zobowiązania niskoentropijnego pola nie da się zgadnąć. To jest też wskazane w ograniczeniach.

**„Co z czasem finalizacji optimistic rollupa (okres sporu)?"**
Dla weryfikacji dyplomu liczy się dostępność danych i koszt zapisu, a nie natychmiastowa finalizacja wypłaty. Okres sporu nie wpływa na poprawność odczytu statusu.
