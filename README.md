# HandwerkPro

Branchenneutrale Handwerkersoftware für **Gas & Wasser, Elektro, Dach, SHK und alle weiteren Gewerke**:
Kunden, Objekte, Aufträge, Angebote, Einsatzplanung, Materiallager, Wartungsverträge, Rechnungen und
Mahnwesen – plus **Techniker-App mit Zeiterfassung, Baustellenfotos (Vorher/Nachher), Berichten und
deutscher Sprachsteuerung**.

Läuft **komplett lokal** auf deinem Rechner oder Server. Keine Cloud, kein Abo, keine externen
Laufzeitabhängigkeiten. Alle Daten liegen in einer SQLite-Datei, die du einfach kopieren kannst.

---

## Schnellstart

Voraussetzung: **Node.js 24 (LTS) oder neuer** ([nodejs.org](https://nodejs.org)).

```bash
npm start
```

Danach im Browser öffnen: **http://localhost:3000**

Unter Windows kannst du auch **`start.bat`** doppelklicken – das startet den Server und öffnet den Browser.

```bash
npm run dev            # Server mit automatischem Neustart bei Code-Änderungen
npm test               # automatisierte Tests (Rollen, Zeiten, Berichte, Fotos, API)
npm run reset -- --yes # Demo-Daten zurücksetzen (löscht alle Daten!)
```

### Demo-Zugänge

Beim ersten Start werden Demo-Benutzer für jede Rolle angelegt:

| Benutzername | Passwort | Rolle |
|---|---|---|
| `chef` | `chef123` | Chef / Inhaber – alle Rechte |
| `vorgesetzt` | `vorgesetzt123` | Vorgesetzte/r – Aufträge, Team, Freigaben |
| `buero` | `buero123` | Büro – Kunden, Aufträge, Rechnungen, Lager |
| `monteur` | `monteur123` | Monteur / Techniker – eigene Aufträge, Zeiten, Berichte, Fotos |
| `azubi` | `azubi123` | Monteur / Techniker (Auszubildender) |
| `hr` | `hr123` | Personal / HR – Mitarbeiter und Zeiten |

> Passwörter können in der App über **„Passwort ändern"** geändert werden. Für den produktiven Einsatz
> die Demo-Konten anpassen oder löschen.

---

## Rollen & Rechte

Die Rechte sind als feste Matrix in `src/permissions.js` hinterlegt und werden serverseitig **bei jedem
API-Aufruf** geprüft. Das Frontend blendet zusätzlich nicht erlaubte Bereiche aus.

| Bereich | Chef | Vorgesetzt | Büro | Monteur | HR |
|---|:--:|:--:|:--:|:--:|:--:|
| Übersicht / Dashboard | ✓ | ✓ | ✓ | eigene | HR-Ansicht |
| Aufträge | alle | alle | alle | **nur eigene** | – |
| Preise / Rechnungen | ✓ | ✓ | ✓ | – | – |
| Kunden & Objekte | ✓ | ✓ | ✓ | eigene Kunden | – |
| Planung | ✓ | ✓ | ✓ | eigene Termine | – |
| Lager | ✓ | ✓ | ✓ | nur Bestand | – |
| Berichte | alle | alle + Freigabe | alle | **nur eigene** | alle (lesen) |
| Fotos | alle | alle | alle | eigene Aufträge | – |
| Zeiten | alle | alle | alle | **nur eigene** | alle |
| Mitarbeiter | ✓ | ✓ | lesen | lesen | ✓ |
| Benutzerkonten | ✓ | – | – | – | – |
| Einstellungen | ✓ | – | – | – | – |

Der Chef hat als einzige Rolle das Wildcard-Recht `*`. Alle anderen Rollen erhalten klar abgegrenzte
Einzelrechte – z. B. sieht ein Monteur **keine Preise, Rechnungen oder Finanzkennzahlen**.

---

## Techniker-App (mobil)

Die Web-App ist für alle Mobilgeräte optimiert (responsive, große Touch-Flächen, Bottom-Navigation,
PWA-installierbar). Monteure landen direkt auf **„Mein Tag"**:

- **Stempeluhr**: Ein-/Ausstempeln mit einem Tap, laufende Zeit, Tages- und Wochensumme
- **Meine Aufträge**: Kunde, Objekt, Adresse, Termin, Status; Route per Google Maps
- **Bericht schreiben**: Typ, Wetter, Stunden, Berichtstext – direkt im Formular per **Mikrofon
  diktierbar** oder über „Bericht" per Sprache geöffnet (das Mikrofon startet dann automatisch)
- **Material automatisch erfassen**: aus dem gesprochenen/geschriebenen Text werden Menge, Einheit und
  passender Lagerartikel erkannt (z. B. „3 Meter Kupferrohr und 2 Stück Dichtungen")
- **Baustellenfotos**: Kamera oder Galerie – **einzelne oder mehrere Bilder** in einem Schritt; alle
  werden clientseitig verkleinert und am Auftrag archiviert
- **Vorher-Nachher-Vergleich**: Slider direkt im Auftrag und im Bericht, beliebig viele Paare
- **Berichtsfreigabe**: Vorgesetzte/Chef geben Berichte frei und übernehmen das Material per Klick in
  den Auftrag (inkl. Lagerbuchung)
- **Zeiterfassung**: eigene Zeiten ansehen, nachtragen und korrigieren

### Bericht zu einem Auftrag erstellen

Es gibt vier Wege – alle führen zum selben Berichtseditor:

1. **Auftrag öffnen** → Button **„Bericht"** in den Schnellaktionen.
2. **Mein Tag** → bei der Auftragskarte auf **„Bericht"** tippen.
3. **Seite „Berichte"** → **„Neuer Bericht"** → Auftrag aus der Liste wählen.
4. **Sprache**: „Bericht" oder „Bericht für Müller" – wird der Auftrag gefunden, öffnet sich das
   Formular und das Mikrofon startet direkt für das Diktat.

Im Formular kannst du den Text tippen oder auf **„Diktieren"** tippen und sprechen. Material wird beim
Speichern automatisch aus dem Text erkannt; anschließend lassen sich im Bericht beliebig viele Fotos
ergänzen.

---

## Sprachsteuerung

Über den Mikrofon-Button (Sidebar, Bottom-Nav oder schwebender Button) lassen sich Befehle sprechen:

| Befehl (Beispiel) | Aktion |
|---|---|
| „Öffne Auftrag AU-2026-0001" | Auftrag über Nummer öffnen |
| „Auftrag Müller" / „Königsallee 42" | Auftrag über Kunde, Name oder Straße suchen |
| „Bericht" / „Bericht für Müller" | Berichtseditor öffnen – Diktat startet automatisch |
| „Einstempeln" / „Ausstempeln" | Zeiterfassung starten bzw. stoppen |
| „Foto vorher" / „Foto nachher" | Kamera für das Baustellenfoto öffnen |
| „Material 3 Meter Kupferrohr" | Material im offenen Bericht erfassen |

Die Erkennung nutzt die **Web Speech API** des Browsers (Deutsch). Bei mehreren Treffern erscheint eine
Auswahlliste. Rückmeldungen werden zusätzlich per Sprachausgabe (SpeechSynthesis) gesprochen.

**Wichtig für Mobilgeräte:** Mikrofonzugriff ist nur in **sicheren Kontexten** erlaubt – also über
**HTTPS** oder auf `localhost`. Im normalen WLAN per `http://192.168.x.x` verweigern die meisten
Mobilbrowser das Mikrofon. Für Tests vor Ort gibt es deshalb immer die **Texteingabe als Fallback**.

### HTTPS aktivieren

```bash
# Beispiel mit selbstsigniertem Zertifikat (OpenSSL)
openssl req -x509 -newkey rsa:2048 -nodes -keyout key.pem -out cert.pem -days 365 \
  -subj "/CN=handwerkpro.local"

HTTPS_KEY=./key.pem HTTPS_CERT=./cert.pem PORT=3443 npm start
```

Danach `https://<server-ip>:3443` öffnen und das Zertifikat im Browser akzeptieren. Im Produktivbetrieb
besser ein echtes Zertifikat (z. B. Reverse Proxy mit Let's Encrypt) verwenden.

---

## Was das System kann

### Automatik

| Vorgang | Auslöser | Ergebnis |
|---|---|---|
| **Auftrag aus Wartungsvertrag** | Vertrag ist fällig | Auftrag inkl. Leistungen und Termin wird angelegt, nächste Fälligkeit berechnet |
| **Rechnung aus Auftrag** | Auftrag wird auf „Erledigt" gesetzt | Rechnung mit fortlaufender Nummer, Positionen, Steuer, Zahlungsziel und **PDF** |
| **Mahnung** | Rechnung ist länger als `dunning_days` überfällig | Zahlungserinnerung/Mahnung inkl. PDF, Mahnstufe wird erhöht |
| **Material aus Bericht** | Freigabe + „Material übernehmen" | Positionen landen im Auftrag, Lager wird gebucht |

Die Automatik läuft beim Serverstart und danach **alle 5 Minuten** im Hintergrund. Zusätzlich gibt es
überall den Button **„Automatik"**, um sie sofort auszuführen.

### Aufträge & Angebote

- Automatische Nummernkreise (`AU-2026-0001`, `AN-2026-0001`) – Präfixe konfigurierbar
- Kunde, Objekt, Monteur, Termin, Priorität und Beschreibung
- Positionen: Arbeitszeit, Material aus dem Lager oder freie Pauschale
- Status: Neu → Geplant → In Arbeit → Erledigt → Abgerechnet (oder Storniert)
- Angebot → Auftrag mit einem Klick umwandeln
- PDF-Ausgabe für Auftrag und Angebot
- Monteure sehen nur ihre Aufträge und keine Preise

### Rechnungen & Mahnwesen

- Automatische oder manuelle Rechnungserstellung aus Aufträgen
- Fortlaufende, jahresbezogene Rechnungsnummern
- Pflichtangaben nach § 14 UStG (Leistungsdatum, Steuernummer/USt-IdNr., Netto/Steuer/Brutto, Zahlungsziel)
- Zahlungen erfassen (auch Teilzahlungen), offene Beträge, Überfälligkeiten
- Mahnungen mit Mahnstufe und PDF, Storno, CSV-Export für die Buchhaltung

### Kunden & Objekte

- Firmen- und Privatkunden mit Ansprechpartner, Anrede, Kontaktdaten und Notizen
- **Kundennotizen** als Verlauf: jeder Eintrag mit Autor und Zeitstempel, direkt in der Kundenakte
  erfassbar – auch per Sprachdiktat
- Mehrere Objekte pro Kunde (z. B. Gas-/Wasseranschluss, Heizungsart, Zählernummer)
- Kundenakte mit Objekten, Aufträgen, Rechnungen und offenen Beträgen

### Mein Tag

- Persönliche Tagesansicht für **jede Rolle mit Mitarbeiterkonto** – auch Chef und Vorgesetzte
- Eigene Termine des Tages und der nächsten zwei Wochen, inkl. Kundenbesuchen, Meetings,
  Personalgesprächen, Lieferanten- und Fortbildungsterminen
- Kennzahlen passend zur Rolle (offene Aufträge, Berichte zur Freigabe, überfällige Rechnungen)
- Team-Übersicht „Wer ist heute im Einsatz“ (bei Recht `employees.view`)

### Einsatzplanung / Kalender

- Wochenkalender mit allen Terminen, farblich je Monteur
- **Terminarten**: Baustelle, Kundenbesuch, Meeting, Personal/HR, Notdienst, Fortbildung,
  Lieferant, Sonstiges – mit Filter-Chips über dem Kalender
- Termine per Klick in freie Zeitfenster anlegen; Kunde, Auftrag und Ort sind optional
- Monteure sehen nur ihre eigenen Termine, Büro/Chef/Vorgesetzte alle
- **Terminbestätigung per Link**: Ein Klick erzeugt einen persönlichen Link
  (`/termin/<token>`), den der Kunde ohne Anmeldung öffnen kann. Er bestätigt den Termin oder
  meldet zurück, dass er nicht passt – optional mit Wunsch oder Begründung. Der Status
  (offen / bestätigt / abgelehnt) ist im Kalender und im Termin sichtbar; der Link lässt sich
  direkt per E-Mail-Programm versenden.

  Der Link enthält einen zufälligen Token (48 Hex-Zeichen) und gilt nur für diesen einen Termin.
  Er ersetzt keine Termineinladung per Post – bitte nur an den Kunden selbst weitergeben.
  E-Mails werden **nicht** automatisch versendet: der E-Mail-Button öffnet das lokale
  Mailprogramm mit fertigem Text, damit kein SMTP-Zugang nötig ist.

### Material & Lager

- Artikel mit Kategorie, Einheit, EK/VK, Bestand und Mindestbestand
- Wareneingang, Entnahme und Korrekturen mit Lagerhistorie
- Warnungen bei Unterschreitung des Mindestbestands
- Automatische Abbuchung bei Rechnungserstellung und bei Berichtsmaterial

### Wartungsverträge

- Wiederkehrende Intervalle (z. B. alle 6 oder 12 Monate)
- Hinterlegte Leistungen mit Menge, Einheit und Preis
- Automatische oder manuelle Auftragserzeugung, Fälligkeitsübersicht

### Einstellungen

- **Marke & Gewerk**: App-Name, Branche und Untertitel frei konfigurierbar
- Firmendaten, Steuernummer, USt-IdNr., Handelsregister, Bankverbindung
- Nummernkreise, Zahlungsziel, Stundensatz, Rechnungstexte
- Automatik einzeln schaltbar, Mahnfrist und Mahngebühr
- Teamverwaltung, Benutzerkonten und Rollen (Chef)
- CSV-Exporte für Kunden, Aufträge, Rechnungen und Lager

---

## PWA & Offline

`manifest.webmanifest`, App-Icon und ein Service Worker sind enthalten. Die App lässt sich auf dem
Smartphone zum Homescreen hinzufügen („Zum Startbildschirm hinzufügen"). Die App-Hülle wird gecacht,
**API-Daten werden nie offline gecacht** – Zeiten, Berichte und Fotos gehen also nicht verloren und
werden immer live mit dem Server abgeglichen.

---

## Rechnungs-PDF

Die PDFs werden mit einem eigenen, dependency-freien PDF-Generator erzeugt (A4, Helvetica,
WinAnsi-Kodierung für Umlaute und €). Sie enthalten:

- Absenderblock und Empfängeradresse
- Rechnungsnummer, Rechnungs- und Leistungsdatum, Kundennummer, Auftragsnummer, Fälligkeit
- Positionstabelle mit Menge, Einheit, Einzelpreis und Gesamtpreis
- Zwischensumme, Umsatzsteuer, Gesamtbetrag
- Zahlungsinformationen inkl. IBAN/BIC und Zahlungsziel
- Fußzeile mit Steuernummer, USt-IdNr., Handelsregister und Bankverbindung

Erzeugte Rechnungs-PDFs werden zusätzlich unter `data/dokumente/` archiviert.

---

## Anmeldung, Daten & Backup

- Anmeldung per Benutzername/Passwort; Passwörter mit **scrypt** gehasht
- Sessions als **HttpOnly-Cookie** (`hp_session`, 30 Tage, `SameSite=Lax`, bei HTTPS zusätzlich `Secure`)
- Einfache Brute-Force-Bremse nach 10 Fehlversuchen pro IP
- Datenbank: `data/gaswasser.db` (SQLite, WAL-Modus)
- PDF-Archiv: `data/dokumente/`, Fotos: `data/fotos/`
- **Backup:** den kompletten `data`-Ordner kopieren – am besten bei gestopptem Server
- Es werden keine Daten nach außen gesendet. Kein Cloud-Dienst, keine Telemetrie.

> Hinweis: Das System ist eine praktische Hilfe, keine Rechts- oder Steuerberatung. Rechnungsform und
> Aufbewahrungspflichten (GoBD) solltest du mit deinem Steuerberater abstimmen. Für den produktiven
> Einsatz wird empfohlen, regelmäßig Backups zu erstellen.

---

## Projektstruktur

```text
GasWasserPro/
├── server.js               HTTP/HTTPS-Server, statische Dateien, Scheduler
├── start.bat               Windows-Starter
├── src/
│   ├── db.js               Datenbank, Schema, Einstellungen, Nummernkreise
│   ├── seed.js             Demo-Daten, Benutzer, Demo-Zeiten/Berichte/Fotos
│   ├── auth.js             Login, Sessions, Cookies, Passwortwechsel
│   ├── password.js         scrypt-Hashing
│   ├── permissions.js      Rollen und Rechte-Matrix
│   ├── work.js             Materialparser, Fotos, Zeiterfassung
│   ├── api.js              REST-API inkl. Auth- und Rechteprüfung
│   ├── billing.js          Rechnungen, Zahlungen, Mahnungen, Lagerbuchungen
│   ├── automation.js       Automatik (Verträge, Rechnungen, Mahnungen)
│   ├── documents.js        Layout von Rechnung, Mahnung, Auftrag, Angebot
│   └── pdf.js              PDF-Generator ohne externe Bibliotheken
├── public/
│   ├── index.html          App-Gerüst, Login, Navigation
│   ├── app.js              SPA-Logik, Techniker-App, Sprache, Berichte
│   ├── styles.css          Design inkl. Mobile/PWA
│   ├── manifest.webmanifest
│   ├── icon.svg            App-Icon (SVG)
│   ├── icon-192.png        App-Icon für PWA/Android
│   ├── icon-512.png
│   ├── apple-touch-icon.png
│   ├── termin.html         Öffentliche Terminbestätigung für Kunden (/termin/<token>)
│   └── sw.js               Service Worker
├── test/smoke.test.js      Tests
├── scripts/reset.js        Demo-Daten zurücksetzen
└── data/                   Datenbank, PDFs und Fotos (wird automatisch erzeugt)
```

---

## API (Auszug)

Alle Endpunkte außer Login und Meta erfordern eine gültige Session (Cookie). Fehlende Rechte liefern
`403`, fehlende Anmeldung `401`.

```text
POST   /api/auth/login                Anmelden (setzt Cookie)
POST   /api/auth/logout               Abmelden
GET    /api/auth/me                   Aktueller Benutzer, Rechte, laufende Zeit
GET    /api/auth/meta                 App-Name, Gewerk, Rollen, Demo-Hinweise (öffentlich)
POST   /api/auth/password             Passwort ändern

GET    /api/dashboard                 Kennzahlen – rollenabhängig (Chef/Techniker/HR)
GET    /api/orders                    Aufträge (Filter: status, type, q; Monteur: nur eigene)
GET    /api/orders/:id                Auftrag inkl. Positionen, Berichten, Fotos, Zeiten
POST   /api/orders/:id/status         Status setzen (erledigt → ggf. Auto-Rechnung)
GET    /api/orders/:id/pdf            Auftrag/Angebot als PDF

GET    /api/time                      Zeiten (Filter: from, to, employee_id, order_id)
GET    /api/time/running              Laufende Zeiterfassung
POST   /api/time/start                Einstempeln
POST   /api/time/stop                 Ausstempeln
POST   /api/time                      Zeit nachtragen

GET    /api/reports                   Berichte (Filter: status, order_id, employee_id)
POST   /api/reports                   Bericht anlegen (optional Material automatisch erkennen)
GET    /api/reports/:id               Bericht inkl. Material und Fotos
PUT    /api/reports/:id               Bericht bearbeiten
POST   /api/reports/:id/parse         Material aus Text erkennen
POST   /api/reports/:id/approve       Bericht freigeben
POST   /api/reports/:id/apply         Material in Auftrag übernehmen

POST   /api/photos                    Fotos hochladen (Base64; einzeln oder `{ photos: [...] }` für mehrere)
GET    /api/photos                    Fotos eines Auftrags/Berichts (Filter: order_id, report_id, kind)
GET    /api/photos/:id/file           Foto anzeigen
DELETE /api/photos/:id                Foto löschen
GET    /api/voice/search?q=…          Auftragssuche für die Sprachsteuerung

GET    /api/invoices                  Rechnungen (Filter: status, q)
POST   /api/invoices/:id/payments     Zahlung erfassen
POST   /api/invoices/:id/dunning      Mahnung erzeugen
GET    /api/invoices/:id/pdf          Rechnung als PDF (?mahnung=1 für Mahnung)

GET    /api/customers                 Kunden inkl. Kennzahlen
GET    /api/customers/:id             Kunde inkl. Objekten, Aufträgen, Rechnungen und Notizen
GET    /api/customers/:id/notes       Kundennotizen (Autor + Zeitstempel)
POST   /api/customers/:id/notes       Notiz anlegen (Büro/Chef)
DELETE /api/customers/:id/notes/:id   Notiz löschen (Büro/Chef)

GET    /api/my-day                    Eigene Termine, Kennzahlen und Team-Übersicht
GET    /api/appointments              Termine (Filter: from, to; inkl. Terminart, Ort, Kunde)
POST   /api/appointments              Termin anlegen
POST   /api/appointments/:id/confirm-link   Bestätigungslink erzeugen (stabil)
POST   /api/appointments/:id/confirm-reset  Bestätigung zurücksetzen
GET    /api/public/appointments/:token      Öffentlich: Termin für den Kunden
POST   /api/public/appointments/:token/confirm   Kunde bestätigt
POST   /api/public/appointments/:token/decline   Kunde lehnt ab (mit Nachricht)

GET    /api/articles                  Lager
POST   /api/articles/:id/stock        Lagerbuchung
GET    /api/contracts                 Wartungsverträge
POST   /api/contracts/:id/order       Auftrag aus Vertrag erzeugen
GET    /api/users                     Benutzerkonten (Chef)
POST   /api/automation/run            Automatik sofort ausführen
GET    /api/export/rechnungen.csv     CSV-Export (auch auftraege, kunden, lager)
```

---

## Technik

- **Node.js** ≥ 24 (LTS), ES Modules, keine Laufzeit-Abhängigkeiten
- **SQLite** über das eingebaute `node:sqlite` (kein npm-Paket nötig)
- **Vanilla JS** im Frontend, kein Build-Schritt
- **Web Speech API** für Spracheingabe, **SpeechSynthesis** für Rückmeldungen
- **PDF** mit eigenem Generator (`src/pdf.js`)
- **PWA** mit Manifest und Service Worker

Dadurch bleibt das Projekt klein, portabel und langfristig wartbar: Ordner kopieren, `npm start`, fertig.

---

## Mitwirken

Entwickler-Setup, Branch-Regeln und Checklisten stehen in **[CONTRIBUTING.md](CONTRIBUTING.md)**.
Kurzfassung:

```bash
git clone <repo-url>
cd GasWasserPro
npm start     # Demo-Daten werden automatisch angelegt
npm test      # Tests
```

Wichtig: Der Ordner `data/` (SQLite-Datenbank, PDFs, Fotos) ist **nicht** Teil des Repositories –
er wird lokal erzeugt und kann echte Kundendaten enthalten. Bitte niemals einchecken.

Empfohlen nach dem Klonen einmalig den lokalen Schutz für `main` aktivieren:

```bash
git config core.hooksPath .githooks
```
