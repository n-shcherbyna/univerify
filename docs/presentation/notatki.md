# Notatki prelegenta — UniVerify (seminarium magisterskie)

**Czas:** 15–20 minut · 10 slajdów · ~1,5–2 min na slajd
**Widok prelegenta:** otwórz `seminarium.html` i naciśnij **`S`** — te notatki są też wbudowane w deck.
**Sterowanie:** strzałki / spacja = dalej · `Esc` = podgląd siatki · `F` = pełny ekran.

> Zasada: mówię prostymi słowami, a trudne pojęcia tłumaczę przez analogię. Słowniczek na końcu.

---

## Slajd 1 — Tytuł (ok. 0:45)

Dzień dobry. Nazywam się Nazar Shcherbyna. Przedstawię pracę magisterską „UniVerify — weryfikacja dyplomów na blockchainie Ethereum", pod opieką dr. hab. inż. Bartosza Sawickiego.

W skrócie: budujemy system, w którym **każdy może samodzielnie sprawdzić, czy dyplom jest prawdziwy** — bez dzwonienia i pisania do uczelni.

Całość opowiem wokół **trzech pytań**: jak to robić tanio, jak chronić dane studenta, i gdzie wychodzi najtaniej. Na końcu — co jeszcze zostało.

---

## Slajd 2 — Problem (ok. 1:30)

Fałszywych dyplomów jest dużo — skala rzędu **miliarda dolarów**. Tę liczbę przytaczam za książką Ezella i Beara z 2012 roku; to tło problemu, **nie mój wynik**.

A jak dziś sprawdza się dyplom? Trzeba napisać do uczelni i czekać — czasem tygodniami. Między krajami często w ogóle się nie da. I za każdym razem trzeba **ślepo zaufać** uczelni i jej bazie danych.

Stąd trzy pytania: jak **tanio** to przechowywać, jak chronić **prywatność** studenta (RODO), i które **L2** jest najtańsze. To jest plan całej prezentacji.

---

## Slajd 3 — Pytanie 1: jak to przechowywać (ok. 1:45)

Najprostszy pomysł: zapisać każdy dyplom **osobno** w łańcuchu. Problem w tym, że **każdy taki zapis kosztuje**. 1000 dyplomów to 1000 zapisów i 1000 razy płacisz.

Mój pomysł — **Merkle-batch**: cały rocznik streszczam do jednego krótkiego **„odcisku palca"** (32 bajty). Do łańcucha wrzucam tylko ten odcisk — **jeden raz**, niezależnie czy dyplomów jest 100 czy 10 000.

Na diagramie: dyplomy łączą się parami, aż powstaje jeden wspólny odcisk (korzeń). Sprawdzenie dyplomu jest **publiczne i darmowe** — krótki „dowód" pokazuje, że dany dyplom należy do tego rocznika. **Najważniejsze: w łańcuchu siedzi tylko odcisk, reszta zostaje poza nim.**

---

## Slajd 4 — Wynik 1 (ok. 1:45)

Efekt: przy 100 dyplomach koszt na sztukę spada o jakieś **99 %**, a przy 1000 — robi się **tysiąc razy** tańszy. (Sieć Sepolia, kurs i ceny z konkretnego dnia — 13 maja.)

Dlaczego tak? Prostymi słowami: w blockchainie płaci się głównie za **zajęte miejsce**. Wariant „osobno" kupuje miejsce dla **każdego** dyplomu z osobna — im więcej dyplomów, tym większy rachunek. Merkle-batch kupuje miejsce **raz**, dla całego rocznika; resztę pracy robimy poza łańcuchem, **za darmo**. Dlatego przy dużych paczkach koszt na jeden dyplom **prawie znika**.

Zbudowałem też **wzór**, który rozkłada koszt na składniki — zgadza się z pomiarem z błędem **poniżej 0,2 %**. Czyli: nie tylko mierzę, ale i **rozumiem**, skąd bierze się każda złotówka.

> Jeśli ktoś dopyta: wariant „osobno" liczę wzorem (model), nie wykonuję realnie 1000 transakcji.

---

## Slajd 5 — Pytanie 2: prywatność (ok. 1:45)

Gdyby weryfikacja działała wprost, ujawniałaby **wszystko** — imię, oceny, numer dyplomu. To kłóci się z zasadą RODO: pokazuj **tylko to, co konieczne**.

Rozwiązanie w obrazku: każde pole zamykamy jak w **zapieczętowanej kopercie**. Z koperty można potwierdzić, że pole jest prawdziwe, ale **nie widać, co w środku**. Dorzucamy „sól" — losowy dodatek — żeby nie dało się **zgadnąć** zawartości. (Formalnie: `cᵢ = keccak256(fieldᵢ ‖ saltᵢ)`.)

Efekt: **to student wybiera, co pokazać** — np. sam stopień i datę, bez imienia czy ocen — a druga strona i tak potwierdzi, że to prawda.

Inżyniersko najważniejsze: **smart kontrakt nie zmienił się ani o linijkę**. Cała ta prywatność dzieje się poza łańcuchem, w nowej stronie `/present`.

---

## Slajd 6 — Czym jest L2 (ok. 1:45)

Krótkie wprowadzenie, bo dalej mówię o „warstwach drugich". Samo Ethereum (L1) jest bezpieczne, ale **drogie**: w jednym bloku jest mało miejsca, więc **wszyscy biją się o nie** i cena rośnie.

**Rollup** (to właśnie L2) załatwia setki transakcji **z boku**, a do Ethereum wysyła tylko **jedną skompresowaną paczkę** z dowodem, że wszystko policzono uczciwie. Najdroższy koszt — miejsce na dane — **dzieli się wtedy na wszystkich** z paczki. Od 2024 roku te dane idą do tańszego „schowka" zwanego **blobem**.

Są dwa rodzaje rollupów. **Optimistic** (Arbitrum, Base) zakłada, że jest dobrze, i daje czas na zgłoszenie oszustwa. **ZK-rollup** (zkSync) od razu dołącza **matematyczny dowód poprawności**. Ta różnica wróci, gdy będę tłumaczył wyniki.

---

## Slajd 7 — Pytanie 3: jak to mierzyłem (ok. 1:45)

Sprawdzam cztery sieci: Sepolia (samo Ethereum, jako punkt odniesienia), Arbitrum i Base (optimistic), oraz zkSync Era (ZK).

Jak mierzyłem: cały proces **powtórzyłem 3 razy** i uśredniłem. Paczki od 1 do 10 000 dyplomów. Czas reakcji mierzyłem 30 razy.

I mówię to wprost — **uczciwość pomiaru**: testowałem na **sieciach testowych**, a ceny w dolarach **policzyłem z modelu** (zmierzone zużycie × cennik z konkretnego dnia, osobny dla każdego rodzaju sieci). Dodatkowo „gaz" w zkSync liczy się inaczej niż w innych, więc **między sieciami porównuję tylko dolary, nie gaz**. To celowy wybór, żeby wynik dało się **powtórzyć**.

---

## Slajd 8 — Wynik 3 (ok. 2:00, kluczowy slajd)

Wynik: **Base jest około 35× tańszy** niż samo Ethereum. Arbitrum i zkSync są tańsze tylko 1,8× i 1,4×.

Dlaczego akurat Base? Przy dużych paczkach prawie cały koszt to **opłata za dane podzielona przez liczbę dyplomów**. Base najmocniej **ściska** paczkę i wrzuca ją do tanich blobów — więc ten główny koszt jest u niej najniższy. zkSync musi **dodatkowo** zapłacić za swój matematyczny dowód i obsługę kont — to **stały narzut**, który przy takich paczkach rozkłada się gorzej niż samo ściskanie danych. To jest sedno wyjaśnienia.

I ważne: **nie** mówię „wynik niezależny od wszystkiego". Mówię dokładnie tyle, ile sprawdziłem — Base jest najtańszy przy **każdym** rozmiarze paczki, a kolejność **nie zmienia się**, nawet gdy podwoję lub zmniejszę o połowę kurs i cenę sieci. To pokazują tabele w pracy.

---

## Slajd 9 — Co jeszcze zostało (ok. 1:15)

Jedno już wiem: koszt **w łańcuchu jest taki sam** z prywatnością i bez niej — bo kontrakt nie odróżnia zapieczętowanej koperty od zwykłego skrótu. To **wynik „zerowy", ale ważny**: prywatność nic nie kosztuje na łańcuchu.

Zostało zmierzyć koszt **poza łańcuchem**: ile trwa złożenie takiej koperty, ile trwa sprawdzenie, i ile waży paczka danych — przy pełnym i przy częściowym ujawnieniu. Użyję tego samego narzędzia co wcześniej, więc to jakiś **jeden dzień** pracy. Wyniki trafią do rozdziału z oceną.

---

## Slajd 10 — Podsumowanie (ok. 1:00)

Trzy rzeczy, które wnosi praca:
1. **Tanie składowanie** — koszt przestaje rosnąć z liczbą dyplomów (z rosnącego robi się prawie stały).
2. **Prywatność po stronie studenta** — to on decyduje, co pokazać; dodane bez zmiany działającego kontraktu.
3. **Wybór L2 na podstawie danych** — różnice w koszcie są ogromne (rząd wielkości), najtaniej wychodzi Base.

Kod jest publiczny: `github.com/n-shcherbyna/univerify`. Dziękuję — chętnie odpowiem na pytania.

---

## Zaplecze na pytania (Q&A)

**„Skąd weryfikator wie, że to prawdziwy dyplom, skoro student pokazuje tylko wybrane pola?”**
Bo student wybiera tylko, **które** pola odsłonić — nie może wybrać ich **treści**. Pola odsłonięte przelicza się na nowo (wartość + sól) i sprawdza, czy razem z resztą dają **ten sam odcisk palca, który uczelnia wpisała wcześniej do łańcucha**. Pola ukryte student oddaje jako wciąż „zapieczętowane koperty”, więc odcisk da się złożyć w całość. Gdyby podmienił choć jeden znak, odcisk by się nie zgadzał i sprawdzenie by padło. Wymyślić dyplomu też się nie da — jego odcisku po prostu nie ma w rejestrze uczelni.
*Uczciwe zastrzeżenie:* to dowodzi „**dyplom jest prawdziwy**”, a nie „**to ty jesteś osobą z dyplomu**”. Powiązanie z osobą to osobna warstwa — w praktyce weryfikator prosi o odsłonięcie pola „imię” i porównanie z dowodem tożsamości.

**„Dlaczego nie mainnet?”**
Zużycie zasobów na sieci testowej jest takie samo jak na prawdziwej — to ten sam kod. Ceny w dolarach dokładam z modelu i z cennika z danego dnia. To celowy wybór, żeby wynik dało się powtórzyć; opisane w rozdziale *Ograniczenia*.

**„Skąd liczba miliarda dolarów?”**
Z książki Ezella i Beara (2012): *Degree Mills: The Billion-Dollar Industry…*. Źródło popularne — traktuję je jako rząd wielkości, nie jako pomiar.

**„Czy to naprawdę jest zgodne z RODO?”**
Realizuję jedną konkretną zasadę — **minimalizację danych** (pokazuj tylko to, co konieczne). Nie twierdzę pełnej zgodności prawnej; pokazuję mechanizm, który tę zasadę wspiera.

**„Czy zkSync nie jest traktowany niesprawiedliwie?”**
Jego „gaz” liczy w sobie różne rzeczy (wykonanie, dane, dowód, obsługę kont) i **nie da się go wprost porównać** z gazem innych sieci. Dlatego między sieciami porównuję **tylko dolary**, nigdy gaz.

**„Czy ukrytego pola nie da się zgadnąć (atak słownikowy)?”**
Dlatego każde pole ma **losową sól**. Bez znajomości soli nie da się sprawdzić „czy w kopercie jest "informatyka"” — możliwości jest za dużo. Też opisane w ograniczeniach.

**„Co z czasem oczekiwania w optimistic rollupie?”**
Dla weryfikacji dyplomu liczy się dostępność danych i koszt zapisu, a nie szybka wypłata. Okres na zgłaszanie oszustw nie psuje **odczytu** statusu dyplomu.

---

## Słowniczek (prostymi słowami)

- **Blockchain / łańcuch** — wspólny, publiczny zeszyt, w którym nikt nie może niczego wymazać ani podmienić.
- **On-chain / off-chain** — „w łańcuchu” (drogie, trwałe) / „poza łańcuchem” (tanie, u nas na zwykłym serwerze).
- **Gaz** — jednostka „ile pracy/miejsca” zużywa transakcja; za gaz się płaci.
- **Blok** — paczka transakcji dopisywana co ~12 s; ma **stały limit**, więc o miejsce w nim się konkuruje.
- **Calldata** — dane wejściowe transakcji (treść „listu” do kontraktu); płaci się za każdy bajt.
- **Hash / skrót** — krótki „odcisk palca” danych; zmiana danych = inny odcisk.
- **Drzewo Merkle / korzeń** — sposób streszczenia wielu dokumentów w jeden odcisk (korzeń).
- **Commitment / zobowiązanie** — „zapieczętowana koperta”: dowodzi, że coś jest, nie zdradza treści.
- **Sól (salt)** — losowy dodatek do pola, żeby nie dało się zgadnąć jego zawartości.
- **L1 / L2** — warstwa 1 (samo Ethereum, bezpieczne, drogie) / warstwa 2 (nadbudowa, tania).
- **Rollup** — L2, które zwija setki transakcji w jedną paczkę i wysyła ją do L1.
- **Blob** — tani, tymczasowy „schowek na dane” wprowadzony w 2024 r. (EIP-4844).
- **Sekwencer** — serwer L2, który układa kolejność transakcji.
- **Dowód z wiedzą zerową (ZK)** — matematyczny dowód, że coś policzono poprawnie, bez pokazywania szczegółów.
