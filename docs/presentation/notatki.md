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

Podejście naiwne zapisuje każdy dyplom **osobno** w pamięci łańcucha — a każdy wpis kosztuje. **n dyplomów to n transakcji**, rachunek rośnie wprost z ich liczbą.

Moje podejście to **Merkle-batch**: cały rocznik streszczamy do jednego 32-bajtowego „odcisku palca" (korzenia drzewa Merkle). Na łańcuch trafia **tylko ten odcisk** — jedna transakcja niezależnie od liczby dyplomów.

Diagram: cztery dyplomy łączone parami aż do jednego korzenia. Sprawdzenie jest publiczne i darmowe — krótki dowód potwierdza, że dany dyplom należy do rocznika. **Kluczowa myśl: na łańcuch idzie tylko odcisk, reszta zostaje poza nim.**

---

## Slajd 4 — Wynik 1 (ok. 1:45)

Przy stu dyplomach koszt na dyplom spada o około **99 %**, a przy tysiącu — **tysiąckrotnie**. Liczby są dla Sepolii L1, kurs ETH/USD 3500, snapshot z 13 maja.

Najważniejsze jest **„dlaczego"** — prostymi słowami. Na blockchainie płacimy głównie za **miejsce zajęte w łańcuchu**. Podejście „osobno" kupuje to miejsce dla każdego dyplomu z osobna, więc rachunek rośnie z ich liczbą. Batching kupuje je **raz**, dla całego rocznika naraz; dowody pojedynczych dyplomów powstają poza łańcuchem, za darmo. Dlatego przy większych paczkach koszt na dyplom **niemal znika**.

Model analityczny odtwarza pomiary z **błędem < 0,2 %** — wiadomo, skąd bierze się każdy składnik kosztu.

> Zastrzeżenie (jeśli ktoś dopyta): „osobno" to *model* n niezależnych transakcji, nie 1000 osobno wykonanych.

---

## Slajd 5 — Pytanie 2: prywatność (ok. 1:45)

Naiwna weryfikacja na blockchainie ujawniłaby **wszystko** — imię, oceny, numer dyplomu — co kłóci się z zasadą minimalizacji danych z RODO.

Rozwiązanie w prostych słowach: każde pole zamykamy jak w **zapieczętowanej kopercie**. Można potwierdzić, że pole jest prawdziwe, ale nie widać treści; „sól" — losowy dodatek — blokuje zgadywanie. Na łańcuch trafia tylko skrót z czterech takich kopert. (Formalnie: `cᵢ = keccak256(fieldᵢ ‖ saltᵢ)`.)

Efekt: **student sam decyduje, co ujawnić** — np. sam stopień i datę — a weryfikator potwierdza ich autentyczność, nie poznając pozostałych.

Inżyniersko najważniejsze: **smart kontrakt nie wymaga żadnej zmiany**. Cała logika prywatności jest poza łańcuchem, w nowej trasie `/present`.

---

## Slajd 6 — Czym jest L2 (ok. 1:45)

Krótkie wprowadzenie, bo dotyczy warstw drugich. L1, czyli sam Ethereum, jest bezpieczny, ale **drogi**: każdy bajt danych konkuruje o miejsce w bloku.

**Rollup** wykonuje setki transakcji poza łańcuchem i publikuje na nim tylko jedną skompresowaną paczkę z dowodem poprawności. Koszt najdroższego zasobu — miejsca na dane — **dzieli się na wszystkie transakcje w paczce**. Od 2024 r. (EIP-4844) dane idą dodatkowo do „blobów" — taniego, tymczasowego schowka — co jeszcze obniża koszt.

Są dwie rodziny: **optimistic** (Arbitrum, Base) zakłada poprawność i pozwala ją zakwestionować w okresie sporu; **ZK-rollup** (zkSync) dołącza dowód z wiedzą zerową — poprawność gwarantowana od razu. **Ta różnica wróci przy interpretacji wyników.**

---

## Slajd 7 — Pytanie 3: setup (ok. 1:45)

Badam cztery sieci — Sepolię jako punkt odniesienia L1, Arbitrum i Base jako optimistic, oraz zkSync Era jako ZK-rollup.

Metodologia: pipeline uruchamiałem **trzy razy niezależnie** i agregowałem. Rozmiary paczek od 1 do 10 000. Latencję mierzyłem 30 razy z odchyleniem standardowym.

**Uczciwość pomiaru** (podkreślam to sam): pomiary są na **sieciach testowych**, a koszty w USD są **modelowane** — biorę zmierzone zużycie gazu × osobny model kosztów L1 dla każdej rodziny rollupów, z 90-dniowej historii baseFee i snapshotu cen z 13 maja. Gaz zkSync nie jest wprost porównywalny z EVM — między rodzinami porównuję **wyłącznie koszt w dolarach**. To świadomy wybór na rzecz reprodukowalności.

---

## Slajd 8 — Wynik 3 (ok. 2:00, kluczowy slajd)

Wynik: **Base jest ok. 35× tańszy** niż Ethereum L1 — `$9×10⁻⁸` za dyplom wobec `$3,2×10⁻⁶` na Sepolii. Arbitrum i zkSync są tańsze od L1 tylko 1,8× i 1,4×.

**Dlaczego akurat Base?** Przy dużych paczkach koszt na dyplom sprowadza się do **opłaty za dane na L1 ÷ n**. Base na OP-Stack agresywnie kompresuje paczkę i publikuje ją w tanich blobach, więc ten dominujący składnik jest najniższy. zkSync musi dodatkowo zapłacić za **wygenerowanie kryptograficznego dowodu i obsługę kont** — to stały narzut, który przy takich rozmiarach paczek rozkłada się gorzej niż sama kompresja danych. **To jest sedno interpretacji.**

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
