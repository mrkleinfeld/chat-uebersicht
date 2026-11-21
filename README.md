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

In der Desktop-App: Links neben dem Eingabefeld auf **+** klicken, dann **Plugins**, dann **Marketplace hinzufügen** (Add marketplace) und dort eintragen:

```
mrkleinfeld/chat-uebersicht
```

Danach **Plugin hinzufügen** (Add plugin) und „chat-uebersicht“ wählen.

Oder in einer Terminal-Sitzung von Claude Code, an der Eingabe:

```
/plugin install chat-uebersicht --marketplace mrkleinfeld/chat-uebersicht
```

Oder in der Shell:

```bash
claude plugin install chat-uebersicht --marketplace mrkleinfeld/chat-uebersicht
```

Bei der Frage „Add marketplace?“ mit `y` antworten und den Bereich „user“ wählen. Neue Chats laden den Mod dann von selbst.

## Was der Mod auf deinem Computer tut

- Er fragt alle paar Sekunden die Chat-Liste der Desktop-App ab.
- Jeder Chat, in dem der Mod läuft, legt seinen aktuellen Schritt in einer kleinen Datei unter `~/.claude/chat-uebersicht/` ab. So sehen die anderen Chats, woran er arbeitet.
- Für Chats ohne Schritt liest er die letzten Einträge ihres Verlaufs, um den ersten Satz der letzten Meldung zu zeigen.
- Er schickt nichts ins Internet.

Hinweis: Mods nutzen eine frühe Schnittstelle von Claude Code. Nach einem Update der App kann es sein, dass der Mod angepasst werden muss.
