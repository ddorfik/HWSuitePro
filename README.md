# HandwerkPro

Branchenneutrale Handwerkersoftware für **Gas & Wasser, Elektro, Dach, SHK und alle weiteren Gewerke**:
Kunden, Objekte, Aufträge, Angebote, Einsatzplanung, Materiallager, Wartungsverträge, Rechnungen und
Mahnwesen – inklusive **E-Rechnung (XRechnung/ZUGFeRD)**, **Dokumentenarchiv**, **Plantafel mit
Ressourcen**, **Kalkulation**, **Urlaub-/Arbeitszeitkonten**, **DATEV/Bankabgleich/SEPA**, **Aufmaß,
Unterschrift und Checklisten**, **Inventur** – plus **Techniker-App mit Zeiterfassung,
Baustellenfotos (Vorher/Nachher), Berichten und deutscher Sprachsteuerung**.

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
| E-Rechnung | ✓ | ✓ | ✓ | – | – |
| Dokumente (DMS) | ✓ | ✓ | ✓ | – | ✓ |
| Finanzen (DATEV/Bank/SEPA) | ✓ | ✓ | ✓ | – | – |
| Kalkulation | ✓ | ✓ | ✓ | – | – |
| Kunden & Objekte | ✓ | ✓ | ✓ | eigene Kunden | – |
| Anfragen / CRM-Pipeline | ✓ | ✓ | ✓ | – | – |
| Kundenportal-Links | ✓ | ✓ | ✓ | – | – |
| Aufgaben & Pinnwand | ✓ | ✓ | ✓ | eigene | ✓ |
| Nachrichten | ✓ | ✓ | ✓ | ✓ | ✓ |
| Planung & Plantafel | ✓ | ✓ | ✓ | eigene Termine | – |
| Lager | ✓ | ✓ | ✓ | nur Bestand | – |
| Materialreservierung / Packliste | ✓ | ✓ | ✓ | lesen | – |
| Inventur | ✓ | ✓ | ✓ | – | – |
| Berichte | alle | alle + Freigabe | alle | **nur eigene** | alle (lesen) |
| Fotos | alle | alle | alle | eigene Aufträge | – |
| Zeiten | alle | alle | alle | **nur eigene** | alle |
| GPS-Zeiterfassung | ✓ | ✓ | ✓ | **nur eigene** | ✓ (eigene) |
| Urlaub & Arbeitszeit | ✓ | ✓ | Anträge lesen | **eigener Antrag** | ✓ |
| Personalakte & Verträge | ✓ | ✓ | – | eigene Person | ✓ |
| Lohnvorbereitung | ✓ | ✓ | – | – | ✓ |
| Zeitkategorien | ✓ | ✓ | lesen | lesen | ✓ |
| Mitarbeiter | ✓ | ✓ | lesen | lesen | ✓ |
| Textassistent | ✓ | ✓ | ✓ | – | ✓ |
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
- **Automatische Zeiterfassung per GPS**: optional selbst ein-/ausschaltbar – Zeit startet beim
  Verlassen von Zuhause bzw. bei Ankunft an der Baustelle und stoppt beim Verlassen der Baustelle
  bzw. bei Ankunft zu Hause (Details unten)

### Bericht zu einem Auftrag erstellen

Es gibt vier Wege – alle führen zum selben Berichtseditor:

1. **Auftrag öffnen** → Button **„Bericht"** in den Schnellaktionen.
2. **Mein Tag** → bei der Auftragskarte auf **„Bericht"** tippen.
3. **Seite „Berichte"** → **„Neuer Bericht"** → Auftrag aus der Liste wählen.
4. **Sprache**: „Bericht" oder „Bericht für Müller" – wird der Auftrag gefunden, öffnet sich das
   Formular und das Mikrofon startet direkt für das Diktat.

Im Formular kannst du den Text tippen oder auf **„Diktieren"** tippen und sprechen. Das Diktat bleibt
aktiv und hängt jeden Satz an den Bericht an – auch nach Sprechpausen oder einem Gespräch mit dem
Kunden. Ein erneuter Tipp auf das Mikrofon beendet die Aufnahme; der vorhandene Text wird nie
überschrieben. Material wird beim Speichern automatisch aus dem Text erkannt; anschließend lassen
sich im Bericht beliebig viele Fotos ergänzen.

### Automatische Zeiterfassung per GPS (optional)

Jeder Techniker kann die Funktion selbst unter **„Mein Tag" → GPS-Zeiterfassung** ein- und
ausschalten. Einrichtung:

1. **Zuhause einmessen**: zu Hause auf „Standort einmessen" tippen.
2. **Baustelle einmessen**: im Auftrag (oder auf der Auftragskarte) auf **„Standort"** tippen,
   solange man vor Ort ist. Die Adresse bleibt wie gewohnt hinterlegt; für die Geofence wird
   einmalig die GPS-Position gespeichert.
3. **Radius** einstellen (Standard 150 m, 75–500 m).

Danach gilt:

- Verlassen des Zuhause-Radius → Arbeitszeit startet (ohne Auftrag).
- Ankunft im Baustellen-Radius → die Zeit wechselt automatisch auf diesen Auftrag.
- Verlassen des Baustellen-Radius → die Auftragszeit stoppt.
- Ankunft im Zuhause-Radius → die Arbeitszeit stoppt.
- Bei einer **genehmigten Abwesenheit** (Urlaub/Krankheit) pausiert die Automatik automatisch.
- Manuelles Ein-/Ausstempeln bleibt jederzeit möglich und wird nicht überschrieben; die Automatik
  reagiert nur auf das Betreten/Verlassen der gespeicherten Standorte.

**Wichtig:** Die Standortprüfung läuft nur, solange die App geöffnet ist (Vordergrund). Bei
gesperrtem Bildschirm oder geschlossener App findet keine automatische Erkennung statt – dafür wäre
eine native App nötig. GPS benötigt **HTTPS oder localhost**. Bei jedem automatischen Start/Stopp
wird die Position im Ereignisprotokoll gespeichert; einen dauerhaften Standortverlauf gibt es nicht.
Ereignisse werden nach 180 Tagen automatisch gelöscht. Hausanschrift und Zuhause-Koordinaten sind
nur für HR/Chef/Vorgesetzte und den Mitarbeiter selbst sichtbar.

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

### E-Rechnung: XRechnung & ZUGFeRD

- **XRechnung 3.0** als UBL-2.1-XML und **ZUGFeRD 2.x** (EN 16931, Comfort) als CII-XML
- **ZUGFeRD-PDF**: die Rechnung wird als PDF 1.7 mit eingebettetem CII-XML und XMP-Metadaten
  erzeugt – direkt aus dem Rechnungsdialog herunterladbar
- **Leitweg-ID / Buyer Reference** je Rechnung oder Kunde pflegbar; Rechnungsnummer als Fallback
- Zahlungsart, Ansprechpartner, Fußtext und **§ 19 UStG (Kleinunternehmer)** in den Einstellungen
- Status je Rechnung (`entwurf`, `erzeugt`, `versendet`), automatische PDF-Archivierung im DMS
- Hinweis: Die Dateien sind bewusst konservativ aufgebaut, ersetzen aber **keine formale
  Validierung** mit dem KoSIT-/ZUGFeRD-Prüftool und keine PDF/A-3-Zertifizierung.

### Dokumentenarchiv (DMS, GoBD)

- Ablage für PDF, Bilder, Office-Dateien, XML und CSV unter `data/ablage` (maximal 25 MB je Datei)
- Kategorien (Rechnung, Angebot, Aufmaß, Vertrag, Eingangsrechnung, Steuer …), Kunde/Auftrag/
  Rechnung als Verknüpfung
- **Versionen** mit eigener Datei, SHA-256-Prüfsumme und lückenlosem Verlauf
- **Soft-Delete**: Dateien verschwinden aus der aktiven Ablage, bleiben aber revisionssicher erhalten
- Rechnungs-PDFs werden beim Erzeugen automatisch archiviert
- Eigene Seiten `#/documents` und Projektakte im Auftrag; Zugriff nur mit `documents.view`

### Kalkulation & Nachkalkulation

- Vorgabewerte für **Lohn, Gemeinkosten, Gewinn und Rabatt** (global und je Auftrag)
- Kosten je Position: Lohn, Material, Gerät und Sonstiges; Materialkosten werden aus dem
  Artikel-Einkaufspreis vorbefüllt
- **Zielpreis** je Position und Deckungsbeitrag auf Knopfdruck
- **Nachkalkulation** aus tatsächlich gestempelter Zeit und Materialeinsatz inkl. Abweichung
- „In Positionen übernehmen" schreibt die kalkulierten Verkaufspreise in das LV

### Personal: Urlaub, Abwesenheiten & Arbeitszeit

- Abwesenheiten: Urlaub, Krankheit, Schule/Ausbildung, Fortbildung, unbezahlt, Elternzeit, Sonstiges
- Antrag durch Mitarbeiter, Genehmigung/Ablehnung durch HR/Chef, Wochenenden werden nicht gezählt
- **Urlaubskonto** je Jahr mit Anspruch, genehmigten und beantragten Tagen sowie Resturlaub
- **Arbeitszeitkonto** mit Wochenvergleich (Ist/Soll), Korrekturbuchungen und Saldo
- Eigene Konten für Mitarbeiter, Gesamtübersicht für HR; Integriert in `#/team`

### Zusammenarbeit: Aufgaben, Pinnwand & Benachrichtigungen

- **Aufgaben** mit Titel, Beschreibung, Fälligkeit, Priorität und Zuständigkeit – am Auftrag oder frei
- Monteure sehen und erledigen ihre eigenen Aufgaben; Büro und Chef verteilen sie
- **Benachrichtigungsglocke** für neue Aufgaben, Anfragen, Nachrichten und Terminrückmeldungen
- **Pinnwand / Team-Feed** auf Basis des Aktivitätsprotokolls
- **Nachrichten je Auftrag** zwischen Büro und Monteur, inklusive Push-freier Hinweise in der App

### Anfragen & Kundenportal (CRM)

- **Anfrage-Pipeline** mit konfigurierbaren Stufen (Neu, Kontaktiert, Angebot, Gewonnen, Verloren)
- Quellen: Website, Portale, Telefon, Empfehlung; Wert und interne Notizen je Anfrage
- **Öffentliches Anfrageformular** unter `/anfrage/<Token>` ohne Anmeldung
- Anfrage mit einem Klick in einen **Kunden** umwandeln
- **Kundenportal** unter `/portal/<Token>`: Termine, Aufträge, Rechnungen als PDF und Dokumente;
  Nachrichten an das Büro; Link jederzeit zurückziehbar

### Personal-Erweiterung: Verträge, Pausen & Lohnvorbereitung

- **Arbeitsverträge** (unbefristet, befristet, Minijob, Werkstudent, Ausbildung, Praktikum) mit
  Wochenstunden und Gehalt; Personalakte je Mitarbeiter inklusive Dokumenten
- **Pausenautomatik** nach § 4 ArbZG: 30 Minuten ab 6 Stunden, 45 Minuten ab 9 Stunden
  (einstellbar, standardmäßig aus)
- **Zeitkategorien** frei erweiterbar (Arbeit, Fahrt, Urlaub, Krank, Schule …)
- **Lohnvorbereitung** je Monat mit Brutto-/Netto-Stunden, Pausen, Soll/Ist, Urlaub, Krankheit und
  Gehalt; CSV-Export für das Steuerbüro
- **Mutterschutzfristen** aus dem Entbindungstermin berechnen

### Finanzen: DATEV, Bankabgleich & SEPA

- **Bankimport** aus CSV (gängige Spaltennamen) und **CAMT.053**; Duplikate werden übersprungen
- Automatischer Abgleich über Rechnungsnummer oder passenden Betrag im Zeitfenster
- Manuelle Zuordnung und Verbuchen als Zahlungseingang, inklusive Teilzahlungen
- **DATEV-Buchungsstapel** im EXTF-Format 700 (Debitoren, Erlöse, Umsatzsteuer, Zahlungen);
  Kontenrahmen und Berater-/Mandantennummer sind konfigurierbar
- **SEPA-Überweisung** als `pain.001.001.03` mit IBAN-Prüfziffer, Vorschau und XML-Download
- Eigene Seite `#/finance`; Bankdaten nur für Rollen mit Finanzrecht

### Aufmaß, Unterschrift, Checklisten & Bautagebuch

- **Aufmaß** mit Formeln für Fläche, Wand, Volumen, Länge und Stück, Raumzuordnung und Faktor
- Übernahme der Aufmaßpositionen ins Leistungsverzeichnis (optional mit Raum im Text)
- **Digitale Unterschrift** auf dem Touchscreen, als PNG mit SHA-256 gespeichert und am Auftrag
  dokumentiert
- **Checklistenvorlagen** (SHK-Wartung, Baustellenvorbereitung, Abnahme) und auftragsbezogene
  Listen mit Fortschritt, Abhakten und Notizen
- **Bautagebuch** mit Datum, Wetter, Personal, Arbeiten, Material und Besonderheiten
- Alles gebündelt in der **Projektakte** des Auftrags

### Inventur & Scan

- Artikel per **GTIN, Barcode oder Artikelnummer** scannen und Bestand buchen
- **Inventursitzungen** mit Zählungen je Artikel, Soll/Ist-Vergleich und Abweichungen
- Erst der Abschluss bucht die Differenzen als Lagerkorrektur – abgeschlossene Inventuren
  bleiben aus Nachvollziehbarkeitsgründen erhalten

### Lager: Reservierungen, Packliste & Händlerbestellung

- Material je Auftrag **reservieren**; der verfügbare Bestand wird um offene Reservierungen reduziert
- **Packliste** mit Abhaken je Position, direkt aus dem Auftrag
- **OCI-Bestellung** als XML exportieren oder – bei konfiguriertem Händler – direkt senden
  (HTTPS, Bearer/Basic/API-Key; ohne Zugangsdaten bleibt der XML-Download)
- Bestandsanzeige in der Artikelliste mit `reserved` und `available`

### Dokumente & Auftragsdokumente

- **Auftragsbestätigung** und **Lieferschein** als PDF direkt aus dem Auftrag (Lieferschein ohne Preise)
- **Abschlagsrechnung** mit Prozent oder Betrag; die Schlussrechnung zieht alle Abschläge ab
- **E-Mail-Versand mit PDF-Anhang** für Rechnung, Angebot, Auftragsbestätigung und Lieferschein
- Dokumentenarchiv mit Kategorie **Personalakte**, Mitarbeiterzuordnung und Zugriff über die Personalakte

### Schnittstellen & Textassistent

- **GAEB X83 (DA83)**: Export des Leistungsverzeichnisses und Import von Positionen
- **GAEB X84 (DA84)**: Kostenanschlag mit Mengen und Preisen
- **OCI-Bestellung** (BMEcat/OCI-XML) vom Lieferanten direkt in den Auftrag übernehmen und
  als Bestellung exportieren
- **Lexware-CSV** für die Buchhaltung (Belegnummer, Datum, Netto/USt/Brutto, offen)
- **Webhooks**: signierte JSON-Ereignisse (`X-HandwerkPro-Signature`, HMAC-SHA256) für Aufträge,
  Rechnungen, Zahlungen, Kunden, Dokumente und freigegebene Berichte. Nur HTTPS, private
  Netzziele und Zugangsdaten in der URL sind gesperrt, Timeout 5 Sekunden
- **OpenAPI 3.0** unter `/api/openapi.json` (Anmeldung erforderlich)
- **Lokaler Textassistent**: Angebotstext, Zahlungserinnerung, Auftragszusammenfassung,
  Checkliste und E-Mail – ausschließlich aus vorhandenen Daten, ohne externen KI-Dienst

### Kunden & Objekte

- Firmen- und Privatkunden mit Ansprechpartner, Anrede, Kontaktdaten und Notizen
- **Kundennotizen** als Verlauf: jeder Eintrag mit Autor und Zeitstempel, direkt in der Kundenakte
  erfassbar – auch per Sprachdiktat
- Mehrere Objekte pro Kunde (z. B. Gas-/Wasseranschluss, Heizungsart, Zählernummer)
- Kundenakte mit Objekten, Aufträgen, Rechnungen und offenen Beträgen

### Mein Tag

- Persönliche Tagesansicht für **jede Rolle** – Chef, Vorgesetzte, Büro, HR und Monteure
  (Büro und Personal werden als Mitarbeiter geführt und können Termine erhalten)
- Eigene Termine des Tages und der nächsten zwei Wochen, inkl. Kundenbesuchen, Meetings,
  Personalgesprächen, Lieferanten- und Fortbildungsterminen
- Kennzahlen passend zur Rolle (offene Aufträge, Berichte zur Freigabe, überfällige Rechnungen)
- Team-Übersicht „Wer ist heute im Einsatz“ (bei Recht `employees.view`)

### Einsatzplanung / Kalender

- Wochen- **und Monatsansicht**, farblich je Monteur, mit Filter-Chips nach Terminart
- **Urlaub und Abwesenheiten** sind in allen drei Ansichten sichtbar – genehmigt und beantragt
  (beantragt gestrichelt/orange), abgelehnt wird ausgeblendet
- **Plantafel** als dritte Ansicht: Mitarbeiter, Abwesenheiten und Ressourcen (Fahrzeuge,
  Werkzeuge, Maschinen) auf einen Blick – mit Kapazitätsprüfung und Konflikterkennung
- **Terminarten**: Baustelle, Kundenbesuch, Meeting, Personal/HR, Notdienst, Fortbildung,
  Lieferant, Sonstiges
- Termine per Klick in freie Zeitfenster anlegen; Kunde, Auftrag und Ort sind optional
- Monteure sehen nur ihre eigenen Termine, Büro/Chef/Vorgesetzte alle
- **Terminbestätigung per Link**: Ein Klick erzeugt einen persönlichen Link
  (`/termin/<token>`), den der Kunde ohne Anmeldung öffnen kann. Er bestätigt den Termin oder
  meldet zurück, dass er nicht passt – optional mit Wunsch oder Begründung. Der Status
  (offen / bestätigt / abgelehnt) ist im Kalender und im Termin sichtbar.

  Der Link enthält einen zufälligen Token (48 Hex-Zeichen) und gilt nur für diesen einen Termin.
  Er ersetzt keine Termineinladung per Post – bitte nur an den Kunden selbst weitergeben.

  Ist ein SMTP-Zugang hinterlegt, verschickt **„Per E-Mail senden"** die Bestätigung direkt an
  die beim Kunden gespeicherte Adresse. Ohne SMTP öffnet der Button wie bisher das lokale
  Mailprogramm. Bestätigt oder verschiebt der Kunde den Termin, kann das Büro automatisch eine
  kurze Benachrichtigung per E-Mail erhalten (abschaltbar).

### Material & Lager

- Artikel mit Kategorie, Einheit, EK/VK, Bestand und Mindestbestand
- Wareneingang, Entnahme und Korrekturen mit Lagerhistorie
- Warnungen bei Unterschreitung des Mindestbestands
- Automatische Abbuchung bei Rechnungserstellung und bei Berichtsmaterial
- **Katalogimport** aus Datanorm 4 (`.001`, `.WRG`, DATPREIS), BMEcat (XML) und CSV/Excel-Export
  – vorhandene Artikel werden aktualisiert, neue angelegt, Fehler je Zeile protokolliert
- Import-Historie mit Quelle, Lieferant, Datei, Neu/Aktualisiert/Fehlern und Benutzer
- **Optionale Datenquellen** (unter Einstellungen → Material & Datenquellen einzeln schaltbar):
  - **Open Icecat** – Produktdatenblätter, Bilder und Merkmale per GTIN/EAN
  - **ETIM-Klassifikation** – Klassen und Merkmale über die offizielle ETIM-API (OAuth2)
  - **UPCitemdb** – Barcode-Lookup (kostenlose Teststufe oder eigener Schlüssel)
  - **GS1/GTIN-Prüfung** – Prüfziffer und Link zu „Verified by GS1" (lokal, ohne Schlüssel)
  - **Händler-API (REST/JSON)** – generischer Connector für Großhändler mit Vertrag;
    Authentifizierung per Bearer, Basic oder API-Key, konfigurierbare Pfade und Feldzuordnung
  - **IDS-Connect / Händlershop** – Deep-Link zum Artikel im Shop des Händlers
- **Anreichern**: fehlende GTIN, Hersteller, Herstellernummer, ETIM-Klasse, Datenblatt oder
  Bild direkt am Artikel nachladen – nur aus den eingeschalteten Quellen

> Alle Quellen sind **optional** und standardmäßig aus. Ohne eingeschaltete Quelle finden
> keine externen Abfragen statt. Für Icecat, ETIM und Händler-APIs gelten die jeweiligen
> Lizenz- und Vertragsbedingungen; die Zugangsdaten bleiben lokal in der Datenbank.
> Beim Import werden nur die Dateien verarbeitet, die der Betrieb selbst auswählt.

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
- **Material & Datenquellen** (ganz unten): pro Quelle ein Ein/Aus-Schalter plus die nötigen
  Zugangsdaten; Importoptionen (Aufschlag, EK/VK/Bestand übernehmen) und HTTP-Freigabe für
  lokale Tests. Zugangsdaten sieht und ändert nur, wer Einstellungen verwalten darf.
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

Erzeugte Rechnungs-PDFs werden zusätzlich unter `data/dokumente/` archiviert und im
Dokumentenarchiv (`data/ablage/`) geführt.

Für **ZUGFeRD** wird dasselbe Layout als PDF 1.7 mit XMP-Metadaten und eingebetteter
CII-XML-Datei erzeugt (`/api/invoices/:id/einvoice?format=zugferd&pdf=1`). Das ist bewusst
kein zertifiziertes PDF/A-3; für eine förmliche E-Rechnung bitte mit dem KoSIT-/ZUGFeRD-
Prüftool validieren.

---

## Anmeldung, Daten & Backup

- Anmeldung per Benutzername/Passwort; Passwörter mit **scrypt** gehasht
- Sessions als **HttpOnly-Cookie** (`hp_session`, 30 Tage, `SameSite=Lax`, bei HTTPS zusätzlich `Secure`);
  in der Datenbank liegt nur der **SHA-256-Hash** des Tokens
- **Startpasswörter** der Demo-Konten müssen beim ersten Login geändert werden; auch vom Admin
  gesetzte Passwörter werden beim nächsten Login ersetzt
- Eine Passwortänderung beendet **alle** bisherigen Sitzungen (auch auf anderen Geräten)
- Einfache Brute-Force-Bremse nach 10 Fehlversuchen pro IP; öffentliche Terminlinks sind zusätzlich gedrosselt
- Datenbank: `data/gaswasser.db` (SQLite, WAL-Modus)
- PDF-Archiv: `data/dokumente/`, Fotos: `data/fotos/`
- **Backup:** den kompletten `data`-Ordner kopieren – am besten bei gestopptem Server
- Es werden keine Daten nach außen gesendet. Kein Cloud-Dienst, keine Telemetrie.

> Hinweis: Das System ist eine praktische Hilfe, keine Rechts- oder Steuerberatung. Rechnungsform und
> Aufbewahrungspflichten (GoBD) solltest du mit deinem Steuerberater abstimmen. Für den produktiven
> Einsatz wird empfohlen, regelmäßig Backups zu erstellen.

---

## E-Mail-Versand (SMTP)

Terminbestätigungen kann die App selbst verschicken. Dafür in **Einstellungen → E-Mail-Versand**
eintragen:

| Feld | Beispiel | Hinweis |
|---|---|---|
| SMTP-Server | `smtp.ionos.de` | Hostname deines Providers |
| Port | `587` | 587 = STARTTLS, 465 = SSL/TLS |
| SSL/TLS direkt | aus / an | bei Port 465 aktivieren |
| Benutzername | `info@firma.de` | meist die vollständige Adresse |
| Passwort | •••••• | bleibt lokal in `data/gaswasser.db` |
| Absenderadresse | `info@firma.de` | muss der Provider erlauben |
| Öffentliche Adresse | `https://app.firma.de` | Basis für Links in E-Mails |

Danach **Speichern** und mit **Testmail** prüfen. Der Versand läuft über einen eigenen, kleinen
SMTP-Client (`src/mail.js`) – weiterhin ohne npm-Abhängigkeiten.

- **„Per E-Mail senden"** im Termin verschickt die Bestätigung an die Kundenadresse.
- **Rückmeldungen**: Bestätigt oder verschiebt der Kunde den Termin, geht eine kurze Nachricht
  an die Firmenadresse (abschaltbar über den Schalter im selben Abschnitt).
- Ohne SMTP-Konfiguration fällt der Button auf das lokale Mailprogramm zurück – die App bleibt
  also auch ohne Zugangsdaten nutzbar.

---

## Sicherheit & produktiver Betrieb

**Vor dem ersten echten Einsatz:**

1. **Alle Demo-Passwörter ändern** (Benutzer & Rechte). Die Konten `chef`, `buero`,
   `vorgesetzt`, `monteur`, `azubi` und `hr` haben bekannte Startpasswörter. Bei einer **neuen
   Datenbank** erzwingt die App die Änderung beim ersten Login; bei bestehenden Datenbanken
   zeigt die Sicherheitskarte, welche Konten noch betroffen sind.
2. **Demo-Zugänge ausblenden** unter Einstellungen → Sicherheit. Damit verschwinden die
   Testkonten von der Anmeldeseite; die Passwörter müssen trotzdem geändert werden.
3. **HTTPS aktivieren.** Entweder direkt über `HTTPS_KEY` / `HTTPS_CERT` oder über einen
   Reverse-Proxy. Ohne TLS sind Passwörter und Kundendaten im Netzwerk lesbar.
4. **Nicht ungeschützt ins Internet stellen.** Die App ist für das lokale Netz bzw. VPN gedacht.
   Für den Zugriff von außen einen Reverse-Proxy mit TLS und vorgeschalteter Anmeldung nutzen.

**Was die App zusätzlich absichert:**

- Rechte werden ausschließlich serverseitig geprüft; neue Routen sind standardmäßig gesperrt,
  bis ein Recht (oder `public`/`authenticated`) gesetzt ist.
- Einstellungen werden je Rolle gefiltert: SMTP-Zugang und Bankdaten sieht nur, wer sie braucht;
  das SMTP-Passwort wird nie im Klartext ausgeliefert. Material-Zugangsdaten (Icecat, ETIM,
  UPCitemdb, Händler-API) sind zusätzlich maskiert und für andere Rollen gar nicht sichtbar.
- Externe Materialquellen sind optional. Abfragen laufen nur für eingeschaltete Quellen,
  ausschließlich über HTTPS (HTTP nur per bewusster Testeinstellung), mit Zeitlimit,
  Größenlimit, SSRF-Schutz (keine privaten/Loopback-Adressen) und ohne Weiterleitung in
  private Netze. Importdateien werden auf 10 Dateien à 64 MB begrenzt.
- Sicherheitsheader (`CSP`, `X-Frame-Options`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`);
  bei HTTPS zusätzlich `Strict-Transport-Security`.
- Ändernde Anfragen mit fremdem `Origin` werden abgelehnt (CSRF-Schutz zusätzlich zu `SameSite`).
- Kaputte URLs, Cookies oder Host-Header können den Server nicht mehr beenden.
- Beim Mailversand werden Zugangsdaten nur über TLS/STARTTLS übertragen.
- `data/` wird unter Linux/macOS mit restriktiven Rechten angelegt (Ordner `700`, Datenbank `600`).

> Die App ersetzt keine Firewall und kein Backup-Konzept. Regelmäßige Sicherungen des
> `data`-Ordners sind Pflicht.

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
│   ├── materials.js        Katalogimporte (Datanorm/BMEcat/CSV), Icecat/ETIM/Händler-APIs
│   ├── mail.js             SMTP-Versand ohne Abhängigkeiten
│   ├── api.js              REST-API inkl. Auth- und Rechteprüfung
│   ├── billing.js          Rechnungen, Zahlungen, Mahnungen, Lagerbuchungen
│   ├── automation.js       Automatik (Verträge, Rechnungen, Mahnungen)
│   ├── einvoice.js         XRechnung 3.0 (UBL) und ZUGFeRD 2.x (CII)
│   ├── dms.js              Dokumentenarchiv, Versionen, GoBD-Verlauf
│   ├── calc.js             Kalkulation und Nachkalkulation
│   ├── resources.js        Plantafel und Ressourcenbuchungen
│   ├── hr.js               Urlaub, Abwesenheiten, Verträge, Pausen, Lohnvorbereitung
│   ├── collab.js           Aufgaben, Nachrichten, Benachrichtigungen, Pinnwand
│   ├── crm.js              Anfragen-Pipeline, öffentliches Formular, Kundenportal
│   ├── warehouse.js        Reservierungen, Packliste, OCI, Händlerbestellung
│   ├── geo.js              GPS-Zeiterfassung, Geofencing und Standortprüfung
│   ├── finance.js          Bankimport, DATEV und SEPA
│   ├── site.js             Aufmaß, Checklisten, Bautagebuch, Unterschrift
│   ├── inventory.js        Inventur und Artikel-Scan
│   ├── interfaces.js       GAEB X83/X84, OCI, Lexware, Webhooks, OpenAPI
│   ├── assistant.js        Lokaler Textassistent
│   ├── documents.js        Layout von Rechnung, Abschlag, Auftrag, Bestätigung, Lieferschein
│   └── pdf.js              PDF-Generator inkl. eingebetteter Dateien (ZUGFeRD)
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
│   ├── anfrage.html        Öffentliches Anfrageformular (/anfrage/<token>)
│   ├── portal.html         Kundenportal (/portal/<token>)
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

GET    /api/geo/status                GPS-Status, Zuhause- und Baustellen-Standorte
PUT    /api/geo/settings              GPS-Zeiterfassung ein-/ausschalten und Radius setzen
PUT    /api/geo/home                  Zuhause-Standort per GPS speichern
PUT    /api/orders/:id/location       Baustellen-Standort per GPS speichern
POST   /api/geo/event                 Übergang melden (startet/stoppt die Zeit serverseitig)
GET    /api/geo/events                Letzte GPS-Ereignisse des eigenen Kontos

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
GET    /api/invoices/:id/einvoice     E-Rechnung (?format=xrechnung|zugferd, &pdf=1 für ZUGFeRD-PDF)
POST   /api/invoices/:id/einvoice/status   E-Rechnungsstatus setzen

GET    /api/documents                 Dokumentenarchiv (Filter: customer_id, order_id, invoice_id, category, q)
POST   /api/documents                 Dokument ablegen (Datei als `dataUrl`, `base64` oder `content`)
GET    /api/documents/:id             Dokument mit Versionen und Verlauf
GET    /api/documents/:id/file        Datei herunterladen
POST   /api/documents/:id/versions    Neue Version ablegen
DELETE /api/documents/:id             Soft-Delete (GoBD)

GET    /api/orders/:id/calculation    Kalkulation und Nachkalkulation
PUT    /api/orders/:id/calculation    Vorgaben und Kosten speichern
POST   /api/orders/:id/calculation/apply   Kalkulierte Preise übernehmen
GET    /api/orders/:id/measurements   Aufmaßpositionen
POST   /api/orders/:id/measurements   Aufmaßposition anlegen
POST   /api/orders/:id/measurements/apply   Aufmaß ins LV übernehmen
GET    /api/orders/:id/signatures     Unterschriften
POST   /api/orders/:id/signatures     Digitale Unterschrift (PNG als `dataUrl`)
GET    /api/signatures/:id/file       Unterschrift anzeigen
GET    /api/orders/:id/checklists     Checklisten und Vorlagen
POST   /api/orders/:id/checklists     Checkliste aus Vorlage anlegen
PUT    /api/checklists/:id/entries/:entryId   Punkt abhaken oder Notiz setzen
GET    /api/orders/:id/diary          Bautagebuch
POST   /api/orders/:id/diary          Tagebucheintrag anlegen
GET    /api/orders/:id/site           Projektakte (Aufmaß, Listen, Unterschriften, Tagebuch)
GET    /api/orders/:id/gaeb           GAEB-X83-Export
POST   /api/orders/:id/gaeb/import    GAEB-Positionen importieren
POST   /api/orders/:id/oci/import     OCI-Bestellung importieren

GET    /api/planning/board            Plantafel (Mitarbeiter, Abwesenheiten, Buchungen)
GET    /api/resources                 Ressourcen
POST   /api/resources                 Ressource anlegen
GET    /api/resource-bookings         Ressourcenbuchungen (Monteur: nur eigene)
POST   /api/resource-bookings         Ressource einplanen (Konfliktprüfung)

GET    /api/absences                  Abwesenheiten (eigene oder alle mit hr.manage)
POST   /api/absences                  Urlaub/Abwesenheit beantragen
POST   /api/absences/:id/decide       Genehmigen oder ablehnen
GET    /api/hr/accounts               Urlaubs- und Arbeitszeitkonten
GET    /api/hr/my-account             Eigenes Konto
PUT    /api/vacation-entitlements     Urlaubsanspruch setzen
GET    /api/time-adjustments          Arbeitszeit-Korrekturen
POST   /api/time-adjustments          Korrektur buchen

GET    /api/finance/overview          Finanzkennzahlen
GET    /api/finance/bank              Bankumsätze
POST   /api/finance/bank/import       CSV/CAMT.053 importieren
POST   /api/finance/bank/auto-match   Automatischen Abgleich starten
POST   /api/finance/bank/:id/book     Zahlung einer Rechnung zuordnen und verbuchen
GET    /api/finance/datev             DATEV-Buchungsstapel (EXTF 700)
GET    /api/finance/sepa              SEPA-Vorschau
GET    /api/finance/sepa/file         SEPA-XML (pain.001.001.03)

GET    /api/articles/lookup?code=…    Artikel per Scan-Code finden
GET    /api/inventory                 Inventursitzungen
POST   /api/inventory                 Inventur anlegen
POST   /api/inventory/:id/count       Zählung speichern
POST   /api/inventory/:id/close       Inventur abschließen und Bestand korrigieren

GET    /api/checklist-templates       Checklistenvorlagen
POST   /api/checklist-templates       Vorlage anlegen
GET    /api/webhooks                  Webhooks (Einstellungen)
POST   /api/webhooks                  Webhook anlegen
POST   /api/webhooks/:id/test         Testzustellung
GET    /api/openapi.json              OpenAPI-3.0-Dokument
POST   /api/assistant/draft           Lokalen Textentwurf erzeugen

GET    /api/customers                 Kunden inkl. Kennzahlen
GET    /api/customers/:id             Kunde inkl. Objekten, Aufträgen, Rechnungen und Notizen
GET    /api/customers/:id/notes       Kundennotizen (Autor + Zeitstempel)
POST   /api/customers/:id/notes       Notiz anlegen (Büro/Chef)
DELETE /api/customers/:id/notes/:id   Notiz löschen (Büro/Chef)

GET    /api/my-day                    Eigene Termine, Kennzahlen und Team-Übersicht
POST   /api/mail/test                 Testmail über SMTP versenden (Einstellungen)
POST   /api/appointments/:id/confirm-mail   Terminbestätigung per E-Mail an den Kunden
GET    /api/appointments              Termine (Filter: from, to; inkl. Terminart, Ort, Kunde)
POST   /api/appointments              Termin anlegen
POST   /api/appointments/:id/confirm-link   Bestätigungslink erzeugen (stabil)
POST   /api/appointments/:id/confirm-reset  Bestätigung zurücksetzen
GET    /api/public/appointments/:token      Öffentlich: Termin für den Kunden
POST   /api/public/appointments/:token/confirm   Kunde bestätigt
POST   /api/public/appointments/:token/decline   Kunde lehnt ab (mit Nachricht)

GET    /api/articles                  Lager
POST   /api/articles/:id/stock        Lagerbuchung
GET    /api/materials/sources         Registrierte Materialquellen (Felder nur mit settings.manage)
POST   /api/materials/sources/:id/test  Verbindung einer Quelle testen
POST   /api/materials/import          Datanorm/BMEcat/CSV importieren (Base64-Dateien)
GET    /api/materials/imports         Import-Historie
POST   /api/materials/lookup          GTIN/Artikelnummer/Suchbegriff abfragen
POST   /api/materials/articles/:id/enrich   Artikel aus Quellen anreichern
GET    /api/materials/deep-link/:id   Händlershop-Link zum Artikel
GET    /api/materials/gtin/:value     GTIN-Format und Prüfziffer prüfen
GET    /api/contracts                 Wartungsverträge
POST   /api/contracts/:id/order       Auftrag aus Vertrag erzeugen
GET    /api/users                     Benutzerkonten (Chef)
POST   /api/automation/run            Automatik sofort ausführen
GET    /api/export/rechnungen.csv     CSV-Export (auch auftraege, kunden, lager)

GET    /api/tasks                     Aufgaben (Monteur: nur eigene)
POST   /api/tasks                     Aufgabe anlegen (Chef/Büro/Vorgesetzte)
PUT    /api/tasks/:id                 Aufgabe bearbeiten
POST   /api/tasks/:id/done            Aufgabe erledigen/wieder öffnen
DELETE /api/tasks/:id                 Aufgabe löschen
GET    /api/messages?order_id=…       Nachrichten (optional je Auftrag)
POST   /api/messages                  Nachricht senden
GET    /api/notifications             Benachrichtigungen (Filter: unread=1)
POST   /api/notifications/read        Als gelesen markieren
GET    /api/feed                      Aktivitäts-Feed / Pinnwand

GET    /api/leads                     Anfragen/Leads inkl. Stufen und Quellen
POST   /api/leads                     Anfrage anlegen
PUT    /api/leads/:id                 Anfrage bearbeiten
POST   /api/leads/:id/convert         Anfrage in Kunde umwandeln
GET    /api/lead-stages               Pipeline-Stufen
POST   /api/leads/token               Token für das öffentliche Formular erzeugen
POST   /api/public/leads/:token       Öffentlich: Anfrage senden
POST   /api/customers/:id/portal      Kundenportal-Link erzeugen
DELETE /api/customers/:id/portal      Kundenportal-Link zurückziehen
GET    /api/public/portal/:token      Öffentlich: Portalübersicht
GET    /api/public/portal/:token/invoices/:id/pdf   Öffentlich: Rechnung als PDF
GET    /api/public/portal/:token/documents/:id/file Öffentlich: Dokument
POST   /api/public/portal/:token/messages            Öffentlich: Nachricht an das Büro

GET    /api/orders/:id/pdf?type=…     PDF: auftrag, angebot, auftragsbestaetigung, lieferschein
POST   /api/orders/:id/send-document  Auftragsdokument per E-Mail senden
POST   /api/orders/:id/progress-invoice   Abschlagsrechnung (percent oder amount)
POST   /api/invoices/:id/send-mail    Rechnung mit PDF-Anhang per E-Mail senden
GET    /api/orders/:id/gaeb?format=x84    GAEB-X84-Export
GET    /api/orders/:id/oci            OCI-Bestellung exportieren

GET    /api/orders/:id/reservations   Materialreservierungen
POST   /api/orders/:id/reservations   Material reservieren
PUT    /api/reservations/:id          Menge ändern / abhaken
DELETE /api/reservations/:id          Reservierung entfernen
GET    /api/orders/:id/packlist       Packliste
POST   /api/orders/:id/dealer-order   Händlerbestellung senden oder XML liefern

GET    /api/employment-contracts      Arbeitsverträge (hr.manage/hr.payroll)
POST   /api/employment-contracts      Vertrag anlegen
PUT    /api/employment-contracts/:id  Vertrag bearbeiten
GET    /api/hr/payroll                Lohnvorbereitung (Jahr/Monat)
GET    /api/hr/payroll.csv            Lohnvorbereitung als CSV
GET    /api/hr/maternity?due_date=…   Mutterschutzfristen
GET    /api/employees/:id/file        Personalakte (HR oder eigene Person)
GET    /api/time-categories           Zeitkategorien
POST   /api/time-categories           Zeitkategorie anlegen (HR)
GET    /api/finance/lexware           Lexware-CSV-Export
```

---

## Technik

- **Node.js** ≥ 24 (LTS), ES Modules, keine Laufzeit-Abhängigkeiten
- **SQLite** über das eingebaute `node:sqlite` (kein npm-Paket nötig)
- **Vanilla JS** im Frontend, kein Build-Schritt
- **Web Speech API** für Spracheingabe, **SpeechSynthesis** für Rückmeldungen
- **PDF** mit eigenem Generator (`src/pdf.js`)
- **PWA** mit Manifest und Service Worker
- **Server** hört standardmäßig auf Port `3000` an allen Netzwerkkarten; mit `HOST=127.0.0.1`
  nur lokal erreichbar, `PORT` ist frei wählbar. HTTPS direkt über `HTTPS_KEY` / `HTTPS_CERT`.
- Hinter einem Reverse-Proxy `TRUST_PROXY=1` setzen, damit Limits und Cookies die echte
  Client-Adresse bzw. das ursprüngliche Protokoll verwenden.

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
