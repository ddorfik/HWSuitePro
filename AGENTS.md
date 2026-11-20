# AGENTS.md

Leitfaden für KI-Assistenten, die an diesem Projekt arbeiten.
Menschen lesen bitte zusätzlich [CONTRIBUTING.md](CONTRIBUTING.md).

**Kurzfassung:** Node 24, keine Laufzeitabhängigkeiten, Vanilla-JS-Frontend, SQLite über
`node:sqlite`. Rechte immer serverseitig prüfen, `data/` niemals committen, `npm test`
muss grün sein, Arbeit ausschließlich über Feature-Branch und Pull Request.

---

## 1. Was ist das?

**HandwerkPro** ist eine branchenneutrale Handwerkersoftware (Gas/Wasser, Elektro, Dach …)
für kleine Betriebe: Kunden, Aufträge, Planung, Zeiterfassung, Berichte, Vorher/Nachher-Fotos,
Material, Rechnungen, Wartungsverträge, PWA und deutsche Sprachsteuerung.

Der Name des Repos (`HWSuitePro`) und des Ordners (`GasWasserPro`) ist historisch – im Code
und in der UI heißt das Produkt **HandwerkPro**.

## 2. Befehle

```bash
npm start        # Server auf http://localhost:3000, legt beim ersten Start Demo-Daten an
npm run dev      # dasselbe mit --watch
npm test         # node:test, arbeitet in temporärer Datenbank
npm run reset    # setzt data/ zurück (löscht lokale Daten!)
```

- **Node.js ≥ 24** ist Pflicht (`node:sqlite`, `--watch`).
- **Kein** `npm install` nötig – es gibt keine Laufzeitabhängigkeiten.
- Datenverzeichnis überschreibbar: `GASWASSER_DATA` (Ordner) und `GASWASSER_DB` (Datei).
  Die Tests nutzen das, um nie `data/gaswasser.db` anzufassen.
- HTTPS (nötig für Mikrofonzugriff auf echten Geräten): `HTTPS_KEY` / `HTTPS_CERT`.

Demo-Logins: `chef/chef123`, `vorgesetzt/vorgesetzt123`, `buero/buero123`,
`monteur/monteur123`, `azubi/azubi123`, `hr/hr123`.
Bei einer **neuen Datenbank** sind das Startpasswörter: Der erste Login erzwingt ein neues
Passwort. Bestehende Datenbanken behalten ihre Passwörter (Sicherheitskarte zeigt schwache Konten).

## 3. Struktur

| Pfad | Inhalt |
|---|---|
| `server.js` | HTTP/HTTPS-Server, statische Dateien, Scheduler |
| `src/db.js` | Schema, Migrationen (`ensureColumn`), Einstellungen, Nummernkreise, Seed-Aufruf |
| `src/seed.js` | Demo-Daten (Kunden, Aufträge, Benutzer, Rechnungen …) |
| `src/api.js` | Alle REST-Endpunkte, `route(...)`, Auth-/Rechteprüfung |
| `src/permissions.js` | Rollen und Rechte-Matrix – **einzige Wahrheit** |
| `src/auth.js`, `src/password.js` | Sessions (`hp_session`-Cookie), scrypt |
| `src/work.js` | Materialparser, Foto-Speicherung, Zeiterfassung |
| `src/materials.js` | Katalogimporte (Datanorm 4, BMEcat, CSV), Icecat/ETIM/UPCitemdb/Händler-API, GTIN |
| `src/mail.js` | SMTP-Versand ohne Abhängigkeiten (TLS, STARTTLS, AUTH) |
| `src/billing.js`, `src/automation.js` | Rechnungen, Automatik-Läufe |
| `src/documents.js`, `src/pdf.js` | Dokumente und eigener PDF-Generator |
| `public/app.js` | komplette SPA (Vanilla JS, kein Build-Schritt) |
| `public/styles.css` | Design inkl. mobiler Ansichten |
| `public/sw.js`, `public/manifest.webmanifest` | PWA |
| `test/smoke.test.js` | Tests inkl. echter HTTP-Flows |
| `scripts/reset.js` | Setzt `data/` zurück |

## 4. Unveränderliche Regeln

1. **Rechte serverseitig prüfen.** Ausblenden in der UI ist nur Komfort. Jede Route bekommt
   `{ permission: '…' }`, `{ permissions: [ … ] }`, `{ authenticated: true }` oder
   `{ public: true }` – **ohne Angabe ist eine Route gesperrt**. Neue Rechte gehören in
   `src/permissions.js` **und** in die Rechte-Matrix der README. Bei Datensätzen zusätzlich die
   Zugehörigkeit prüfen (`assertOrderAccess`, `assertCustomerAccess`, eigene `employee_id`).
2. **Keine Laufzeitabhängigkeiten.** Kein `express`, kein `bcrypt`, kein Build-Tool,
   kein CDN im Frontend – auch E-Mails laufen über den eigenen Client in `src/mail.js`.
   Das Projekt muss „Ordner kopieren, `npm start`, fertig" bleiben.
   Ausnahme nur nach ausdrücklicher Freigabe durch den Maintainer.
3. **`data/` niemals committen.** Datenbank, PDFs, Fotos und Dokumente können echte
   Kundendaten enthalten. Ebenfalls tabu: `.env`, Zertifikate, Tokens, Logs.
4. **Deutsch in der UI, Englisch im Code.** Bezeichner, Tabellen und Spalten englisch;
   Beschriftungen, Meldungen und Doku deutsch.
5. **Bestehende Werte nicht umbenennen.** Statuswerte (`neu`, `geplant`, `in_arbeit`,
   `erledigt`, `abgerechnet`, `storniert`, `angenommen`), Berichtsstatus
   (`entwurf`, `eingereicht`, `freigegeben`, `abgerechnet`) und Terminarten
   (`baustelle`, `kundenbesuch`, `meeting`, `personal`, `notdienst`, `fortbildung`,
   `lieferant`, `sonstiges`) stehen so in DB und API.
6. **Mobile zuerst.** Neue Ansichten müssen auf dem Smartphone bedienbar sein:
   Touch-Ziele, Bottom-Nav, keine Hover-Abhängigkeiten, kein horizontales Scrollen.
7. **Sprachsteuerung nicht ausbremsen.** Sprachbefehle dürfen ein offenes Formular nicht
   „abbrechen" oder zum Tippen zwingen; Diktat schreibt in das aktive Feld.
8. **Keine Secrets, keine echten Daten** in Code, Tests, Beispielen oder Commit-Messages.
9. **Keine Geheimnisse in API-Antworten.** Einstellungen je Rolle über `settingsForUser(...)`
   ausliefern; SMTP- und Material-Zugangsdaten nur maskiert (`********`), Bankdaten nur mit
   `invoices.view`, `mat_*`-Einstellungen nur mit `settings.manage`.
10. **Eingaben escapen.** HTML nur über `esc(...)` (Frontend) bzw. `escHtml(...)` (E-Mail);
   Attributwerte und Links mitdenken. Neue öffentliche Seiten brauchen dieselben Regeln.
11. **Server bleibt erreichbar.** Anfragen dürfen nie zu einem unbehandelten Fehler führen:
   URL/Cookies defensiv parsen, `decodeURIComponent` absichern, Größen begrenzen.
12. **Sicherheitsheader nicht entfernen.** `CSP`, `X-Frame-Options`, `nosniff` und der
   Origin-Schutz in `server.js` sind Pflicht. Inline-Skripte sind deshalb tabu – Skripte
   gehören in eigene Dateien unter `public/`.

## 5. Rezept: neuer API-Endpunkt

```js
// src/api.js
route('POST', '/api/orders/:id/notiz', (req, res, params) => {
  const order = assertOrderAccess(req.user, params.id);  // 404/403 inklusive
  const text = str(req.body?.text);
  if (!text) throw new HttpError(400, 'Notiz fehlt');
  const id = insertRow('order_notes', { order_id: order.id, text, user_id: req.user.id });
  return { id };
}, { permission: 'orders.progress' });
```

- Signatur: `(req, res, params, url)` – Pfadparameter kommen über `params`, nicht `req.params`.
- Vorhandene Helfer nutzen: `route`, `HttpError`, `num`, `str`, `bool`, `pick`,
  `insertRow`, `updateRow`, `can(...)`, `canAny(...)`, `assertOrderAccess(...)`,
  `assertReportAccess(...)`, `hasAllOrders(...)`, `ownOrderClause(...)`, `ownEmployeeId(...)`.
- Sichtbarkeit zusätzlich zur Berechtigung prüfen: Monteure sehen nur eigene Aufträge
  (`orders.view.own`), auch in Listen und Detail-Endpunkten.
- Antworten als JSON-Objekt, Fehler als `HttpError(status, deutsche Meldung)`.

## 6. Rezept: neue UI-Ansicht

- Alles liegt in `public/app.js`; es gibt keine Module und keinen Bundler.
- Wiederverwenden: `api.get/post/put/del`, `openModal`, `formModal`, `toast`, `icon`,
  `esc`, `$`, `/api/…`-Pfade relativ.
- `formModal({ fields })` unterstützt u. a. `dictate: true` (Sprachdiktat im Feld),
  Auswahlfelder und mehrzeilige Felder.
- Fotos laufen über `photoPicker` / `uploadPhoto(..., { multiple: true })`; Client
  verkleinert auf JPEG, Server speichert unter `data/fotos/`.
- Nach Änderungen an `public/`: `?v=`-Suffix in `public/index.html` erhöhen **und**
  Cache-Namen in `public/sw.js` anheben, sonst sehen Nutzer alte Dateien.

## 7. Datenbank ändern

- Neue Spalte: `ensureColumn('tabelle', 'spalte', 'TEXT')` in `src/db.js` ergänzen
  (sanfte Migration, läuft bei jedem Start).
- Neue Tabelle: ins `SCHEMA` aufnehmen, Index mitdenken, Foreign Keys beachten.
- Demo-Daten nur in `src/seed.js` ergänzen, wenn sie für alle Rollen sinnvoll sind.
- Migrationen müssen auf bestehenden Datenbanken laufen – nichts droppen, nichts umbenennen.

## 8. Tests

```bash
npm test
```

- Jede Verhaltensänderung an der API bekommt einen Test in `test/smoke.test.js`.
- Rechteänderungen: mindestens ein Test, der zeigt, dass eine Rolle **abgelehnt** wird.
- HTTP-Flows mit Login, Cookie und `fetch` gegen den Test-Server abdecken, wenn die
  Route Auth/Rechte nutzt.
- Tests dürfen nie `data/gaswasser.db` berühren (siehe `GASWASSER_DATA`).

## 9. Git-Ablauf

`main` ist geschützt: Pull Request + grüner Check **Tests** sind Pflicht.

```bash
git checkout -b feature/kurzes-thema      # oder fix/…
# … ändern, npm test …
git add -A
git commit -m "feat: kurze Beschreibung"
git push -u origin feature/kurzes-thema
# danach Pull Request gegen main öffnen
```

- Commit-Stil: `feat:`, `fix:`, `docs:`, `test:`, `refactor:`, `chore:` – deutsch, knapp.
- **Keine** Direkt-Pushes auf `main`, kein `git push --force` auf gemeinsame Branches.
- Kein `--no-verify`, um den lokalen Hook zu umgehen (außer der Maintainer bittet darum).
- Nach dem Merge: `git checkout main && git pull`.

## 10. Definition of Done

- [ ] `npm test` grün, neue Tests ergänzt
- [ ] Rechte serverseitig geprüft, Ablehnung getestet
- [ ] Auf Mobilbreite geprüft (falls UI betroffen)
- [ ] Keine neuen Abhängigkeiten, keine Secrets, kein `data/`
- [ ] UI-Texte deutsch, Code-Bezeichner englisch
- [ ] Dokumentation angepasst, wenn sich Verhalten ändert (README/CONTRIBUTING)

## 11. Bitte vorher fragen

Nicht einfach umbauen, sondern Rücksprache halten bei:

- neuen Laufzeitabhängigkeiten oder Build-Schritten
- Änderungen am Auth-Verfahren (Sessions, Cookies, Passwort-Hashing)
- Schema-Umbau (Spalten/Tabellen löschen oder umbenennen)
- Entfernen oder Umbenennen bestehender Features, Statuswerte oder Rechte
- Redesign/Neuaufbau von `styles.css` oder der Navigation
- Änderungen an `.github/`, `.githooks/` oder der CI-Konfiguration
