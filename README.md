# Chat-Übersicht

Ein Mod für die Claude-Desktop-App (Code-Tab). Er zeigt rechts in einer eigenen Spalte alle Chats, die gerade arbeiten oder in den letzten drei Stunden gearbeitet haben.

- **Blauer Punkt:** Der Chat arbeitet. Darunter steht kurz, woran: der aktuelle Schritt seiner Aufgabenliste, zum Beispiel „Build hochladen · 2/4“. Meldet er keinen Schritt, steht dort der erste Satz seiner letzten Meldung.
- **Oranger Punkt:** „Wartet auf dich“. Der Chat hat dir eine Frage gestellt.
- **Grüner Punkt:** „✓ Fertig“ mit der Uhrzeit.
- Unterchats stehen eingerückt unter ihrem Hauptchat.
- Ein Klick auf einen Chat-Namen öffnet diesen Chat.
- Ist die Spalte zu, holst du sie mit `/chats` zurück.

## Voraussetzungen

- Claude-Desktop-App mit dem Code-Tab, aktuelle Version. Die Liste der Chats kommt aus der App. In Claude Code im Terminal funktioniert die Übersicht nicht.
- Den genauen Schritt zeigt ein Chat nur, wenn der Mod in ihm geladen ist. Chats, die schon vor der Installation liefen, bekommen ihn nach einem Neustart der App (Cmd+Q, dann wieder öffnen).

## Installieren

Die Desktop-App kann im Code-Tab keinen Marketplace aus GitHub hinzufügen. Das geht mit zwei Befehlen im Terminal. Ein GitHub-Konto brauchst du dafür nicht.

1. Öffne das Terminal: Cmd+Leertaste drücken, „Terminal“ tippen, Enter.
2. Kopiere diesen Befehl hinein und drück Enter. Er meldet den Marketplace an:

   ```bash
   claude plugin marketplace add mrkleinfeld/chat-uebersicht
   ```

3. Dann diesen Befehl, er installiert den Mod für alle deine Chats:

   ```bash
   claude plugin install chat-uebersicht@carsten-mods
   ```

   Beide Befehle sollten mit „✔ Successfully …“ antworten.
4. Beende die Claude-App mit Cmd+Q und öffne sie wieder.
5. Öffne einen Chat im Code-Tab. Rechts erscheint die Spalte „Chats“. Falls nicht, tipp `/chats` ins Eingabefeld und drück Enter.

Meldet das Terminal „command not found: claude“, fehlt Claude Code im Terminal. Installiere es mit dem offiziellen Befehl und mach danach mit Schritt 2 weiter:

```bash
curl -fsSL https://claude.ai/install.sh | bash
```

Ohne Terminal: Bitte Claude in einem Chat im Code-Tab, die beiden Befehle aus Schritt 2 und 3 auszuführen, und bestätige die Rückfrage.

Zeigt `claude plugin list` im Terminal bei einer älteren Claude-Code-Version „failed to load“, ist das kein Problem. Die Desktop-App lädt den Mod trotzdem.

### Updates

Neue Fassungen holst du mit:

```bash
claude plugin marketplace update carsten-mods
claude plugin update chat-uebersicht@carsten-mods
```

Danach die App neu starten.

## Was der Mod auf deinem Computer tut

- Er fragt alle paar Sekunden die Chat-Liste der Desktop-App ab.
- Jeder Chat, in dem der Mod läuft, legt seinen aktuellen Schritt in einer kleinen Datei unter `~/.claude/chat-uebersicht/` ab. So sehen die anderen Chats, woran er arbeitet.
- Für Chats ohne Schritt liest er die letzten Einträge ihres Verlaufs, um den ersten Satz der letzten Meldung zu zeigen.
- Er schickt nichts ins Internet.

Hinweis: Mods nutzen eine frühe Schnittstelle von Claude Code. Nach einem Update der App kann es sein, dass der Mod angepasst werden muss.
