# Folio

*Make space for ideas.* — eine unabhängige, offene Notiz-App für Handschrift, PDFs und Textdokumente (PWA für iPad
und PC). Kein Build-Schritt; pdf.js, jsPDF und Yjs kommen vom CDN, als Schrift dient die Systemschrift (ab v72).
Notizen liegen lokal (IndexedDB), optional Sync über dein Google Drive. Kompatibel mit dem .goodnotes-Format
(Import/Export).

Diese Datei (`docs/TECHNIK.md` im Repository) ist die **technische Dokumentation**: Sie erklärt, *warum* Dinge so gebaut sind. Wer (Mensch oder
KI-Agent) etwas ändert, liest zuerst den folgenden Abschnitt und hält diese Datei beim Ändern aktuell.

## Bewusst so gebaut – nicht zurückbauen
Jeder Punkt behebt ein echtes, auf dem iPad aufgetretenes Problem. Wer ihn „vereinfacht“, holt den Fehler zurück.
Details stehen jeweils im genannten Abschnitt bzw. Code-Kommentar.

- **Scharfe iPad-Kopfzeile:** `html`/`body` sind `position: fixed`/`overflow: hidden` (`style.css`, Abschnitt Base);
  `unshift()` in `js/main.js` setzt nach Tastatur, Fokuswechsel, Drehen und App-Wechsel das Fenster, den sichtbaren
  Bereich (`visualViewport`) und von iOS verschobene `overflow: hidden`-Container zurück. Sonst rutscht der obere
  Rand unter die Statusleiste, und iPadOS zeichnet ihn verschwommen. Auch nach geschlossener Tastatur bei weiter
  fokussiertem Textfeld (Taste „Tastatur ausblenden“).
- **Schwungscrollen** im Notizbuch (`js/tools.js`, Momentum über `sc.scrollLeft/scrollTop`): eigene Umsetzung, weil
  das Scrollen per Finger selbst gesteuert wird (`touch-action: none`, Stift zeichnet).
- **Zahleneingabe für Werkzeugstärken** (Stärke noch einmal antippen → Zahl in mm): ausdrücklicher Nutzerwunsch.
- **Importierte PDFs bleiben Original-PDFs** (`js/pdfdoc.js`, ab v50): Seiten verweisen auf die Datei und werden erst
  beim Anzeigen gerendert. Seiten als Bilder zu speichern sprengte auf dem iPad den Speicher (450-Seiten-Buch ≈ 100 MB
  pro Dokument → „Nicht genügend Speicher“).
- **Render-Warteschlange „neueste zuerst“** (`js/pdfdoc.js`): beim schnellen Blättern wird die sichtbare Seite zuerst
  gezeichnet; FIFO ließ sie hinter allen überflogenen Seiten warten.
- **Leichte Datensätze** (`store.list()`, IndexedDB-Store `meta`): Bibliothek, Sync und Offload laden nie die ganze
  Bibliothek; volle Dokumente nur einzeln. `store.all()` über alles war die Ursache von „Out of Memory“.
- **IndexedDB-Wiederverbindung** (`retrying()` in `js/store.js`): iPadOS schließt die Datenbank im Hintergrund;
  ohne Wiederverbindung meldet der Sync „Failed to execute 'transaction'“.
- **Grenzen gegen Abstürze:** PDF-Export ≤ 500 Seiten, Goodnotes-Export ≤ 150 Seiten, Goodnotes-Kopien beim Sync nur
  bis 60 Seiten und 3 pro Durchgang. Größere Dokumente bekommen eine Meldung statt eines Absturzes.
- **Beispiel-Notizbücher mit festen IDs und festem Datum** (`seed()` in `js/main.js`): jedes Gerät legt dieselben
  Datensätze an, damit der Sync keine Duplikate erzeugt. Die Bibliothek zeigt dafür „Beispiel“ statt des Datums.
- **Durchgänge sind eigene Datensätze mit `versionOf`** (`js/versions.js`, ab v75) und werden beim Sync nie als
  Duplikate zusammengeführt: ein leerer Durchgang kann inhaltsgleich mit dem Original sein, die Duplikat-Bereinigung
  hätte ihn sonst gelöscht. Der Umschalter sitzt rechts in der Kopfzeile, weil links neben dem Titel auf dem iPad
  kein Platz ist.
- **Neue Metadaten-Felder auch in `META` (`js/offload.js`)**: an ausgelagerten Dokumenten überträgt der Sync nur
  diese Felder; fehlt eines, springt die Änderung beim nächsten Sync zurück (v76: Durchgang-Zuordnung).
- **Kalender-Feeds sind Nutzereingaben:** private ICS-Adressen nie in Code, Beispieldaten oder Logs.
- **Design-Regeln (ab v72):** Systemschrift; nur die Schriftgrößen 11 · 12 · 13 · 14 · 15 · 16 · 17 · 20 · 22 · 28 · 34 px
  (Kommentar bei `--font` in `style.css`); Dialoge per Wischen schließbar (`swipeToDismiss` in `js/ui.js`), Schließen
  spiegelt das Öffnen; „Bewegung reduzieren“ ersetzt Bewegung durch Überblendungen statt sie abzuschalten.
- **Spielregeln:** keine zusätzlichen Server, Proxys oder kostenpflichtigen Dienste ohne Zustimmung des Betreibers;
  externe APIs nur nach aktueller offizieller Dokumentation; keine nicht angefragten Zusatzfunktionen.
  Bei jeder veröffentlichten Änderung `APP_VERSION` (`js/store.js`) und `CACHE` (`sw.js`) erhöhen.

## Starten

**Lokal am PC:**
```bash
powershell -ExecutionPolicy Bypass -File serve.ps1
```
→ http://localhost:8000 öffnen.

**Auf dem iPad:** Die App braucht eine HTTPS-Adresse. Inhalt von `notizen/` z. B. auf GitHub Pages hochladen
(Repository → Settings → Pages), dann in Safari öffnen → Teilen → **Zum Home-Bildschirm**. Läuft danach offline.

**Google-Drive-Sync:** In der Seitenleiste **„Mit Google anmelden“** → Konto wählen → zustimmen. Jeder Nutzer
synchronisiert in sein **eigenes** Drive (Ordner „Folio“, Berechtigung `drive.file`: nur von Folio angelegte Dateien).
Ältere Installationen nutzen weiter ihren vorhandenen Drive-Ordner „BadNotes“ bzw. „Notizen-App“ (frühere Namen der
App); Folio liest alle drei. Nach ~1 Stunde läuft der Zugang ab; der nächste Tipp in der App erneuert ihn still.
Abmelden unter ⚙. Wie Änderungen von mehreren Geräten zusammengeführt werden: siehe **Synchronisierung und Konflikte**.

Einmalig für den Betreiber (Google Cloud Console, Projekt mit der Client-ID in `js/sync.js`): *Google Drive API*
aktiviert, OAuth-Client *Webanwendung* mit der GitHub-Pages-Adresse als „Autorisierte JavaScript-Quelle“,
OAuth-Zustimmungsbildschirm mit Startseite und Datenschutz-Link (`datenschutz.html`) und **veröffentlicht**
(im Testmodus können sich nur eingetragene Testnutzer anmelden). Für den Kalender zusätzlich die Schritte unter
**Kalender → Google Kalender einrichten**.

## Kalender (Woche und Monat)
Seitenleiste → **Kalender**. Oben **Woche | Monat** (pro Gerät gemerkt, `settings.calView`).

**Woche:** Mo–So mit durchgehender Zeitachse (keine festen Blöcke), Wochen vor/zurück,
**Heute**, rote Linie für die aktuelle Uhrzeit, Zeile für ganztägige Termine. Überschneidende Termine stehen leicht
versetzt nebeneinander und bleiben antippbar. Jeder Termin zeigt seine Quelle (Farbe; Name in den Details und in der
Legende über dem Raster). **Ab v80** stehen ganztägige und mehrtägige Termine in der Ganztägig-Zeile als **ein
durchgehender Balken** über ihre Tage (wie Apple Kalender; über den Wochenrand hinaus an der Seite offen). Mehrtägige
Termine mit Uhrzeit: erster und letzter Tag als Block in den Spalten, volle Tage dazwischen im Balken.

**Monat (ab v80, nach Apple Kalender):** 6 Wochen × 7 Tage, Mo zuerst; heute als farbiger Kreis, Tage aus Vor-/
Folgemonat blass, Wochenende leicht abgesetzt, der 1. mit Monatsnamen. Ganztägige Termine und Termine ab 24 Stunden
als Balken über die Tage; andere als „• 10:00 Titel“ an ihrem ersten Tag (unter 900 px Breite ohne Uhrzeit). Wie
viele Zeilen ein Tag zeigt, folgt der Zeilenhöhe (nach dem Zeichnen gemessen, bei Größenänderung neu); der Rest steht
als „+3 weitere“. Antippen: Termin → öffnet ihn; Tageszahl oder „+N weitere“ → Wochenansicht dieser Woche; freie
Fläche → neuer Termin an dem Tag. Google-Termine werden für alle 6 Wochen geladen (Cache je sichtbarem Zeitraum).

- **Eigene Termine** (ohne Google): **+ Termin** oder in eine freie Stelle tippen (Startzeit in 30-Minuten-Schritten).
  Titel, **Ganztägig**, **Beginn (Datum + Uhrzeit)**, **Ende (Datum + Uhrzeit)** – ab v80 auch über mehrere Tage; das
  Enddatum wandert beim Ändern des Startdatums mit. Gleicher Tag mit Ende vor Beginn = endet am nächsten Tag (wie
  vorher). Gespeichert als `date`, `endDate`, `start`, `end`, `allDay`; ältere Termine ohne `endDate` gelten wie
  bisher. Wöchentlich wiederholte Termine können mehrtägig sein (die Länge wird mitverschoben); geänderte
  Einzeltermine speichern ihr eigenes `endDate`/`allDay`. Google-Termine: ganztägig als `date` mit exklusivem Ende,
  sonst `dateTime` mit Zeitzone. *Einmalig* oder *Wöchentlich* (optional „bis“). Bei wiederholten Terminen:
  **Nur dieser Termin** (ändern oder absagen) oder **Ganze Serie**. Gespeichert lokal und – mit Drive-Sync – als eigene
  Datensätze in deinem Drive-Ordner; konfliktfähig wie Dokumente.
- **ICS-Abo (URL):** **Quellen → Adresse eingeben → Abonnieren** (`https://` oder `webcal://`). Neu geladen wird nur
  beim Tippen auf **Aktualisieren** — Folio verspricht keine Hintergrund-Aktualisierung.
  **Grenze:** Viele Kalender-Server (auch Stundenplan-Feeds) erlauben den Abruf aus einer Webseite nicht (fehlender
  CORS-Header). Folio meldet das dann und schlägt den Weg über Google vor: In Google Kalender (am Computer)
  „Weitere Kalender → + → **Per URL**“ ([Google-Hilfe](https://support.google.com/calendar/answer/37100?hl=de)),
  dann in Folio Google Kalender verbinden — der Feed erscheint (nur lesbar). Einen Proxy-Server gibt es bewusst nicht.
- **ICS-Datei importieren:** **Quellen → ICS-Datei importieren …**. Erneuter Import einer Datei mit demselben
  Kalendernamen fragt nach und **ersetzt** dann die Termine dieses Imports — Änderungen und Absagen kommen an, ohne
  Duplikate. Dieselben Termine aus zwei Quellen (z. B. Import und Google) werden nur einmal angezeigt.
- **Unterstützt aus ICS:** DTSTART/DTEND/DURATION, Zeitzonen (TZID als IANA-Name, z. B. Europe/Berlin, auch über die
  Sommerzeit-Umstellung), UTC, ganztägige Termine, RRULE mit FREQ=DAILY/WEEKLY/MONTHLY/YEARLY, INTERVAL, COUNT, UNTIL,
  BYDAY (ohne Ordnungszahl), BYMONTHDAY, EXDATE, RECURRENCE-ID (verschobene/geänderte Einzeltermine),
  STATUS:CANCELLED (ganze Serie oder ein Termin). **Nicht unterstützt:** BYSETPOS, Ordnungszahlen wie „2. Montag“,
  RDATE/EXRULE, nicht-IANA-Zeitzonennamen (werden als Ortszeit gelesen) — solche Termine zeigen nur ihren ersten
  Termin und sind in den Details markiert.
- **Google Kalender** (optional): **Quellen → Mit Google Kalender verbinden**. Eigene Einwilligung, unabhängig vom
  Drive-Login; Drive-Sync funktioniert auch ohne Kalender-Zustimmung. Kalender einzeln ein-/ausblenden; Ziel für neue
  Termine wählen (**Folio** oder ein Google-Kalender mit Schreibrecht). Termine in beschreibbaren Kalendern lassen
  sich ändern und löschen (bei Serien: dieser Termin oder ganze Serie; bei einer Google-Serie ändert Folio nur den
  Titel). Abonnierte/fremde Kalender sind nur lesbar. Token und Google-Termine liegen nur im Arbeitsspeicher, nach
  ~1 Stunde lädt **Google laden** bzw. **Aktualisieren** mit einem Tipp neu.

Getestet (v80) im Browser mit Folio-Terminen (1180×820 dunkel, 820×1180 hell): ganztägig über 5 Tage, Fr 18:00–So
12:00, vier Termine an einem Tag („+3 weitere“), über Mitternacht, über den Monatswechsel; Anlegen über das Fenster,
Bearbeiten, Tageszahl → Woche. **Nicht getestet:** Anlegen/Ändern mehrtägiger Termine in echtem Google Kalender,
echtes iPad.

### Google Kalender einrichten (einmalig, Betreiber)
In derselben Google-Cloud-Console-Konfiguration wie für Drive:
1. **APIs & Dienste → Bibliothek → Google Calendar API** aktivieren.
2. **OAuth-Zustimmungsbildschirm → Datenzugriff/Bereiche:** `…/auth/calendar.calendarlist.readonly` (Liste der
   Kalender) und `…/auth/calendar.events` (Termine lesen, anlegen, ändern, löschen) hinzufügen.
   Beide gelten bei Google als **sensible Bereiche**: Für eine veröffentlichte App verlangt Google dafür eine
   Überprüfung; bis dahin sehen Nutzer den Hinweis „Google hat diese App nicht überprüft“ (über „Erweitert“ fortsetzbar,
   Nutzerzahl begrenzt) bzw. im Testmodus nur eingetragene Testnutzer.
3. Am OAuth-Client ist nichts zu ändern (gleiche Client-ID, gleiche JavaScript-Quelle).

Folio fordert die Kalender-Bereiche mit einem **eigenen** Token an (`include_granted_scopes: false`), nur nach Tipp
auf „Mit Google Kalender verbinden“. Verwendete Schnittstellen (Calendar API v3): `GET users/me/calendarList`,
`GET calendars/{id}/events` (singleEvents, Zeitraum der Woche), `POST …/events`, `PATCH …/events/{id}`,
`DELETE …/events/{id}`.

## Lesemodus (ab v79)
Im Notizbuch das Buch-Symbol oben rechts (**Lesemodus (nur ansehen)**). Kopfzeile, Tabs, Werkzeug-Optionen,
Rückgängig und Seitenübersicht verschwinden; oben rechts bleibt eine kleine Leiste mit **‹** (Bibliothek) und
**Bearbeiten** (auch Esc). Seitenanzeige und Zoom bleiben. Nichts lässt sich ändern: Apple Pencil, Finger und Maus
scrollen und zoomen nur (in `onDown`/`onMove` in `js/tools.js` wie Finger behandelt, ohne Doppeltipp und ohne langes
Drücken → Einsetzen), Rechtsklick-Einsetzen ist aus, Tastatur nur Suchen (Strg+F), Zoom (Strg+±/0) und Blättern.
Der Modus bleibt beim Wechsel zwischen Dokumenten an, bis „Bearbeiten“; nach einem Neustart ist er aus. Beim Ein- und
Ausschalten bleibt die Stelle im Dokument (Anteil der Scrollhöhe). Ohne Kopfzeile beginnt die Seite unter der
Statusleiste (`env(safe-area-inset-top)`). Getestet im Browser (1180×820): Ziehen zeichnet nicht, Tastenkürzel
gesperrt, Esc beendet. Nicht auf dem echten iPad mit Pencil getestet.

## Unendliche Notizbücher (ab v52)
Im Dialog „Neues Notizbuch“ gibt es neben A4 und Letter das Format **„Unendlich“** (wie das Whiteboard in Goodnotes):
ein Notizbuch mit genau einer Seite, die mit dem Inhalt in alle Richtungen wächst. Die Seite trägt `inf: true` und
ihre Fläche `x0`, `y0`, `w`, `h` in Element-Koordinaten (`fitInfinite` in `render.js` hält 500 Einheiten Rand um den
Inhalt frei; wächst sie nach links/oben, bleibt die Ansicht stehen). Elemente werden dabei nie verschoben, deshalb
vereinigt der Sync-Merge die Flächen beider Geräte einfach (`merge.js`, ohne Konfliktnotiz). Papier: Leer, Gepunktet,
Liniert, Kariert (laufen über die ganze Fläche). Zoom bis 20 %. PDF-/Bild-Export: eine Seite in Größe des Inhalts
plus Rand. „Seite hinzufügen“ ist dort ausgeblendet. Der Goodnotes-Export kennt die unendliche Fläche nicht.

## Flüssiges Verschieben, Radieren, Scrollen; Einsetzen an einer Stelle (ab v59)
- **Verschieben/Größe ändern (Lasso):** Die Auswahl wird beim Ziehen „abgehoben“ (eigene Canvas `.sel-lift`, folgt per
  CSS-Transform; die Seite wird einmal ohne sie und einmal nach dem Ablegen gezeichnet, `ed.lift` in `editor.js`).
  Vorher wurde die ganze Seite bei jeder Bewegung neu gezeichnet.
- **Radieren:** Nur der Bereich der getroffenen Striche wird neu gezeichnet (`repaintArea` in `editor.js`, `clip` in
  `renderPage`); der letzte PDF-Ausschnitt der Detail-Ebene bleibt dafür zwischengespeichert (`pdfdoc.js`).
- **Scrollen:** Scroll-Ereignisse schreiben nur noch bei Änderungen ins DOM (Lesezeichen-Knopf, Seitenanzeige) und
  messen nur Seiten in Sichtweite.
- **Einsetzen:** Langer Fingerdruck (0,5 s, ruhig) oder Rechtsklick auf eine Seite → „Einsetzen“ an genau dieser
  Stelle. Eingesetzt wird die eigene Kopie (Lasso → Kopieren) oder, wenn seitdem anderswo Text kopiert wurde, dieser
  Text als Textfeld. Kopieren in Folio legt dazu den Text der kopierten Textfelder in die System-Zwischenablage.

## Pencil-Engine: Latenz und Strichbild (ab v54)
Wie PencilKit/Goodnotes: Eingabe mit allen Zwischenpunkten (`getCoalescedEvents`), eine vorhergesagte Spitze
(`getPredictedEvents`, nur angezeigt, nie gespeichert), Live-Zeichnen nur des neuen Stücks auf `#ink`, das noch
veränderliche Ende auf `#overlay`. Beide Ebenen sind `desynchronized` (wirkt in Chrome/Edge am PC; Safari ignoriert
den Hinweis). Striche bleiben Vektordaten (`points` = [x, y, Radius] plus Farbe, Stärke, Stifttyp), nie Bitmaps.
- **Loslassen ohne Ruckeln:** Ein fertiger Strich wird direkt auf die vorhandene Seiten- und Detail-Canvas gemalt,
  statt die ganze Seite neu zu rendern (`paintAppended` in `editor.js`). Gemessen auf einer dichten Seite
  (161 Striche, 66 000 Punkte, Desktop): Blockade nach dem Abheben 31–44 ms → 2–3 ms. Speichern und Vorschaubild
  warten, solange der Stift aufliegt.
- **Schlankere Umrissform** (`ink.js`): Abtastung nach Krümmung statt fester Schrittweite, kollineare Abtastpunkte
  zusammengefasst, Kreisscheiben nur an Enden und Knicken. Fehler höchstens ~0,02 Seiteneinheiten (unsichtbar, auch
  bei 400 %). Dieselbe dichte Seite: Pfadaufbau 9,3 s → 0,74 s, Rasterung 421 → 157 ms.
- **Glättung mit konstantem Aufwand** (`handwriting.js`): geglättete Punkte, die sich nicht mehr ändern können,
  werden zwischengespeichert; pro Frame wird nur das Ende neu geglättet (bitgenau gleiches Ergebnis wie vorher).
  Bei 8000 Punkten 1,4 ms → 0,01 ms pro Frame.
- **Maus und Finger:** ohne Drucksensor wird der Druck aus der Geschwindigkeit simuliert (langsam etwas kräftiger,
  schnell dünner).
- Unverändert: Datenformat, Live-Strich = fertiger Strich (gleiche Kurven, Radien und Spitzen), Sync/Merge,
  Goodnotes-Import/-Export, Radierer, Lasso.

**v55 – klarer, formtreuer, mehr Zoom:**
- **Glättung über die Strecke statt pro Abtastpunkt** (`handwriting.js`, `SMOOTH`): Gauß-Mittel entlang der
  Bogenlänge in Bildschirm-Pixeln (σ 1,4 px), „getwiced“ (2·G − G∘G), damit Kurven nicht schrumpfen. Ecken werden
  über ±2 px Richtung erkannt (vorher über 3 Abtastpunkte, also bei langsamem Schreiben ~1 px, wodurch Rauschen als
  Ecke galt und ungeglättet blieb); pro Ecke bleibt nur der schärfste Punkt fest. Zu dicht liegende Abtastpunkte
  werden gemittelt statt verworfen; kein Vorfilter mehr, daher kein Nachziehen hinter der Spitze. Gemessen mit
  simuliertem Pencil-Rauschen: Kantenrauheit bei realistischem Rauschen 0,045 → 0,018 px, schnelle kleine Schleifen
  schrumpfen 8,8 % → 2,9 %, Ecken (Spitze eines „V“) 0,46 → 0,21 Einheiten Abstand. Cache bleibt bitgenau.
- **Strichbreite ruhig:** Druck entlang der Strecke gemittelt (σ 4 px); der Druckausreißer beim Aufsetzen wird
  gedämpft (keine Knubbel am Strichanfang).
- **Präzision:** neue Handschrift-Punkte auf 0,01 statt 0,1 Einheiten (auch nach Lasso-Verschieben und Radieren),
  sonst Treppchen bei hohem Zoom.
- **Zoom bis 1000 %.** Die scharfe Detail-Ebene rendert den sichtbaren Teil plus 20 % Rand, ist in % der Seite
  platziert und bleibt beim Scrollen und Pinch-Zoomen sichtbar (vorher kurz verwaschen); neu gerendert, wenn die
  Bewegung stoppt. Neue Striche landen sofort auch auf ihr.
**v56 – ruhigere Breite, keine Haken, weniger Verzögerung, Goodnotes-Karopapier:**
- **Breite:** Druck jetzt über σ 10 px entlang des Strichs gemittelt (vorher 4 px). Im iPad-Vergleich mit
  Goodnotes pulsierte die Breite: beide Kanten beulten alle 10–20 px aus, das Druckflattern der Hand.
- **Aufsetz-/Abhebehaken** (kleine Kommas, Knubbel an Strichanfang und -ende) werden entfernt: eine Richtungsumkehr
  > 72° in den ersten bzw. letzten 3 px (`dehook` in `handwriting.js`), bevor etwas dauerhaft gemalt ist.
- **Latenz:** Der neue Strichteil wird schon im Pointer-Event gezeichnet (nicht erst im nächsten Frame); vom
  Overlay wird pro Frame nur noch das Rechteck um die Strichspitze gelöscht statt der ganzen Bildschirmfläche;
  ohne Browser-Vorhersage extrapoliert Folio die Spitze selbst einen Frame voraus (nur angezeigt).
  Zwischenpunkte übernehmen „Stift“ vom Hauptereignis, damit ihr Druck nie verloren geht.
- **Karopapier = Goodnotes „Kariert“** (aus dessen PDF vermessen): Linie alle 16 pt, 0,5 pt breit, erste bei
  15,5 pt, #D0D2D3 auf Weiß; dunkles Papier #333333 mit Linien #58595B (dunkles Papier allgemein jetzt #333333).
  Hoch-/Querformat, A4/Letter und unendliche Seiten.
- Safari liefert erst ab 26.2 Pointer-Koordinaten mit Nachkommastellen (vorher ganze Pixel); bei älteren
  iPadOS-Versionen sind Längsstriche deshalb zwangsläufig leicht stufig.

**v57 – Pencil-Aufzeichnung (Diagnose):** Einstellungen → Erweitert → „Pencil-Aufzeichnung (Diagnose)“. Solange
sie an ist, speichert `js/pencilrec.js` für jeden Stiftstrich die Rohdaten: jedes Pointer-Event mit seinen
Zwischenpunkten (`getCoalescedEvents`) und Vorhersagen (`getPredictedEvents`), Position, Druck, Neigung und
Zeitstempel, dazu Folios Bearbeitungszeit pro Event, die Frame-Zeiten des Displays (60 oder 120 Hz), Zoom und
Seitenlage sowie den gespeicherten Strich. „Sichern“ teilt die JSON-Datei (iPad: „In Dateien sichern“) oder lädt
sie herunter. Damit lässt sich echte Apple-Pencil-Schrift am PC durch die Strichberechnung abspielen und mit
demselben Text aus Goodnotes (`.goodnotes`-Export) vergleichen. Ohne den Schalter wird nichts aufgezeichnet.
Ab v58 zeigt die Leiste die Bildrate (Ruhe / beim letzten Strich): 30 fps in Ruhe heißt, das System drosselt
(z. B. Stromsparmodus; WebKit begrenzt `requestAnimationFrame` dann auf 30 fps).

**v60 – kleine Live-Flächen:** Die echten iPad-Aufnahmen (iPad mit 60-Hz-Display, Safari und Home-Bildschirm-App)
zeigten beim Schreiben nur 30 fps, obwohl Folios Skript pro Ereignis ≤ 1 ms brauchte: Safari schaffte die Frames
nicht, solange zwei bildschirmgroße Canvases (je ~3 Megapixel) jeden Frame geändert wurden. Ein Stiftstrich wird
jetzt live auf zwei kleine Canvases gezeichnet (`canvas.live-ink` / `.live-tip` in `tools.js`), die nur den Bereich
des Strichs plus 160 px Rand abdecken und bei Bedarf wachsen; `#ink` und `#overlay` bleiben beim Schreiben
unberührt. Live-Bild und fertiger Strich sind pixelgleich (getestet).

**v61 – abgeglichen mit Goodnotes (echte iPad-Daten):** Derselbe Satz, einmal in Folio aufgezeichnet
(Pencil-Aufzeichnung) und einmal aus Goodnotes exportiert (`.goodnotes`, 49 Striche), Strich für Strich verglichen:
- **Safari liefert jedes Pencil-Ereignis doppelt** (51 % aller `pointermove` wiederholen das vorige samt
  Zwischenpunkten). Folio nahm die Kopie als neue Eingabe: die Linie lief 12 ms zurück und wieder vor → kleine
  Knicke und Versätze in jedem Strich. Jetzt zählen nur Messpunkte, die neuer sind als der zuletzt genommene.
- **Druckkurve:** Breite ∝ (Druck / üblicher Druck)^(1,4 × Empfindlichkeit); der übliche Druck wird pro Gerät
  gelernt (`settings.penPressure`), die Stärke ist damit die Breite beim eigenen normalen Druck. Vorher war die
  Kurve auf Druck 0,5 ausgelegt und für eine leichte Hand (Median 0,15) fast flach.
- **Kurvenanpassung beim Speichern** (`fitCurve` in `handwriting.js`): wenige Stützpunkte (Toleranz 0,4 px beim
  Schreiben), Kontrollpunkte so gelöst, dass die Kurve durch sie läuft; an Ecken doppelter Kontrollpunkt, damit
  Spitzen spitz bleiben. Folio: 7 Punkte pro Strich (Goodnotes 9, vorher 63).
- Breitenglättung 6 px, Haken bis 5 px / ab 60° entfernt, sanftere Verjüngung, Ecken erst ab 75° über 3 px.
- Ergebnis Radius-Verteilung (10/25/50/75/90 %): Goodnotes 0,43/0,53/0,69/0,81/0,89 – Folio 0,43/0,54/0,68/0,79/0,90.

**v63 – keine linealgeraden Stücke mehr:** Die Kurvenanpassung aus v61 ließ fast gerade Striche (l, t) mit nur
Anfangs- und Endpunkt zurück, und Folios gerader Auslauf an Strichenden und Ecken wurde bei weit auseinander
liegenden Punkten lang. Jetzt liegen Stützpunkte höchstens 8 px auseinander, je einer 1,5 px vor jedem Ende und
jeder Ecke, Toleranz 0,25 px. Abweichung zur geschriebenen Linie: max. 0,37 px (v61: 0,99 px); ~18 Punkte pro Strich.
Dazu `fps.html`: Bildraten-Test ohne Folio (zeigt, ob das Gerät Webseiten drosselt).

**v64 – eigene Vorhersage der Strichspitze:** An der echten Aufnahme gemessen: Die Linie erscheint etwa einen
Frame nach dem Pencil-Ereignis, Safaris vorhergesagte Punkte reichen aber nur ~8 ms voraus. Abstand der
angezeigten Spitze zum Pencil im Moment der Anzeige (Median / 90 %): ohne Vorhersage 7,5 / 14,0 px, mit Safaris
Vorhersage 4,2 / 10,4 px, mit Folios eigener (`PenInput.predict`: quadratische Anpassung der letzten 24 ms,
80 % der Zeit, höchstens 1,2× der zuletzt gefahrenen Strecke) **2,4 / 6,6 px**. Der noch veränderliche Teil des
Live-Strichs weicht im Median nur 0,18 px von der endgültigen Linie ab (kein „Schwimmen“).

**v65 – Vorhersage zurück auf 8 ms:** Am iPad wirkte v64 unnatürlich, die Linie „glitchte“. Nachgemessen: Mit
einem ganzen Frame Vorausschau sprang die Spitze in 17 % der Frames zurück und lief bis 3 px neben der Bahn
(Safari: 4,6 % / 1,4 px; ohne Vorhersage 3 % / 0 px). Folios Vorhersage reicht jetzt nur 8 ms voraus (so weit
wie Safaris): 3 % / 0,9 px — so ruhig wie ohne Vorhersage. Lehre: Vorhersagen nach Ruhe der Spitze von Frame zu
Frame beurteilen, nicht nur nach mittlerem Abstand.

- **120 Hz auf dem iPad:** Safari zeichnet Webseiten auf ProMotion-iPads standardmäßig nur mit 60 Hz (Goodnotes
  nativ mit 120 Hz). Abschalten: Einstellungen → Apps → Safari → Erweitert → Funktionsflags → „Prefer Page
  Rendering Updates near 60fps“ aus. Gilt für Safari und vermutlich die Home-Bildschirm-App; iOS-Updates können es
  zurücksetzen. **Nur für ProMotion-iPads.** Auf einem iPad mit 60-Hz-Display (z. B. iPad Air, 820 × 1180 pt)
  lief Folio mit dem Schalter *aus* in allen Aufnahmen nur mit 30 fps, auch in Ruhe und in Safari; mit dem
  Schalter wieder *an* sofort mit 60 fps. Dort also eingeschaltet lassen (Standard).

## Handschrifterkennung (Beta, ab v70)
Einstellungen → Erweitert → **„Handschrift erkennen (Beta)“** (standardmäßig aus). Folio liest die Handschrift im
Hintergrund, und die Suche im Dokument (Lupe) sowie die Bibliothekssuche finden handschriftliche Begriffe; ein Treffer
markiert die Zeile mit dem Lasso.
- **Modell:** DE·HTR v2 (huggingface.co/naeyn/de-htr-web-v2, Apache-2.0, Revision `6241c1f…`), deutsche
  Handschrift, eine Zeile pro Bild (64 px hoch), ONNX Runtime Web 1.31.1 von jsDelivr (WASM, ein Thread). Läuft in
  einem Web Worker (`js/htr-worker.js`), damit das Schreiben nie wartet; einmalig ca. 20 MB, danach offline.
- **Ablauf** (`js/htr.js`): Stiftstriche einer Seite → Textzeilen (hohe Striche nach Mittelhöhe, Punkte und
  Querstriche zur nächsten Zeile, lange Zeilen an Wortlücken geteilt) → Zeilenbild → Text. Eine Seite wird nur neu
  gelesen, wenn sich ihre Striche ändern; nie während der Stift aufliegt. Neu gespeicherte Dokumente und die 20
  zuletzt geöffneten Notizbücher werden gelesen; die Lupe holt das offene Dokument nach vorn.
- **Suche:** toleriert Lesefehler (bis 3 Zeichen exakt, 4–8 Zeichen 1 Fehler, ab 9 Zeichen 2).
- **Gemessen** an einer echten Pencil-Aufzeichnung: „Hallo hier ist Felik / und dies ist ein Test“ (1 Fehler in 41
  Zeichen), ~0,7 s pro Zeile am PC; laut Modellkarte im Mittel 8 % Zeichenfehler (stark schreiberabhängig).
- **Daten:** Der erkannte Text liegt nur lokal in IndexedDB `folio-htr` (pro Gerät), die Dokumente werden nicht
  verändert — Sync, Merge und Export sind unberührt.

**Wieder entfernen** (ohne andere Funktionen zu berühren): `js/htr.js` und `js/htr-worker.js` löschen; die mit
`HTR-Beta` markierten Zeilen entfernen — in `js/editor.js` (Import, zwei Zeilen in `toggleSearch`, Hinweistext
zurück auf „Durchsucht Textfelder.“), in `js/library.js` (Import, eine Zeile in `searchContent`, Schalter + Hinweis
in `openSettings`); in `sw.js` die beiden Dateien aus `ASSETS`; den Absatz in `datenschutz.html`. Auf den Geräten
bleibt höchstens die Datenbank `folio-htr` übrig (harmlos).

## PDFs und Literatur: Original-PDF statt Seitenbilder (ab v50)
Importierte PDFs (direkt, aus ZIPs und als Hintergrund in .goodnotes-Dateien) werden **als Original-Datei** gespeichert
(IndexedDB `files`); die Seiten verweisen nur darauf (`page.pdf = { file, n }`) und werden beim Anzeigen mit pdf.js
gerendert — in der angezeigten Größe, beim Zoomen nur der sichtbare Ausschnitt (scharf wie das Original). Vorher wurde
jede Seite ein JPEG im Dokument: Ein 450-Seiten-Lehrbuch war ein ~100-MB-Dokument, ein Ordner Literatur mehrere
hundert MB — zu viel für den Arbeitsspeicher eines iPads.
- **Sync:** Jede PDF liegt einmal als `<id>.pdf` im Drive-Ordner (über 5 MB per Resumable-Upload, wie es die
  Drive-Dokumentation empfiehlt), hochgeladen vor dem ersten Dokument, das sie nutzt. Auf einem anderen Gerät wird
  sie beim ersten Anzeigen einer Seite geladen und danach lokal behalten. Offline und ohne Datei zeigt die Seite einen
  Hinweis statt eines Fehlers.
- **Speicher sparen:** Die lokale Kopie großer PDFs von Büchern, die 3 Tage nicht geöffnet wurden (kein Favorit), wird
  entfernt, sobald die PDF in Drive liegt; Favoriten holen ihre PDFs sofort aufs Gerät. PDFs, auf die kein Dokument
  mehr verweist, werden nach einem Tag gelöscht.
- **Rendern:** neueste Anfrage zuerst, höchstens zwei gleichzeitig, höchstens drei PDFs gleichzeitig geöffnet,
  fertige Seiten in einem Zwischenspeicher mit Obergrenze (~64 MB).
- **Exporte bauen die ganze Datei im Speicher:** PDF-Export bis 500 Seiten (ab 100 Seiten kleinere Seitenbilder),
  Goodnotes-Export bis 150 Seiten; darüber eine Meldung statt eines Absturzes. Automatische Goodnotes-Kopien in Drive
  nur für Dokumente bis 60 Seiten (Lehrbücher liegen als PDF ohnehin in Drive).
- **Getestet mit der echten Literatur-ZIP** (7 Lehrbücher, 2.184 Seiten, 117 MB): Import 15 s, alle 7 Dokumente
  zusammen 4 MB, Arbeitsspeicher beim Import höchstens 67 MB; 454-Seiten-Buch öffnen, schnell durchblättern: sichtbare
  Seite nach 30–50 ms, höchstens 13 MB; 300 % Zoom scharf; Sync aller PDFs gegen eine Drive-Attrappe höchstens 27 MB;
  zweites Gerät lädt die PDF nach; Speicher sparen 92 von 117 MB nur in Drive; Favorit holt die PDF zurück.
- **Nicht verifiziert:** echtes Google Drive (Resumable-Upload und Download), iPad.
- Ältere Dokumente mit Bild-Seiten bleiben unverändert und funktionieren weiter.

## Große Bibliotheken (Arbeitsspeicher)
Folio lädt nie die ganze Bibliothek auf einmal. Die Datenbank (IndexedDB, Version 4) hält zu jedem Dokument einen
**leichten Eintrag** (alles außer Seiten und Absätzen, Speicher `meta`) und fertig gerenderte **Vorschaubilder**
(`thumbs`). Bibliothek, Kalender und Sync arbeiten nur damit; ein vollständiges Dokument wird erst geladen, wenn es
geöffnet, hochgeladen, zusammengeführt oder dupliziert wird — und danach wieder freigegeben. Die Inhaltssuche liest
die Dokumente nacheinander im Hintergrund (Titel werden sofort gefunden). Entpackte Seitenbilder liegen in einem
Zwischenspeicher mit fester Obergrenze (~90 MB). ZIP-Importe werden stückweise gelesen, jedes PDF nach dem Import
wieder geschlossen.
Gemessen im Browser mit 40 Büchern (zusammen ~280 MB): Start 38 MB Arbeitsspeicher, Bibliotheksliste 13 KB,
Vorschauen erstellen höchstens 27 MB, Suche höchstens 43 MB, erster Sync (277 MB hochgeladen) höchstens 49 MB.
**Grenze:** Ältere Dokumente mit Bild-Seiten (vor v50 importiert) werden beim Öffnen und Hochladen als Ganzes geladen;
sehr große davon am besten löschen und die PDF neu importieren.

## Speicher sparen: große Dokumente nur in Google Drive
⚙ → **Speicher** → **Große Dokumente nur in Google Drive** (Standard: an, ab 5 MB; wählbar 2 / 5 / 20 MB). Gilt nur
mit Drive-Sync. Nach einem Sync (höchstens einmal pro Stunde) ersetzt Folio Notizbücher und Textdokumente, die
- größer als die Grenze sind (typisch: importierte Literatur-PDFs),
- **kein Favorit** sind,
- seit 3 Tagen nicht geöffnet wurden, nicht in einem Tab offen sind,
- und deren neueste Fassung schon in Drive liegt,

lokal durch eine kleine **Hülle** (Name, Ordner, Favorit, Vorschaubild ~25 KB). In der Bibliothek erkennbar an der
**Wolke**. Antippen lädt das Dokument aus Drive (braucht Internet) und öffnet es; danach ist es wieder auf dem Gerät,
bis die Regel greift. **Favoriten bleiben immer offline verfügbar**; ein ausgelagertes Dokument zum Favoriten machen
lädt es sofort. Einzeln: ··· → **Nur in Google Drive behalten** bzw. **Auf dieses Gerät laden**; ⚙ → Speicher →
**Jetzt aufräumen** wendet die Regel sofort an. Umbenennen, Verschieben, Favorit, Papierkorb gehen auch mit der Hülle
und werden beim Sync auf die Drive-Fassung übertragen (die Hülle selbst wird nie hochgeladen); Änderungen von anderen
Geräten aktualisieren die Hülle. Duplizieren und Exportieren laden das Dokument vorher.
Welche Felder einer Hülle übertragen werden, steht in `META` (`js/offload.js`). **Neue Datensatz-Felder, die man an
einer Hülle ändern kann, dort eintragen** — sonst setzt der nächste Sync sie zurück. So geschehen bis v76 mit
`versionOf`/`versionName`/`script`: ein als Durchgang zugeordnetes ausgelagertes Dokument sprang wieder zurück.
Wer davon betroffen war, ordnet es mit v77 einfach noch einmal zu.

**Ganze Ordner:** Ordner → ··· → **Ordner nur in Google Drive behalten** (danach im Hinweis **Rückgängig**) bzw.
**Ordner auf dieses Gerät laden** (ab v77): lädt alles darin (auch Unterordner) samt Original-PDFs einzeln aus Drive
zurück und meldet, wie viele nicht geladen werden konnten. Die automatische Regel oben kann große, lange nicht
geöffnete Dokumente später wieder auslagern; dauerhaft auf dem Gerät bleiben nur Favoriten. Ohne echtes Google
Drive getestet (Erkennen der ausgelagerten Dokumente im Ordner, Fehlermeldung ohne Anmeldung).
**Grenzen:** Offline lässt sich eine Hülle nicht öffnen. Die Suche findet bei ausgelagerten Dokumenten nur den Titel,
nicht den Inhalt. Ohne Drive-Sync wird nichts ausgelagert. Getestet mit einer Drive-Attrappe im Browser (Auslagern
6,8 MB → 24 KB, Umbenennen, Änderung von anderem Gerät, Öffnen, Favorit), nicht mit dem echten Drive.

## Synchronisierung und Konflikte
**Vorher (bis v40):** Jedes Dokument war eine Datei; bei Änderungen auf zwei Geräten gewann die neuere Fassung **als
Ganzes** — die ältere Änderung ging verloren (z. B. offline auf dem iPad geschrieben, gleichzeitig am PC).

**Jetzt (ab v41):** Jedes Gerät merkt sich pro Dokument den zuletzt gemeinsamen Stand mit Drive (Basis, lokal in
IndexedDB, wird nie hochgeladen). Beim Sync:
- nur hier geändert → hochladen; nur auf Drive geändert → übernehmen; **auf beiden geändert → zusammenführen**
  (`js/merge.js`, Drei-Wege-Vergleich gegen die Basis):
  - Seiten, Elemente (Striche, Text, Bilder) und Absätze von Textdokumenten werden über ihre festen IDs abgeglichen.
    Unabhängige Änderungen (z. B. hier ein Strich, dort eine neue Seite) werden **beide übernommen**.
  - Dasselbe Element auf beiden Geräten geändert → **beide Fassungen bleiben** (die eigene als Kopie daneben,
    Textfelder/Bilder leicht versetzt).
  - Gelöscht gegen geändert → **die Änderung gewinnt**, das Element/die Seite/das Dokument bleibt.
  - Felder (Name, Ordner, Cover, Farbe …): eine Seite geändert → übernommen; beide verschieden → der Wert dieses
    Geräts bleibt, der andere steht im Hinweis.
  - Seitenreihenfolge: die Seite, die umsortiert hat, gewinnt; neue Seiten der anderen Seite werden hinter ihrem
    Vorgänger eingefügt.
- Jeder echte Konflikt hinterlässt einen **sichtbaren Hinweis**: „!“ an der Kachel, „Sync-Hinweise“ im ···-Menü und
  ein Hinweis-Knopf im Editor; „Gelesen“ entfernt ihn (auf allen Geräten).
- Hochgeladen wird nur, wenn die Drive-Datei noch die gelesene Fassung ist; hat ein anderes Gerät dazwischen
  geschrieben, wird im nächsten Lauf erneut zusammengeführt. Gerade bearbeitete Dokumente (offenes Textfeld,
  ungespeicherte Änderungen) werden in diesem Lauf übersprungen, nicht überschrieben.

**Grenzen (ehrlich):**
- Der **erste** Abgleich eines Dokuments nach dem Update hat noch keine Basis — dafür gilt einmalig die alte Regel
  (neuere Fassung gewinnt). Danach wird zusammengeführt. Also am besten jedes Gerät nach dem Update einmal
  synchronisieren, bevor parallel offline gearbeitet wird.
- Gleichzeitiges Schreiben zweier Geräte in genau derselben Sekunde ist nicht atomar abgesichert (Drive bietet
  dafür keine Sperre); das Zeitfenster ist sehr klein und wird im nächsten Lauf zusammengeführt.
- Innerhalb eines Elements wird nicht gemischt: Ein Textfeld, das auf beiden Geräten bearbeitet wurde, erscheint
  zweimal (statt Wort für Wort zusammengeführt). Ebenso ein Absatz in Textdokumenten.
- Termine-Ausnahmen eines wiederholten eigenen Termins und die Termine eines ICS-Imports werden als Ganzes
  verglichen (Konflikt → Wert dieses Geräts + Hinweis).
- Sehr alte Dokumente, deren Seiten keine IDs haben, werden nicht elementweise zusammengeführt: Dann bleibt die
  Fassung dieses Geräts und die andere wird als „(Konflikt-Kopie)“ daneben gelegt.
- Die Basis verdoppelt ungefähr den lokalen Speicherbedarf synchronisierter Dokumente.
- Nach einem Zusammenführen im offenen Dokument wird der Rückgängig-Verlauf dieses Dokuments geleert.

### Werkzeugleiste auf allen Geräten (ab v78)
Stifte (Art, Farben, Stärken, gewählte Farbe und Stärke, Spitze/Druck/Glätten, Gesten), Textmarker, Formen, Radierer,
Lasso, Text, Laser, die Favoriten, „Eigene Farben“ und die gewählte Palette werden mit Google Drive synchronisiert
(`js/prefs.js`). Sie liegen in einem Datensatz `{ kind: 'prefs', id: 'prefs-tools', tools, customColors, palette }`,
den der normale Sync wie ein Dokument überträgt; die Bibliothek zeigt ihn nicht. Pro Gerät bleiben: das gerade
gewählte Werkzeug, die Druck-Kalibrierung des Stifts, „Nur mit Stift zeichnen“, Lage der Optionsleiste, Seitenübersicht.
- Geschrieben wird nur, wenn sich die Werkzeugleiste ändert (bemerkt über `saveSettings`, 0,8 s verzögert). Beim
  ersten Start mit v78 wird nichts gesendet: ein Gerät übernimmt die Leiste der anderen, sobald dort einmal etwas
  geändert wurde. **Einmal am Gerät mit der richtigen Leiste etwas antippen/ändern**, dann folgen die anderen.
- Empfangen: `T` und `PALETTE` werden an Ort und Stelle ersetzt (andere Module halten sie), die Optionsleiste und das
  Karteikarten-Schreibfeld neu gezeichnet; das Übernehmen schreibt nichts zurück.
- Gleichzeitig auf zwei Geräten geändert: der Datensatz wird wie andere zusammengeführt; die Felder sind ganze
  Objekte, bei echter Gleichzeitigkeit gilt die Leiste dieses Geräts.
Getestet im Browser (Änderung schreibt den Datensatz, empfangene Leiste wird übernommen und angezeigt, kein
Zurückschreiben). Nicht mit echtem Google Drive zwischen zwei Geräten getestet.

## PDF und Goodnotes aus der Zwischenablage auf dem iPad

1. In Goodnotes das Dokument als **PDF** oder **Goodnotes** exportieren und im Teilen-Menü **Kopieren** wählen; alternativ eine Datei in der Dateien-App kopieren.
2. In Folio die Bibliothek bzw. den gewünschten Ordner öffnen.
3. Auf eine **freie Fläche** lange drücken und im iPad-Menü **Einsetzen/Einfügen** wählen.
4. Folio erkennt die Datei und fragt nach dem Zielordner.

Die freie Fläche ist ein echter Einfügebereich für das iPad-Systemmenü; Dokumentkarten bleiben normal bedienbar.
Alternativ: **+ → Importieren … → Aus der Zwischenablage** öffnet einen Einfügebereich mit einem **Einsetzen**-Knopf.
Am PC funktioniert dort auch Strg+V bzw. Cmd+V.

**Grenze von Safari:** iPadOS gibt nicht jede kopierte Datei an Webseiten weiter. Ein kopierter Dateiverweis,
ein Vorschaubild oder einzelne Goodnotes-Striche enthalten nicht zwingend die eigentliche Datei. Folio meldet
das und bietet Dateiauswahl oder den folgenden Kurzbefehl an. Native Übergaben aus Goodnotes/Dateien und das
Systemmenü müssen auf einem echten iPad geprüft werden.

### Optionaler Kurzbefehl „In Folio öffnen“

1. Kurzbefehle → **+** → Name **In Folio öffnen**.
2. **Im Share-Sheet anzeigen** einschalten und als Eingabetyp **Dateien** zulassen, damit PDFs und .goodnotes-Dateien angenommen werden.
3. **Namen abrufen** – Eingabe: Kurzbefehleingabe.
4. **Base64-Codierung** – Eingabe: die ursprüngliche Kurzbefehleingabe, nicht der Dateiname; Zeilenumbrüche: Keine.
5. **Text**: **FOLIO-FILE|**, dann die Variable **Name**, dann **|**, dann **Base64-codiert**.
6. **In Zwischenablage kopieren** – Eingabe: Text.

Danach in Folio auf freie Fläche lange drücken und einsetzen. Der ältere Kurzbefehl mit **NOTIZEN-PDF|Name|Base64**
bleibt unterstützt. Dateiinhalte werden lokal decodiert; kopierte Web- oder Datei-URLs werden nicht automatisch abgerufen.
Nach der ersten erfolgreichen Nutzung erscheint bei Rückkehr zu Folio zusätzlich für sieben Sekunden der
Button **PDF/Goodnotes einsetzen**. Ohne Einfügevorgang bzw. Knopfdruck wird die Zwischenablage nicht gelesen.
PDFs und Goodnotes-Dateien können weiterhin über Dateiauswahl oder Drag & Drop importiert werden.

## Goodnotes-Dateien importieren (.goodnotes)
In Goodnotes: **Teilen → Exportieren → Goodnotes** → Datei in „Dateien“ sichern. In Folio: **+ → Importieren … → PDF oder Goodnotes**
(oder die Datei per Drag & Drop in die App ziehen) → Ordner wählen.
Übernommen werden: Seitenreihenfolge, PDF-Hintergründe und Papiervorlagen, Handschrift (Farbe, Stärke, Druck),
Formen und farbige Linien, eingefügte Bilder (PNG/JPEG, an Originalposition und -größe), Textfelder (Text, Farbe,
Größe, Breite; bei mehreren Farben in einem Feld gilt die erste); gelöschte Elemente werden
weggelassen. Alles ist danach normal bearbeitbar (radieren, Lasso, umfärben, verschieben).
Noch nicht unterstützt: gedrehte/zugeschnittene Bilder (kamen in der Beispieldatei nicht vor).

### Ganze Goodnotes-Ordner (ZIP)
In Goodnotes einen **Ordner** exportieren → ZIP in „Dateien“ sichern → in Folio **+ → Importieren … → PDF oder
Goodnotes** (oder per Drag & Drop) und die ZIP wählen. **PDFs in der ZIP** werden ebenfalls importiert (als
Notizbuch mit PDF-Hintergrund) — damit geht auch jeder normal gezippte Ordner voller PDFs, auch mit Windows-Bordmitteln
gezippt. Folio erkennt den Ordner-Export (Einträge `Ordner/Unterordner/Name.goodnotes`
plus `.goodnotesmeta`) und baut die **Ordnerstruktur als echte Folio-Ordner** nach (Ordnerfarbe aus Goodnotes wird
auf die Folio-Palette abgebildet); jedes Dokument läuft durch den normalen .goodnotes-Import. Vorher: Zielordner
wählen und Übersicht (Anzahl Dokumente/Ordner). Gibt es einen gleichnamigen Ordner schon: **Zusammenlegen** oder
**Neuer Ordner** („Name (2)“). Nichts wird überschrieben — gleichnamige Dokumente bekommen eine Nummer. Fortschritt
„Importiere n/N“; danach ein **Bericht** mit umbenannten, fehlgeschlagenen und übersprungenen Einträgen (z. B.
Dateien, die keine Goodnotes-Dokumente sind). Getestet mit einer echten Ordner-ZIP (2 Ebenen, 2 Dokumente,
16-seitiges Notizbuch). Grenze: Die ZIP wird komplett in den Speicher gelesen; sehr große Exporte (mehrere GB, ZIP64)
werden nicht unterstützt. Goodnotes-Ordnersymbole werden nicht übernommen (im Beispiel „none“).

### Als .goodnotes exportieren (Beta)
Im Dokument **Teilen → Als Goodnotes-Datei (Beta)** oder in der Bibliothek **··· → Als Goodnotes-Datei (Beta)**.
Auf dem iPad öffnet sich das Teilen-Menü (→ „In Goodnotes öffnen“ oder „In Dateien sichern“), am PC wird die Datei
heruntergeladen. Zum Übertragen iCloud/Google Drive + Dateien-App nutzen, nicht WhatsApp (verändert die Datei).
Getestet mit Goodnotes 6 auf dem iPad: Striche (richtige Dicke), Bilder, Textfelder (bearbeitbar) und ein 5-seitiges
Dokument mit 678 Strichen.

**Striche wie in Goodnotes:** Folio speichert Striche im selben Modell wie Goodnotes — Mittellinie aus Kurven,
pro Punkt der halbe Strichradius (`js/ink.js`). Der Druck des Stifts wird beim Absetzen einmal in Breite umgerechnet.
Dadurch sehen Striche in beiden Apps gleich aus, und Import → Export → Import verändert nichts mehr.
Alte Notizbücher werden beim Öffnen automatisch umgerechnet (pixelgleich).

**Goodnotes-Kopien in Google Drive:** Mit Sync legt Folio zu jedem Notizbuch und Textdokument eine `.goodnotes`-Datei in
`Folio/Goodnotes` (bei älteren Installationen `BadNotes/Goodnotes`) ab — erneuert eine Minute nach der letzten Änderung, umbenannt mit dem Notizbuch, gelöscht mit ihm
(max. 3 pro Sync-Lauf). In Goodnotes öffnen: Dateien-App → Google Drive → Folio → Goodnotes. Abschaltbar unter ⚙.

Handschrift, Formen, Textmarker, Bilder und **Textfelder** (Schrift in Goodnotes: Helvetica Neue) bleiben bearbeitbar;
Papier, Vorlagen und PDF-Hintergründe
werden zu einem festen Seitenhintergrund. Das Format ist nachgebaut, nicht offiziell — ob jede Goodnotes-Version
die Datei annimmt, ist nicht garantiert. Originale also nicht nur als .goodnotes aufheben.

## Textdokumente
**+ → Textdokument** legt ein fließendes Text-Dokument an (wie Goodnotes' „Textdokument“): Titel, Überschriften 1–3,
Text, Zitat, **fett**/*kursiv*/unterstrichen/durchgestrichen, Textfarbe, Markierung, Aufzählung, Nummerierung,
Checkliste (Kästchen antippen), Einrücken mit Tab, Tabellen (Tab = nächste Zelle, Zeilen/Spalten einfügen/löschen),
Bilder (auch per Einfügen) und Trennlinien. Der Titel ist der Dokumentname. Teilen → **Als PDF (Drucken)**.
Goodnotes-Textdokumente (.goodnotes) lassen sich wie Notizbücher importieren (braucht beim ersten Mal Internet).

Gespeichert wird im selben Modell wie bei Goodnotes (Slate-Knoten; in der .goodnotes-Datei als Yjs-Dokument,
siehe `js/textdoc.js`). **Export als .goodnotes (Beta):** getestet mit Goodnotes 6 auf dem iPad (Titel, Absätze,
Tabellen, Bild): öffnet sich. Achtung: Auf einem Übertragungsweg meldete Goodnotes selbst bei seiner eigenen
Datei „Dateiformat wird nicht unterstützt“ — dann einen anderen Weg probieren (per Discord ging es).

## Karteikarten (ab v66)
**+ → Karteikarten** legt einen leeren Stapel an, **+ → Importieren … → Karteikarten** einen Stapel aus Text.
Stapel sind ein eigener Dokumenttyp: Ordner, Favoriten, Papierkorb, Suche (auch im Kartentext), Duplizieren,
Filter „Karteikarten“ und Google-Drive-Sync wie bei Notizbüchern. Die Kachel zeigt, wie viele Karten heute dran sind.

**Mit einer KI erstellen:** Im Import-Fenster „KI-Prompt kopieren“, in ChatGPT/Claude/Gemini einfügen, Skript
anhängen, die Antwort kopieren und in Folio einfügen (iPad: „Einsetzen“ oder lange ins Feld drücken → Einsetzen;
oder eine .txt/.md/.json/.csv-Datei wählen bzw. aufs Fenster ziehen). Folio zeigt sofort, wie viele Karten es
erkannt hat. In einen bestehenden Stapel importiert, werden doppelte Karten übersprungen.

**Format** (`js/cardformat.js`):
```
# Name des Stapels

F: Vorderseite (Frage oder Begriff)
A: Rückseite (Antwort)
   weitere Zeilen gehören zur Rückseite, bis zur nächsten „F:“-Zeile
   - Aufzählungen mit „- “

F: Was besagt $F = m \cdot a$?
A: Kraft ist Masse mal Beschleunigung. Abgesetzte Formel: $$E_{kin} = \tfrac12 m v^2$$
```
- Formatierung: `**fett**`, `*kursiv*`, `` `code` ``, Formeln in LaTeX (`$…$`, `$$…$$`, `\(…\)`, `\[…\]`; gezeichnet
  mit KaTeX, das nur geladen wird, wenn eine Karte eine Formel hat). „5 $ und 7 $“ bleibt normaler Text.
- Fehlertolerant: auch `Q:`/`Frage:`/`Front:`/`Vorderseite:` und `Antwort:`/`Answer:`/`Back:`/`Rückseite:`, fett
  (`**F:**`), als Listenpunkt oder nummeriert; `---` zwischen Karten; Codeblock und Begleittext der KI drumherum
  werden ignoriert; unvollständige Karten werden übersprungen und gezählt.
- Ohne Kennzeichnung: eine Karte pro Zeile, getrennt durch Tab, `::` oder `;` (Anki/Quizlet-Textexport), oder eine
  Markdown-Tabelle. JSON: `[{"front": "…", "back": "…"}]` oder `{"name": "…", "cards": […]}` (auch
  question/answer, q/a, frage/antwort oder `["vorne", "hinten"]`).
- ··· → **Als Text exportieren** schreibt genau dieses Format (Import gibt dieselben Karten zurück).

**Selbst anlegen – tippen oder schreiben (ab v67):** Im Stapel
**+** oben rechts, „+ Karte“ über der Liste oder „Karte erstellen“ im leeren Stapel. Oben wählt man
**Tippen** oder **Schreiben** (wird pro Gerät gemerkt). Tippen: Textfelder mit Vorschau (Formeln, fett, Listen); auf
dem iPad kann man mit dem Apple Pencil auch direkt ins Textfeld schreiben (iPadOS „Kritzeln“ macht Text daraus).
Schreiben: je Seite ein Schreibfeld mit derselben Stift-Engine wie im Notizbuch (`js/inkpad.js` nutzt `PenInput`
aus `handwriting.js`, Striche im selben Format), dazu Radierer (ganze Striche), Rückgängig und Leeren. Farben und
Stärken (ab v68) sind die des Notizbuch-Stifts: antippen = wählen, die aktive noch einmal antippen = ändern
(Farbfenster mit Palette, eigenen Farben, Farbwähler und Hex; Stärke in mm mit Schieberegler oder direkter
Zahleneingabe, 0,1–4 mm), „+“ fügt eine Farbe hinzu. Änderungen gelten auch im Notizbuch. Finger schreiben nur, solange „Nur mit Stift zeichnen“ aus ist oder noch kein Pencil benutzt
wurde. Eine Seite darf Text und Handschrift zugleich haben. **Hinzufügen & nächste Karte** (Strg+Enter) legt Karten
in Serie an. Handschrift erscheint im Lernmodus auf weißem Papier (auch im Dunkelmodus), in der Kartenliste als kleine
Vorschau. Gespeichert als `frontInk` / `backInk`: `{ w: 1000, h: 500, strokes: [...] }`. Beim Sync wird Handschrift
wie ein Feld zusammengeführt (auf beiden Geräten geändert → Sync-Hinweis, die Fassung von hier bleibt). Beim
Text-Export steht für eine nur handschriftliche Seite „[Handschrift]“; Handschrift wird nicht durchsucht.

**Lernen:** Karte ansehen, umdrehen (Tippen, Leertaste), selbst bewerten: **Falsch** (1), **Unpräzise, aber
richtig** (2), **Richtig** (3, auch Leertaste). Auf den Tasten steht, wann die Karte wiederkommt. Strg+Z nimmt
die letzte Bewertung zurück, E bearbeitet die Karte, Esc beendet. Falsch beantwortete Karten (und neue Karten,
die nur „unpräzise“ waren) kommen nach 10 Minuten wieder, spätestens bevor die Sitzung endet. Übersicht pro
Stapel: fällig heute, neue Karten heute, im Lernen; Verteilung Neu/Lernen/Jung/Gefestigt (Stabilität ≥ 21 Tage),
geschätzte Erinnerung jetzt, fällige Karten der nächsten 7 Tage. ··· → Lerneinstellungen: Ziel-Behaltensrate
(80–95 %, Standard 90 %) und neue Karten pro Tag (Standard 20).

**Lernübersicht (ab v69):** In der Seitenleiste unter Kalender: **Lernen** (mit der Zahl der Karten, die heute
dran sind). Eine Seite für alle Stapel (`js/learnplan.js`):
- Heute: fällige, neue und Karten im Lernen über alle Stapel, geschätzte Dauer (gemessen an deinem eigenen Tempo:
  Median der Abstände zwischen Antworten, sonst 10 s pro Karte), Ring mit dem heutigen Fortschritt.
- **Alles lernen:** Stapel für Stapel, der mit den meisten fälligen Karten zuerst; am Ende eines Stapels geht es mit
  „Weiter mit …“ zum nächsten, oder zurück zur Lernübersicht.
- Lernserie (Tage in Folge), heute beantwortet (richtig/falsch), Trefferquote der letzten 30 Tage, Karten gesamt mit
  Anteil gefestigt und geschätzter Erinnerung.
- Jeder Stapel als Karte: Ordner, heute fällig oder „erledigt“, Verteilung Neu/Lernen/Jung/Gefestigt, nächste
  Wiederholung, Lernen/Öffnen. Stapel nur in Google Drive erscheinen ohne Zahlen.
- Die nächsten 14 Tage (fällige Karten pro Tag), Aktivität der letzten 18 Wochen (Antworten pro Tag) und
  **Oft vergessen** (mindestens 2× vergessen, öffnet die Karte zum Bearbeiten).
Alle Zahlen kommen aus den Bewertungsprotokollen und sind nach dem Sync auf allen Geräten gleich.

**Verfahren: FSRS-6** (`js/srs.js`). FSRS (Free Spaced Repetition Scheduler) beschreibt jede Karte mit Schwierigkeit,
Stabilität und Abrufwahrscheinlichkeit und plant die nächste Wiederholung für den Moment, in dem die Wahrscheinlichkeit
auf die Ziel-Behaltensrate fällt. Es ist auf großen Mengen echter Wiederholungsdaten angepasst, sagt Vergessen
genauer voraus als SM-2 und ist seit Anki 23.10 dort der eingebaute Planer. Formeln und Standardparameter
(w0–w20) stammen aus der Referenzimplementierung py-fsrs (`fsrs/scheduler.py`) und dem FSRS-6-Abschnitt im Wiki
von open-spaced-repetition („The Algorithm“). Zuordnung: Falsch = Again, Unpräzise = Hard, Richtig = Good (Easy
gibt es nicht). Abweichungen von py-fsrs: ein Lernschritt von 10 Minuten für neue Karten (py-fsrs: 1 und 10 Min),
die Streuung (Fuzz) ist pro Karte und Wiederholung fest statt zufällig, ein Lerntag beginnt um 4 Uhr. Die
Parameter werden nicht auf die eigenen Daten optimiert.

**Sync des Lernfortschritts:** Eine Karte speichert keinen Termin, sondern ihr Bewertungsprotokoll
(`log: [[Zeit, Note], …]`); der Plan wird daraus berechnet. Beim 3-Wege-Merge (`js/merge.js`) werden die Protokolle
beider Geräte vereinigt — wer am PC und am iPad lernt, verliert keine Wiederholung, und beide Geräte rechnen
denselben Plan. Text von Vorder-/Rückseite wird wie andere Felder zusammengeführt (auf beiden Geräten verschieden
geändert → Sync-Hinweis). „Lernfortschritt zurücksetzen“ setzt `reset` (Zeit); ältere Bewertungen zählen dann nicht
mehr, auch wenn sie von einem anderen Gerät nachkommen. Eine auf einem Gerät gelöschte Karte bleibt gelöscht, auch
wenn sie auf dem anderen inzwischen gelernt wurde (nur eine Textänderung holt sie zurück).

Speicherformat: `{ kind: 'deck', id, name, parent, …, retention?, newPerDay?, script?, cards: [{ id, front, back, frontInk?, backInk?,
frontImg?, backImg?, ref?, created, log?, reset? }] }`.

## Durchgänge (Versionen) und Skripte mit Karteikarten (ab v75)
Wunsch des Betreibers: ein Übungsblatt ein zweites Mal bearbeiten, ohne dass in der Bibliothek „Kopie von …“-Dateien
entstehen, und Karteikarten fest an ihr Skript hängen. Code: `js/versions.js`.

**Durchgänge:** Notizbuch → ··· → **Neuer Durchgang …** (Bibliothek) oder Titelmenü / Umschalter im Dokument.
Wahl **Ohne Handschrift** (Stift, Textmarker und Formen fallen weg, d. h. alle Elemente `type: 'stroke'`;
Textfelder, Bilder, Papier und PDF bleiben) oder **Mit Handschrift**. Namen „Original“, „Durchgang 2“, „Durchgang 3“ …,
umbenennbar. Jeder Durchgang ist ab dem Anlegen eigenständig (Seiten hinzufügen/löschen betrifft nur ihn).
- **Im Dokument:** Umschalter „Durchgang 2 ▾“ in der Kopfzeile, **rechts** neben den Werkzeugen (erscheint ab zwei
  Versionen). Links neben dem Titel war auf dem iPad quer (1180 px) zu wenig Platz: Titel und Umschalter wurden beide
  abgeschnitten. Unter 1000 px Breite wird er kompakter (ohne Pfeil). Wechseln zeigt die andere Version im selben Tab
  an derselben Stelle. Dort auch: neuer Durchgang, umbenennen, Durchgang löschen (Papierkorb).
- **In der Bibliothek:** eine Kachel; „3 Versionen · 1 Stapel“ unter dem Datum klappt die Versionen und zugewiesenen
  Stapel darunter auf (Raster und Liste). Diese Kacheln lassen sich nicht in Ordner ziehen (sie wandern mit dem
  Original); langes Drücken öffnet ihr Menü. In Suche und „Zuletzt geöffnet“ erscheinen Durchgänge nicht einzeln.
- **Export:** PDF bzw. Goodnotes fragt bei mehreren Versionen per Schalter, welche; je Version eine Datei
  („Name – Durchgang 2.pdf“). iPad: ein Teilen-Menü mit allen Dateien (ein Tipp mehr, wie beim Goodnotes-Export);
  PC: nacheinander heruntergeladen. Einzelseiten-Export (Seite als PDF/Bild) gilt nur für die offene Version.
- **Speicherung:** jede Version ist ein eigenes Notizbuch mit `versionOf: <id des Originals>` und `versionName`.
  Dadurch funktionieren Sync, Zusammenführen, „Nur in Google Drive“ und PDF-Originale ohne Sonderfälle. Name und
  Ordner folgen dem Original (Umbenennen und Verschieben ändern alle Versionen mit). Papierkorb: das Original nimmt
  seine Versionen mit (`trashedBy`) und bringt sie beim Wiederherstellen zurück; ein einzeln gelöschter Durchgang
  steht im Papierkorb als „Name – Durchgang 2“. Ist das Original endgültig weg, erscheinen die Versionen wieder als
  eigene Dokumente. „Duplizieren“ macht aus einer Version ein eigenständiges Dokument (ohne `versionOf`).
- **Vorhandene Kopien zuordnen (ab v76):** Notizbuch → ··· → **Als Durchgang zuordnen …** (bei einem Durchgang:
  „Anderem Dokument zuordnen …“) → Original wählen. Es wird dessen nächster „Durchgang N“ und übernimmt Name und
  Ordner; eigene Durchgänge kommen mit, zugewiesene Stapel gehen an das neue Original. „Rückgängig“ im Hinweis stellt
  den alten Stand her (die leichten Datensätze von vorher werden zurückgeschrieben; `store.put` entfernt dabei die
  neuen Felder wieder). Getestet im Browser (Zuordnen, Gruppierung, Rückgängig).
- **Sync:** Versionen werden nie als Duplikate zusammengeführt (`mergeDuplicates` in `sync.js`; ein leerer Durchgang
  kann inhaltsgleich mit einem leeren Original sein). Goodnotes-Kopien in Google Drive nur für das Original.

**Skript ↔ Karteikarten:**
- **Stapel ↔ Skript:** Stapel → ··· → **Skript zuweisen** (Bibliothek oder im Stapel), oder im Skript Titelmenü →
  **Karteikarten …** → „Neuer Stapel für dieses Skript“ / „Stapel zuweisen …“. Im Stapel führt ein Knopf mit dem
  Skriptnamen zum Skript; im Skript zeigt der Knopf mit dem Karten-Symbol (rechts oben, nur wenn Stapel zugewiesen sind)
  die Stapel. Gespeichert als `deck.script = <id des Originals>` (Versionen teilen sich die Stapel).
- **Stapel im Skript:** zugewiesene Stapel stehen in der Bibliothek unter der Skript-Kachel, nicht einzeln. Mit dem
  Filter „Karteikarten“ stehen sie einzeln (ihre Skripte werden dann nicht gezeigt). Die Lernübersicht zeigt sie wie
  bisher. Wird das Skript gelöscht, bleiben die Stapel und stehen wieder einzeln da.
- **Karte ↔ Seite:** `card.ref = { n: Seitennummer, page?: Seiten-id im Original }`. Im Karten-Fenster „Seite
  verknüpfen“ (Nummer eingeben); in der Kartenliste „S. 12“; beim Lernen nach dem Umdrehen **Im Skript zeigen
  (Seite 12)** – öffnet das Original an der Seite (über die id, sonst die Nummer). Die Lernsitzung endet dabei.
- **Karte aus Auswahl:** Lasso-Auswahl → **Karteikarte**, oder Screenshot-Werkzeug → **Als Karteikarte**. Der
  Bereich wird samt Papier/PDF als JPEG (höchstens 1200 px, ≈ 50–150 KB) gezeichnet und kommt auf die Vorderseite;
  im Karten-Fenster „Auf die Rückseite“ / „Entfernen“. Ziel: der einzige zugewiesene Stapel, sonst Auswahl; ohne
  Stapel wird „<Skript> – Karteikarten“ angelegt (erst beim Speichern der Karte). Die Seite wird automatisch verknüpft
  (aus einem Durchgang nur über die Nummer). Bilder: `frontImg` / `backImg = { src, w, h }`; Text-Export „[Bild]“.
  Bilder machen den Stapel größer (Sync lädt den ganzen Stapel); bei sehr vielen Bild-Karten im Blick behalten.

Getestet im Browser (1180×820 dunkel, 820×1180 hell): Durchgang ohne Handschrift anlegen (Striche weg, Textfelder
da), Strich im Durchgang ändert das Original nicht, Umschalter, Gruppierung in Raster und Liste, Papierkorb mit
Rückgängig, Export-Auswahl und Erzeugen von PDF- und Goodnotes-Datei je Version, Karte aus Lasso-Auswahl mit neuem
Stapel, Bild auf die Rückseite, Lernen → „Im Skript zeigen“. **Nicht getestet:** echtes iPad (Pencil, langes
Drücken auf Unter-Kacheln, Teilen-Menü mit mehreren Dateien), mehrere Downloads am PC im echten Browser, Sync der
neuen Felder mit echtem Google Drive.

## Aufbau

```
notizen/
  index.html, style.css, sw.js, manifest.json, folio-mark.svg, *.png (Icons)
  js/main.js      Start, Beispieldaten
  js/library.js   Bibliothek: Seitenleiste, Raster/Liste, Ordner, Menüs, Papierkorb, Einstellungen
  js/editor.js    Editor: Tabs, Toolbar, Optionsleiste, Seiten, Zoom, Verlauf, Thumbnails, Suche
  js/tools.js     Eingabe: Stifte, Radierer, Lasso, Formen, Text, Laser, Gesten, Tastenkürzel
  js/render.js    Zeichnen von Seiten, Strichen, Text, Vorlagen, Covern
  js/ink.js       Strich-Modell (Radius pro Punkt, wie im .goodnotes-Format)
  js/goodnotes.js / goodnotes-export.js   .goodnotes-Import und -Export
  js/textdoc.js   Textdokumente: Editor, Speicherformat, Vorschau
  js/deck.js      Karteikarten: Stapel-Übersicht, Karten bearbeiten, Import, Lernmodus
  js/srs.js       Wiederholungsplanung FSRS-6, Lernsitzung, Statistik (rein, ohne I/O)
  js/cardformat.js  Textformat der Karteikarten: Einlesen, Export, KI-Prompt, Darstellung (Formeln)
  js/inkpad.js    Handschrift auf Karteikarten: Schreibfeld und Anzeige (Notizbuch-Stift-Engine)
  js/learnplan.js Lernübersicht: alle Stapel, heute fällig, Prognose, Aktivität, oft vergessene Karten
  js/versions.js  Durchgänge (Versionen) eines Notizbuchs, Export mehrerer Versionen, Skript ↔ Karteikarten
  js/prefs.js     Werkzeugleiste über Google Drive auf allen Geräten gleich
  js/store.js     Datenmodell, IndexedDB, Einstellungen
  js/ui.js        Popover, Menüs, Sheets, Dialoge, Toasts
  js/pdf.js       PDF-Import/-Export, Bilder
  js/sync.js      Google-Drive-Sync
  js/merge.js     Drei-Wege-Zusammenführung für den Sync (rein, ohne I/O)
  js/offload.js   Speicher optimieren: große Dokumente nur in Google Drive (Hüllen, Nachladen)
  js/pdfdoc.js    Original-PDFs: speichern, Seiten bei Bedarf rendern, Nachladen aus Drive
  js/calendar.js  Kalender: Woche und Monat, eigene (auch mehrtägige) Termine, Abos/Importe, Google Kalender
  js/ics.js       iCalendar lesen und Wiederholungen auflösen (rein, ohne I/O)
design/folio-reference.png   Design-Referenz
```

## Checkliste

### Fertig und getestet (im Browser, 1180×820, hell + dunkel)
- Bibliothek: Seitenleiste (Alle Notizen, Zuletzt, Favoriten, Papierkorb, Ordner), Titel, Suche, Filter-Tabs, Ordner-Navigation mit Zurück
- Raster- und Listenansicht, Sortierung (Änderung, Erstellung, Name), Suche (Titel + Textinhalte)
- „+“: Notizbuch (Cover, Papier, Format), Schnellnotiz, Ordner, PDF-Import, Bild-Import
- Kontextmenü (···, Rechtsklick, langes Drücken): Öffnen, Umbenennen, Duplizieren, Verschieben, Favorit, Cover, PDF-Export, Papierkorb
- Papierkorb: Wiederherstellen, endgültig löschen, leeren; Mehrfachauswahl (Verschieben, Duplizieren, Löschen)
- Editor: Dokument-Tabs, Bibliotheks-Button, Werkzeugleiste, kontextabhängige Optionsleiste
- Stift (Füller / Pinsel mit geglättetem Druck, Kugelschreiber gleichmäßig dick; jeder Strich eine glatte Umrissform, Ecken bleiben scharf; Stärke in mm; vorhergesagte Pencil-Punkte), 1–10 Farbplätze („+“), Paletten Standard / Pastell / Folio / Kräftig / Graustufen, eigene Farben speichern (gedrückt halten = entfernen), 3 Stärken + Regler, Favoriten
- Textmarker (Multiply-Blending, gerade Linie), Formen-Erkennung (Linie, Rechteck, Ellipse, Dreieck, Polygon)
- Radierer: präzise (teilt Striche) / ganzer Strich, 3 Größen, „Nur Textmarker“, Seite leeren
- Lasso: frei oder Antippen; Verschieben, Größe ändern, Farbe, Ausschneiden, Kopieren, Einfügen, Duplizieren, Löschen; Filter Handschrift/Bilder/Text
- Text-Werkzeug: Farbe, Größe, Fett, Kursiv, 5 Schriftarten — für markierten Text oder (ohne Markierung) das ganze Feld; Strg+B/I; Bearbeiten durch Antippen (`js/richtext.js`). Bild einfügen, Laserpointer
- Rückgängig/Wiederholen (auch für Seiten-Operationen), Zoom (Pinch, Strg+Mausrad, Strg +/−/0)
- Seiten hinzufügen (`js/addpage.js`): vor dieser / nach dieser / letzte Seite; Schnellvorlagen (aktuelle Vorlage, Leer, Liniert schmal); Mehr Vorlagen (Umschlag- oder Papierseite; Größe: Hoch-/Querformat, Standard, A3–A7, Letter, Tabloid, Angepasst in mm; Papierfarbe; Farbpunkte je Vorlage); Bild; Dokumente scannen (Kamera + Scan-Filter); Foto aufnehmen; Importieren (PDF/Bild)
- Seiten duplizieren, löschen, Vorlage ändern, Lesezeichen
- Seitenübersicht mit Lesezeichen-Filter, Seitenanzeige „n / N“, Suche im Dokument
- Export: Dokument/Seite als PDF, Seite als PNG; PDF-Import mit Schreiben auf den Seiten
- Hell/Dunkel/System, lokale Speicherung, offline (Service Worker)

### Neu in v41 — umgesetzt und im Browser getestet (Maus, 1024×768, dunkel; Kalender auch 375 px breit)
- **Werkzeugleiste:** feste Hauptleiste (Position und Höhe aller Werkzeuge unverändert beim Wechseln); Details des
  Werkzeugs in einer eigenen kompakten Leiste, oben waagerecht oder links/rechts senkrecht angedockt — nur am Griff
  (Punkte) verschiebbar, Position wird gemerkt; Safe Areas berücksichtigt.
- **Textfelder:** beim Bearbeiten Rahmen mit Verschiebe-Griff oben und Breiten-Griffen links/rechts — Text bricht neu
  um, Schriftgröße bleibt; Cursor und Formatierung bleiben erhalten; ein Rückgängig-Schritt für alles. Mit dem Lasso:
  bei genau einem ausgewählten Textfeld ändern die Seitengriffe nur die Breite (statt zu skalieren); Verschieben wie
  bisher. Bearbeiten (Text-Werkzeug, antippen) und Verschieben/Breite (Griffe bzw. Lasso) sind getrennt.
- **Rechteck-Lasso** zusätzlich zum freien Lasso (Umschalter in der Lasso-Leiste), gleiche Filter und Aktionen, Vorschau
  beim Aufziehen.
- **Ordner:** Farbe (Folio-Palette oder eigene Farbe) und Symbol (14 Linien-Symbole) über ··· → **Farbe & Symbol**;
  sichtbar in Kachel, Liste, Seitenleiste und Ordnerauswahl; synchronisiert; alte Ordner behalten das bisherige Salbei.
- **Goodnotes-Ordner-ZIP** importieren (siehe oben), mit Zusammenlegen, Nummerieren und Bericht.
- **Sync-Zusammenführung** mit Basis-Stand, Konflikt-Hinweisen und Schutz vor Überschreiben (getestet mit einer
  simulierten Drive-Gegenstelle im Browser: unabhängige Änderungen, gleiches Element, Seite gelöscht/bearbeitet,
  Dokument gelöscht/bearbeitet, Feldkonflikt, Umsortieren, Hinweise quittieren, gleichzeitiges Schreiben, Wiederholung
  ohne Änderung schreibt nichts).
- **Kalender:** Wochenansicht, eigene Termine (auch wöchentlich, Einzeländerung), ICS-Parser (mit synthetischen
  Fällen und dem echten Stundenplan-Feed geprüft: 92 Einträge, 3 Absagen, Europe/Berlin), ICS-Import-Anzeige,
  Überschneidungen, ganztägig.
- Service Worker cacht nur noch die App selbst und die Bibliotheken (cdnjs, jsdelivr) — **keine** Google-Antworten,
  Anmeldedaten, Kalender-Feeds oder Kalenderdaten.

### Nicht verifiziert
- **Apple Pencil, Touch-Gesten und Druck** auf einem echten iPad (nur mit Maus/simulierten Events getestet) — gilt
  auch für die neuen Textfeld-Griffe, das Rechteck-Lasso und das Andocken der Detailleiste per Finger/Pencil.
- Google-Drive-Sync gegen das echte Google Drive mit der neuen Zusammenführung (getestet nur gegen eine Attrappe,
  die die verwendeten Drive-Aufrufe nachbildet) und zwischen zwei echten Geräten.
- **Google Kalender** insgesamt (Verbinden, Kalenderliste, Laden, Anlegen, Ändern, Löschen): Code folgt der offiziellen
  API-Dokumentation, wurde aber ohne freigeschaltete Kalender-Bereiche nicht gegen ein echtes Konto ausgeführt.
- ICS-Abo per URL bei einem Server **mit** CORS (der getestete Stundenplan-Feed hat kein CORS → Weg über Google).
- Installation als Home-Bildschirm-App in Safari

### Nicht umgesetzt
- Handschrifterkennung / Umwandlung in Text, Suche in Handschrift
- Seiten per Drag & Drop umsortieren, Elemente zwischen Seiten verschieben
- Horizontales Blättern, Präsentationsmodus, Audioaufnahme, Teilen/Zusammenarbeit, Marketplace, KI-Funktionen

## Design (Folio)
Referenz: `design/folio-reference.png`.

- **Farben (ab v74: Apple-Systemfarben, Wunsch des Betreibers „wie aus dem App Store“)** (Tokens in `style.css` →
  `:root`): Flächen, Text und Trenner folgen Apples Systemfarben — hell Weiß / `#F2F2F7` (Seitenleiste, gruppierte
  Dialoge) / `#E5E5EA`, Text `#1C1C1E`, Nebentext `rgba(60,60,67,.8)`; dunkel echtes Schwarz, Flächen `#1C1C1E` /
  `#2C2C2E` / `#3A3A3C`, Seitenleiste `#121214` (hebt sich von der Editor-Kopfzeile ab, damit Tabs lesbar bleiben),
  Text Weiß, Nebentext `rgba(235,235,245,.7)`. **Eine** Akzentfarbe für alles Bedienbare: Folio-Blau `#3E6E9F`
  (dunkel `#8FB4DD`) — Knöpfe, Symbole der Seitenleiste, Kopfzeilen-Symbole, Auswahl, aktive Werkzeuge. Die
  gewählte Zeile der Seitenleiste ist mit dem Akzent gefüllt (weiße Schrift) wie in iPadOS. Löschen in Apple-Rot
  (hell die kontraststarke Variante `#D70015`, dunkel `#FF453A`); die alte Regel „kein Rot in der Oberfläche“ gilt
  nicht mehr. Schalter grün (`#34C759` / `#30D158`). Apples durchscheinende Füllungen `--fill` / `--fill-2` für
  Suchfeld, Segmentschalter und graue Knöpfe; `--seg-on` für das gewählte Segment. Die Markenfarben (Ink Navy, Sage,
  Mist, Stone, Ivory) bleiben für Logo, Heft-Einbände, Ordner, Tinten und den Lern-Hero — Inhalt, nicht Bedienung.
- **Bedienelemente (ab v74):** Nebenknöpfe (`.pill-btn`) sind Apples graue Knöpfe: Akzent-Schrift auf `--fill`, ohne
  Rahmen; nur die Hauptaktion ist gefüllt. Filter-Tabs, Raster/Liste und alle `.segmented` sind Segmentschalter
  (graue Kapsel, gewähltes Segment hell mit Schatten). Suchfeld grau gefüllt ohne Rahmen. Menüs und Popover aus
  Milchglas (`--menu-bg` + `backdrop-filter`, bei „Transparenz reduzieren“ deckend). Gruppierte Kästen, Listen und
  Auswahllisten ohne Rahmen, wie gruppierte Zellen in iOS. Großer Titel fett (700). Auf dem Handy liegen die
  Filter-Tabs in `.filter-scroll` (sonst `display: contents`), damit der Segmentschalter als Ganzes seitlich scrollt
  statt seine Segmente in der grauen Kapsel abzuschneiden. Gesperrte Knöpfe stehen auf 45 % Deckkraft (vorher 30–35 %,
  kaum erkennbar). Karten haben Rand **oder** Schatten, nicht beides (der Lernen-Leerzustand nur noch Rand).
- **Symbole (ab v74):** eigene Zeichnungen im Stil der SF Symbols in `js/icons.js` (runde Enden, Strich 1,7, großzügige
  Eckenradien, gefüllte Varianten für Stern/Lesezeichen). Die echten SF Symbols werden bewusst nicht verwendet: Apples
  Lizenz erlaubt sie nur in Software für Apple-Plattformen. Überarbeitet wurden u. a. Zahnrad, Ordner, Papierkorb,
  Teilen, Dokument, Seite hinzufügen, Kalender, Stift, Radierer, Textmarker, Bild, Kopieren, Einsetzen, Umbenennen,
  Suche, Uhr, Stern, Lesezeichen, Pfeile; die übrigen folgten schon demselben Stil und wurden nur angeglichen.
- **Schrift (ab v72):** Systemschrift (`-apple-system`, also SF auf iPad/Mac, Segoe UI auf Windows): wirkt nativ,
  folgt der Systemeinstellung und lädt nichts von Google. Vorher Inter über Google Fonts. Feste Größenskala
  11 · 12 · 13 · 14 · 15 (Fließtext) · 16 · 17 · 20 · 22 · 28 · 34 px, Gewichte 500/600/700; ausgenommen ist nur der
  Inhalt von Textdokumenten (`.td-content`).
- **Logo:** `folio-mark.svg` — drei gefächerte Papierlagen (Mist, Sage, Navy) mit gefalteter Ecke, eigene Zeichnung.
  Daraus erzeugt: `apple-touch-icon.png`, `icon-192/512.png`, `favicon.png`, `logo.png`. Im dunklen Design wird die
  vordere Lage hell (`--logo-front`).
- **Bibliothek:** Seitenleiste (Alle Notizen, Zuletzt geöffnet, Favoriten, Papierkorb, Kalender, Ordner mit Farbe/Symbol,
  Sync + Einstellungen), Titel mit Suchfeld und rundem „+“, Filter-Tabs (Alle / Notizbücher / Textdokumente / Ordner),
  Sortierung, Raster/Liste, Karten mit Vorschau, Titel, Datum und „···“-Menü.
- **Editor (ab v51, wie Goodnotes):** eine Kopfzeile: links Zurück, Ordner / Titel, Seitenübersicht, Suche,
  Lesezeichen · mittig die Werkzeuge: Zeichnen (Stift, Textmarker, Radierer, Lasso, Formen) · Inhalt (Text, Bild) ·
  Präsentation (Laser, Screenshot) · rechts Seite hinzufügen, Exportieren, Mehr. Rückgängig/Wiederholen schweben
  oben links über der Seite (`#undoPill`); die Einstellungen des aktiven Werkzeugs in einer eigenen, andockbaren
  Detailleiste.
- **Texte:** Hinweise beschreiben, was passiert und was der Nutzer tun kann, ohne interne Begriffe (kein Modellname,
  keine „Rohdaten“). Begriffe: **Sync-Vergleichskopie** (früher „Sync-Abgleichstand“) = der zuletzt mit Drive
  abgeglichene Stand im Speicher `bases`. Mengen werden ausgeschrieben („1 Dokument“ / „3 Dokumente“), nicht
  „Dokument(e)“. Der Papierkorb hat keine automatische Leerung: Ein Hinweis über den Einträgen sagt das (mit Sync: gilt
  auf allen Geräten). Endgültiges Löschen nennt den Namen des Objekts und, mit Sync, dass es auch auf den anderen
  Geräten verschwindet. Der Speicherhinweis sagt, dass importierte PDFs als Original-Datei Platz brauchen (seit v50
  keine Seitenbilder mehr).
- **Kontrast:** Text erreicht überall mindestens 4,5:1 (WCAG AA). Ab v74 ist `--text-2` im Hellen
  `rgba(60,60,67,.8)` (≥ 4,7:1 auch auf `--surface-3`; Apples Standardwert `.6` wäre zu schwach), im Dunklen
  `rgba(235,235,245,.7)`. `--text-3` ist **nur für Nicht-Text** (Ränder, Griffpunkte, Skalenstriche, Trenner) und
  erreicht dafür 3:1 (hell `rgba(60,60,67,.6)`, dunkel `rgba(235,235,245,.45)`). Kleine
  Beschriftungen wie Seitenleisten-Label, Such-Platzhalter, Kalenderstunden und `.fc-tag` nutzen `--text-2`; in der
  Lernvorschau sind Wochentage `--text` und Wochenenden `--text-2`.
- **Kalender und Lernen (v74):** Der Kalender springt beim Öffnen (aus einer anderen Ansicht kommend) in der
  aktuellen Woche so, dass die Jetzt-Linie im oberen Drittel steht (abends begrenzt durch das Tagesende); andere
  Wochen starten wie bisher bei 7:00 bzw. dem frühesten Termin. Neuzeichnen innerhalb des Kalenders (Sync, Woche
  wechseln) behält die Scrollposition (`cal.scroll`). Die Spalte „heute“ nutzt `--cal-today`: hell wie `--accent-soft`,
  dunkel nur `.07`, damit sie nicht als harter Block heraussticht. Die Quellen-Legende hat 13 px. Der leere Zustand
  von Lernen zeigt statt eines Icon-Kästchens denselben Kartenstapel wie die Stapel in der Bibliothek, noch leer
  (liniert, `.lp-empty-art`).
- **Absicherung:** „In den Papierkorb“ zeigt 6 s lang einen Toast mit **Rückgängig** (`toast(msg, ms, {label, run})`
  in `js/ui.js`; nur Toasts mit Aktion nehmen Klicks an, alle anderen bleiben `pointer-events: none`). Im Mehr-Menü
  des Editors steht „Seite löschen“ durch einen Trenner von „Seite leeren“ getrennt, wie im Seitenmenü. Die
  Einstellungen haben nur „Fertig“ (alle Schalter wirken sofort; Wischen, Esc und Tippen daneben schließen ebenso).
  Sync-Fehler erscheinen in der Seitenleiste in Klartext (`syncError()` in `js/sync.js`): offline, Anmeldung
  abgelaufen (401), Zugriff verweigert (403), Drive antwortet nicht (429/5xx), Anmeldung abgebrochen oder
  Anmeldefenster blockiert (Fehlertypen von Google Identity Services). Ungetestet mit dem echten Drive.
- **Menüs schlank:** „+“ ist zum Anlegen da (Notizbuch, Schnellnotiz, Textdokument, Karteikarten, Ordner) plus ein
  **Importieren …**, das ein zweites Menü öffnet: PDF oder Goodnotes (eine Dateiauswahl ohne Typfilter; der Inhalt
  entscheidet über `documentKind()`, auch für Goodnotes-Ordner als ZIP), Aus der Zwischenablage, Bild, Karteikarten.
  Im ···-Menü von Notizbüchern und Textdokumenten liegen die Formate unter **Exportieren …** (PDF bzw. PDF (Drucken),
  Goodnotes-Datei). Die Einstellungen zeigen Beta und Diagnose (Handschrift erkennen, Pencil-Aufzeichnung) eingeklappt
  unter **Erweitert** am Ende; während einer Aufzeichnung ist der Abschnitt offen. Der Papierkorb hat keine
  Filter-Tabs und zeigt immer alles.
- **Bibliothek:** Kacheln ohne Rahmen; alle Objekte (Ordner, Cover, Seiten, Stapel) stehen auf einer gemeinsamen
  Grundlinie (ab v72). Neue Ordner sind hellblau `#8EB8E6`; 32 Ordnersymbole.
- **Bewegung (ab v72):** Animationen 110–260 ms. Dialoge (`sheet()`, „Neues Notizbuch“, Vorlagen) folgen beim Ziehen am
  oberen Bereich 1:1 dem Finger, nach oben gedämpft (Rubber-Band); beim Loslassen entscheidet die aus der
  Geschwindigkeit hochgerechnete Endlage (wie iOS: `v/1000 · d/(1−d)`, d = 0,99) über Schließen oder Zurückfedern
  (kritisch gedämpfte Feder, jederzeit wieder greifbar). Schließen spiegelt das Öffnen: Dialoge fahren nach unten,
  Menüs schrumpfen zum auslösenden Knopf. `prefers-reduced-motion`: nur kurze Überblendungen, kein Schieben/Skalieren.
