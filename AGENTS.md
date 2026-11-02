# Hinweise für KI-Agenten (Claude, Codex, …)

Folio ist eine Notiz-PWA (Vanilla-JS, ES-Module, kein Build-Schritt), ausgeliefert über GitHub Pages aus diesem
Repository. Der Betreiber nutzt sie täglich auf dem iPad mit Apple Pencil und am PC.

## Vor jeder Änderung
1. **`docs/TECHNIK.md` lesen**, mindestens den Abschnitt **„Bewusst so gebaut – nicht zurückbauen“**. Dort steht,
   warum Dinge so gebaut sind, wie sie sind. Jeder Punkt behebt ein echtes Problem auf dem iPad; wer ihn
   „vereinfacht“, holt den Fehler zurück.
2. Beim Ändern `docs/TECHNIK.md` mitpflegen: neue Funktionen, Gründe für Entscheidungen, Grenzen, was nicht getestet
   ist. Die kurze `README.md` ist die öffentliche Startseite des Betreibers; sie nicht ersetzen.

## Regeln des Betreibers
- Antworten auf Deutsch.
- Keine Commits, Pushes oder Änderungen an der Veröffentlichung ohne seine Bestätigung.
- Keine zusätzlichen Server, Proxys oder kostenpflichtigen Dienste ohne seine Zustimmung.
- Externe Schnittstellen nur nach aktueller offizieller Dokumentation; keine APIs erfinden.
- Keine nicht angefragten Zusatzfunktionen.
- Bei jeder veröffentlichten Änderung `APP_VERSION` in `js/store.js` und `CACHE` in `sw.js` gemeinsam erhöhen.
- Persönliche Kalender-Adressen (ICS) und Zugangsdaten nie in Code, Beispieldaten oder Logs.
- Ehrlich berichten, was getestet wurde und was nicht (vor allem: echtes iPad, echtes Google Drive).

## Testen
Lokal mit einem statischen Server im Repository-Ordner (z. B. `serve.ps1` des Betreibers); im Browser auch in
iPad-Größe (1180×820 quer, 820×1180 hoch) und in Hell und Dunkel prüfen.
