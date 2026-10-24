# Lern-Tools mit Klassencode – Anleitung

Öffentliche Adresse: https://jab-schule.github.io/lern-tools/
Lehrerseite: https://jab-schule.github.io/lern-tools/lehrer.html

## Was wo liegt

| Datei / Ordner | Zweck |
|---|---|
| `index.html` | Startseite für Schüler: Liste der Tools, optional Feld für den Klassencode |
| `lehrer.html` | Anmeldung, Stunde starten/beenden, Link, QR-Code, Beameransicht, Live-Übersicht |
| `klassencode.js` | gemeinsamer Baustein für alle Tools |
| `config.js` | Supabase-Projektadresse und öffentlicher Schlüssel |
| `tools.json` | Liste der Tools |
| `supabase/setup.sql` | Tabelle, Zugriffsregeln, Funktionen (einmalig in Supabase ausführen) |
| `vendor/supabase.js` | Supabase-Bibliothek 2.118.0 (MIT-Lizenz), lokal statt über ein CDN |
| `vendor/qrcode.js` | QR-Code-Bibliothek von Kazuhiko Arase (MIT-Lizenz), nur für die Lehrerseite |
| `reaktionsgleichungen/` | erstes Tool: Lernpfad Reaktionsgleichungen |

Schriften: Es werden nur Systemschriften verwendet. Es gibt keine Verbindungen zu Google Fonts, CDNs oder anderen Diensten außer GitHub Pages und Supabase.

---

## 1. Supabase einrichten (einmalig, ca. 15 Minuten)

Die Menünamen in Supabase ändern sich gelegentlich. Wenn ein Punkt anders heißt, ist er meist in der Nähe zu finden.

### 1.1 Projekt anlegen
1. Auf https://supabase.com anmelden und **New project** wählen.
2. Name: z. B. `lern-tools`. Ein sicheres Datenbank-Passwort vergeben und sicher aufbewahren (wird im Alltag nicht gebraucht).
3. **Region: Central EU (Frankfurt)** auswählen.
4. **Create new project** klicken und warten, bis das Projekt bereit ist.

### 1.2 Registrierung abschalten
1. Links **Authentication** → **Sign In / Providers** (bzw. **Providers**).
2. **Allow new users to sign up** ausschalten und speichern.
3. Der Anbieter **Email** bleibt eingeschaltet (damit die Anmeldung mit E-Mail und Passwort funktioniert).

### 1.3 Lehrerkonto anlegen
1. **Authentication** → **Users** → **Add user** → **Create new user**.
2. E-Mail-Adresse und ein starkes Passwort eingeben.
3. **Auto Confirm User** einschalten und **Create user** klicken.

### 1.4 Datenbank vorbereiten
1. Links **SQL Editor** → **New query**.
2. Den gesamten Inhalt von `supabase/setup.sql` hineinkopieren.
3. **Run** klicken. Unten sollte „Success. No rows returned“ stehen.
   Hinweise der Art „policy … does not exist, skipping“ sind beim ersten Ausführen normal.

Das Skript kann bei Bedarf erneut ausgeführt werden; es überschreibt nur die eigenen Funktionen und Regeln.

### 1.5 Live-Zählung absichern
1. Links **Realtime** → **Settings** (je nach Version auch unter **Project Settings** → **Realtime**).
2. **Allow public access** ausschalten und speichern.

Damit sind nur noch private Kanäle erlaubt, und die Zugriffsregeln aus `setup.sql` prüfen bei jeder Anmeldung eines Schülergeräts, ob der Code zu einer laufenden Stunde gehört.

### 1.6 Adresse und Schlüssel für config.js
1. **Project Settings** → **API Keys** (bzw. **Data API** / **API**).
2. Notieren:
   - **Project URL**, z. B. `https://abcdefghijkl.supabase.co`
   - den **anon public** key aus dem Reiter „Legacy anon, service_role API keys“. Er beginnt mit `eyJ…`.

   Der neue **publishable key** (`sb_publishable_…`) genügt **nicht**: Er ist kein JWT, und private Realtime-Kanäle brauchen einen JWT mit der Rolle `anon`. Mit ihm funktioniert zwar die Codeprüfung, die Live-Zählung aber nicht.
3. **Niemals** den `service_role` key bzw. `secret` key verwenden oder weitergeben.

Beide Werte an Claude geben oder selbst in `config.js` eintragen:

```js
window.LERN_TOOLS_CONFIG = {
  supabaseUrl: "https://abcdefghijkl.supabase.co",
  supabaseKey: "eyJhbGciOiJIUzI1NiIs..."
};
```

Der anon key ist öffentlich und darf im Repository stehen. Er erlaubt nur, was die Zugriffsregeln zulassen.

---

## 2. Bedienung im Unterricht

1. `lehrer.html` öffnen und anmelden (die Anmeldung bleibt in diesem Browser gespeichert, bis „Abmelden“).
2. Tool auswählen → **Stunde starten**. Es erscheinen Code, Link und QR-Code.
3. **Beameransicht** zeigt Code und QR-Code groß; mit „Beameransicht schließen“ oder der Esc-Taste zurück.
4. Schüler scannen den QR-Code oder öffnen die Startseite und tippen den Code ein und wählen dann das Tool.
5. In der **Live-Übersicht** steht, wie viele Geräte verbunden sind und an welcher Station sie arbeiten, dazu die Summen der gelösten Übungen und der Fehlversuche. Unter „Einzelne Geräte (anonym)“ sind die Geräte nur durchnummeriert.
6. **Stunde beenden** macht den Code sofort ungültig. Spätestens nach 90 Minuten läuft er von selbst ab.
   Schülergeräte prüfen den Code alle 5 Minuten erneut und trennen sich dann automatisch.

Ein Schülergerät meldet nur: Tool-Kurzname, Station, Anzahl gelöster Übungen und Anzahl der Fehlversuche (beides nur aus dem Speicher dieses Geräts). Unten rechts im Tool erscheint ein kleiner Hinweis, ob eine Verbindung zur Klasse besteht.

Ohne Code (oder mit ungültigem Code) funktioniert jedes Tool vollständig und nimmt keinen Kontakt zu Supabase auf; die Supabase-Bibliothek wird dann nicht einmal geladen.

---

## 3. Sicherheit und Datenschutz im Überblick

- Codes anlegen und beenden geht nur über die Datenbankfunktionen `stunde_starten` und `stunde_beenden`, die ausschließlich für angemeldete Konten freigegeben sind. Die Tabelle `sitzungen` ist für Schülerseiten vollständig gesperrt.
- Schülerseiten können nur `code_gueltig(code, tool)` aufrufen und erhalten Ja oder Nein.
- Die Live-Zählung läuft über private Realtime-Kanäle `klasse:<CODE>`. Zugriffsregeln auf `realtime.messages` lassen Schülergeräte nur in Kanäle laufender Stunden und nur für Presence (keine Broadcast-Nachrichten). Die Lehrkraft kann nur Kanäle ihrer eigenen Stunden lesen.
- Der Code steht hinter dem `#` der Adresse und wird deshalb nicht an GitHub Pages übertragen.
- Gespeichert wird in Supabase nur: Code, Tool, Zeitpunkte, Konto der Lehrkraft. Keine Schülerdaten, kein Fortschritt.
- Presence-Daten existieren nur, solange das Tool geöffnet ist.
- Lernfortschritt bleibt im Browser des Schülers (`localStorage`).

---

## 4. Ein neues Tool anschließen

1. Ordner `<tool-kurzname>/` mit `index.html` anlegen (Kurzname: Kleinbuchstaben, Ziffern, Bindestrich).
2. Im Tool einbinden:

```html
<script src="../config.js"></script>
<script src="../klassencode.js"></script>
<script>
  Klassencode.start("<tool-kurzname>");
  // bei jedem Stationswechsel:
  Klassencode.position("Station 4");
  // optional mit Zählern (werden auf der Lehrerseite summiert):
  Klassencode.position("Station 4", { richtig: 7, falsch: 2 });
</script>
```

3. Eintrag in `tools.json` ergänzen:

```json
{
  "kurzname": "<tool-kurzname>",
  "name": "Anzeigename",
  "pfad": "<tool-kurzname>/",
  "fach": "Chemie",
  "beschreibung": "Ein Satz für die Startseite.",
  "positionen": ["Station 1", "Station 2"]
}
```

`fach`, `beschreibung` und `positionen` sind optional. `positionen` legt die Zeilen der Live-Übersicht fest, auch wenn dort gerade niemand arbeitet.

An Supabase ändert sich dabei nichts.

---

## 5. Fehlersuche

| Beobachtung | Ursache / Lösung |
|---|---|
| Lehrerseite: „config.js enthält noch keine Supabase-Adresse“ | `config.js` ausfüllen (Abschnitt 1.6) |
| Anmeldung schlägt fehl | Konto unter Authentication → Users vorhanden und bestätigt? Passwort korrekt? |
| „Stunde starten“ meldet einen Fehler | `setup.sql` vollständig ausgeführt? |
| Tool: „Klassencode ungültig oder abgelaufen“ | Stunde beendet, 90 Minuten vorbei oder Code gehört zu einem anderen Tool |
| Live-Übersicht bleibt bei „Verbindung gestört“ | Realtime-Regeln aus `setup.sql` vorhanden? Seite neu laden |
| Tool: „Live-Verbindung gestört (Unauthorized …)“ | In `config.js` steht der publishable key statt des anon key (Abschnitt 1.6), oder das Gerät nutzt noch eine alte `klassencode.js` (siehe nächste Zeile) |
| Eine Änderung wirkt auf einem Gerät noch nicht | GitHub Pages lässt Browser Dateien bis zu 10 Minuten zwischenspeichern. Warten oder zum Test ein privates Browserfenster nutzen |
| Live-Übersicht zeigt 0, obwohl Schüler verbunden sind | Schüler haben den Link ohne `#CODE` geöffnet; Hinweis unten rechts im Tool prüfen |
