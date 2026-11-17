# Mitwirken bei HandwerkPro

Danke, dass du mitmachst! Dieses Dokument beschreibt, wie wir gemeinsam am Projekt arbeiten.

## Voraussetzungen

- **Node.js 24 oder neuer** (nutzt das eingebaute `node:sqlite`)
- Git
- Kein `npm install` nötig – das Projekt hat **keine Laufzeitabhängigkeiten**

```bash
git clone <repo-url>
cd GasWasserPro
npm start          # http://localhost:3000
npm test           # automatisierte Tests
```

Beim ersten Start entstehen Demo-Daten und Demo-Benutzer (siehe README).

## Projektstruktur

| Pfad | Inhalt |
|---|---|
| `server.js` | HTTP/HTTPS-Server, statische Dateien, Scheduler |
| `src/db.js` | Schema, Migrationen, Einstellungen, Nummernkreise |
| `src/api.js` | REST-API, Auth- und Rechteprüfung, alle Endpunkte |
| `src/permissions.js` | Rollen- und Rechte-Matrix (zentrale Wahrheit) |
| `src/auth.js`, `src/password.js` | Sessions, Cookies, scrypt |
| `src/work.js` | Materialparser, Fotos, Zeiterfassung |
| `src/billing.js`, `src/automation.js`, `src/documents.js`, `src/pdf.js` | Rechnungen, Automatik, PDF |
| `public/` | SPA (Vanilla JS), Styles, PWA |
| `test/smoke.test.js` | Tests inkl. HTTP-Flows |

## Goldene Regeln

1. **Rechte immer serverseitig prüfen.** Das Ausblenden im Frontend ist nur Komfort.
   Neue Endpunkte bekommen `{ permission: '…' }` oder `{ permissions: [ … ] }`.
   Neue Rechte gehören in `src/permissions.js` und in die README-Matrix.
2. **Keine externen Laufzeitabhängigkeiten** ohne vorherige Absprache. Das Projekt soll
   „Ordner kopieren, `npm start`, fertig" bleiben.
3. **Keine echten Daten einchecken.** `data/` (SQLite, PDFs, Fotos) ist per `.gitignore`
   ausgeschlossen und enthält später echte Kundendaten. Ebenfalls tabu: Zertifikate,
   Tokens, `.env`-Dateien.
4. **Deutsch als UI-Sprache**, technische Bezeichner auf Englisch. Bestehende Begriffe
   (z. B. Statuswerte `neu`, `geplant`, `in_arbeit`, `erledigt`, `abgerechnet`, `storniert`)
   nicht umbenennen – sie stehen so in Datenbank und API.
5. **Mobile zuerst mitdenken.** Neue Ansichten müssen auf dem Smartphone bedienbar sein
   (Touch-Ziele, Bottom-Nav, keine Hover-Abhängigkeiten).
6. **Bestehende Muster nutzen**: `route(...)` für Endpunkte, `openModal`/`formModal` für Dialoge,
   `toast(...)` für Rückmeldungen, `icon('name')` für Symbole.

## Arbeitsablauf

- `main` ist der gemeinsame, immer lauffähige Stand.
- Arbeiten auf Feature-Branches: `feature/kurzbeschreibung`, `fix/kurzbeschreibung`.
- Aussagekräftige Commits (z. B. `fix: Monteur sieht fremde Fotos nicht mehr`).
- Pull Request gegen `main` mit kurzer Beschreibung und der Checkliste aus dem Template.
- CI (Tests) muss grün sein; bei Team-Arbeit mindestens eine Review.

```bash
git checkout -b feature/mein-thema
# … ändern …
git add -A
git commit -m "feat: kurze Beschreibung"
git push -u origin feature/mein-thema
# danach auf GitHub: „Compare & pull request“
```

### main schützen

GitHub bietet Branch-Protection-Regeln für **private Repositories** nur mit
**GitHub Pro/Team** an. Falls der Plan das nicht enthält, gibt es zwei günstige Wege:

1. **Lokaler Hook (empfohlen, kostenlos).** Das Repo bringt `.githooks/pre-push` mit.
   Einmal pro Arbeitskopie aktivieren:

   ```bash
   git config core.hooksPath .githooks
   ```

   Danach blockiert Git direkte Pushes auf `main` und erinnert an den Branch-Workflow.
   Notfall-Ausnahme: `git push --no-verify`.

2. **Konvention + CI.** Auch ohne erzwungene Regeln zeigt die CI bei jedem Push und
   Pull Request sofort, ob die Tests grün sind. Bitte trotzdem immer über Branches
   und Pull Requests arbeiten.

### GitHub-Einstellungen (falls Pro/Team vorhanden)

Settings → Branches → *Add classic branch protection rule*:

- Branch name pattern: `main`
- ✅ Require a pull request before merging
- ✅ Require status checks to pass → Check **Tests** auswählen
- ✅ Do not allow bypassing the above settings

## Tests

```bash
npm test
```

- Jede Verhaltensänderung an der API bekommt einen Test in `test/smoke.test.js`.
- Die Tests laufen gegen eine temporäre Datenbank – niemals gegen `data/gaswasser.db`.
- Vor dem Push zusätzlich kurz manuell prüfen: Login als `monteur` und als `chef`,
  eine Seite auf dem Handy bzw. in der mobilen Ansicht.

## Datenbank ändern

- Neue Spalten: `ensureColumn(...)` in `src/db.js` ergänzen (sanfte Migration).
- Neue Tabellen: ins `SCHEMA` aufnehmen, Indizes mitdenken.
- Demo-Daten in `src/seed.js` nur ergänzen, wenn sie für alle sinnvoll sind.

## Sicherheit

- Sicherheitsrelevante Funde bitte **nicht** als öffentliches Issue, sondern direkt an die
  Maintainer.
- Demo-Passwörter (`chef123` …) sind nur für die lokale Demo gedacht – niemals für einen
  produktiven Server übernehmen.
