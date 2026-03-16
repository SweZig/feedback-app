# Feedback App – Projektdokumentation

## Översikt
NPS-applikation (Net Promoter Score) byggd i React. Samlar in, lagrar och visualiserar kundnöjdhet via enkäter. Stöder flera kedjor, avdelningar och mätpunkter med olika insamlingslägen.

- **URL:** https://feedbackapp.store
- **GitHub:** https://github.com/SweZig/feedback-app
- **Lokalt:** `npm start` → http://localhost:3000
- **Deploy:** Vercel (auto-deploy från `master`-branchen)

---

## Tech Stack
- React (Create React App)
- Ingen backend – all data i `localStorage`
- Inget externt bibliotek förutom CRA-standard

---

## Filstruktur

```
src/
├── App.js                        # Root – routing, URL ?tp= läsning
├── App.css                       # CSS-variabler och global layout
├── components/
│   ├── Navigation.js/css         # Toppmeny med logo + sidnavigering
│   ├── SurveyPage.js/css         # Enkätformuläret
│   ├── ReportPage.js/css         # Rapportsidan med filter och NPS
│   ├── SettingsPage.js/css       # Inställningar (5-sektions vänstermeny)
│   ├── ScoreSelector.js/css      # NPS 0–10 knappar
│   ├── DistributionBar.js/css    # Fördelningsbar (kritiker/passiva/ambassadörer)
│   └── CommentList.js/css        # Kommentarslista i rapporten
└── utils/
    ├── settings.js               # All datalogik för kedjor/avdelningar/mätpunkter
    ├── storage.js                # Hantering av enkätsvar i localStorage
    ├── npsCalculations.js        # NPS-beräkning och kategorisering
    ├── export.js                 # CSV- och Excel-export
    └── backup.js                 # JSON backup export/import
```

---

## Datastruktur (localStorage)

### `npsCustomers` – Kedjor
```json
[{
  "id": "uuid",
  "name": "ICA Gruppen",
  "customLogo": "base64...",
  "physicalConfig": { ... },
  "onlineConfig": { ... },
  "otherConfig": { ... },
  "departments": [
    { "id": "uuid", "name": "ICA Stockholm City", "uniqueCode": "STO-1", "order": 0 }
  ],
  "touchpoints": [
    {
      "id": "uuid",
      "name": "Kassa 1",
      "departmentId": "uuid",
      "type": "physical",
      "mode": "app",
      "order": 0,
      "configOverride": null
    }
  ],
  "activeTouchpointId": "uuid"
}]
```

### `npsResponses` – Enkätsvar
```json
[{
  "id": "uuid",
  "score": 9,
  "comment": "Bra service!",
  "predefinedAnswer": "Snabb betjäning",
  "customerId": "uuid",
  "touchpointId": "uuid",
  "timestamp": 1234567890000
}]
```

### `npsActiveCustomerId` – Aktiv kedja
```
"uuid-string"
```

---

## Hierarki

```
Kedja (t.ex. ICA Gruppen)
  └── Avdelning (t.ex. ICA Stockholm City, ID: STO-1)
        └── Mätpunkt (t.ex. Kassa 1, typ: Fysisk, läge: Enkät)
        └── Mätpunkt (t.ex. Online-beställning, typ: Online, läge: Länk)
  └── Avdelning (t.ex. ICA Central Kundtjänst)
        └── Mätpunkt (t.ex. Telefon, typ: Övriga, läge: QR)
```

**Avdelning** = ren namngivna container med unikt ID. Samlar inte in data.  
**Mätpunkt** = det som faktiskt samlar in data. Har typ + läge + konfiguration.

---

## Mätpunktstyper
| Typ | Färg | Användning |
|-----|------|-----------|
| `physical` | Blå | Fysisk butik/plats |
| `online` | Grön | Webbshop, digital kanal |
| `other` | Grå | Kundtjänst, hemkörning, övriga |

## Insamlingslägen
| Läge | Beskrivning |
|------|-------------|
| `app` | Enkät-läge – visas direkt i appen/surfplattan |
| `qr` | QR-kod som pekar på `?tp=ID` |
| `link` | Webblänk för nyhetsbrev/e-post |
| `embed` | Inbäddbar iframe-kod för webbsida |

**URL-format:** `https://feedbackapp.store/?tp=TOUCHPOINT_ID`  
App.js läser `?tp=`-parametern automatiskt och aktiverar rätt mätpunkt.

---

## NPS-färger
```css
--color-detractor: #e74c3c;   /* 0–6  Kritiker */
--color-passive:   #f39c12;   /* 7–8  Passiva */
--color-promoter:  #27ae60;   /* 9–10 Ambassadörer */
--color-primary:   #1e3a4f;   /* Mörk blå – primärfärg */
```

---

## Inställningar – Vänstermeny
1. **Kedjor** – Lägg till/ta bort kedjor, drag & drop, logotyp per kedja, nollställ data
2. **Avdelningar** – Expanderbar lista, mätpunkter per avdelning, migreringsknapp, drag & drop
3. **Konfiguration** – Per typ (Fysisk/Online/Övriga), bulk-tillämpa på alla mätpunkter
4. **Säkerhetskopiering** – JSON export/import med val av kedjor

### Konfiguration per mätpunkt
- Färgläge på NPS-skala (färg/neutral) – endast Fysisk
- Nedräkning efter svar (3–20 sek) – alla typer i Enkät-läge
- Fritextfält på/av
- Fördefinierade svarsalternativ (max 6, drag & drop)
- Ny mätpunkt ärver kedjans typkonfiguration automatiskt
- Individuell override möjlig via popup på varje mätpunkt

---

## Rapport – Filter
- **Typ:** Hela kedjan / Alla fysiska / Alla online / Alla övriga
- **Specifik:** Dropdown med avdelning (alla dess mätpunkter) eller enskild mätpunkt
- **Tid:** 7 / 30 / 90 dagar / Alla / Eget datumintervall
- **Export:** CSV (semikolon, BOM för Excel) och XLS med kolumnerna:
  Datum, Tid, Kedja, Avdelning, Avdelnings-ID, Mätpunkt, Typ, Läge, Poäng, Kategori, Svarsalternativ, Kommentar

---

## Backup
- **Export:** JSON-fil med valda kedjor (npsCustomers + npsResponses + aktiv kedja)
- **Import:** Välj fil → välj kedjor → data slås ihop, dubbletter (samma `id`) hoppas över
- Migrera lokala data till Vercel: exportera JSON lokalt → importera på Vercel-URL

---

## Migrera mätpunkter
Expandera en avdelning med mätpunkter → knapp **"⇄ Migrera till alla övriga avdelningar"**  
Kopierar namn + typ + läge till alla övriga avdelningar. Hoppar över om namn redan finns.

---

## Deploy-flöde
```powershell
git add .
git commit -m "Beskrivning"
git push origin main
git push origin main:master   # Vercel deployas från master
```
Vercel känner av push till `master` och deployas automatiskt (~1 min).

---

## Kända begränsningar
- All data i `localStorage` – delas inte mellan enheter/webbläsare
- Ingen autentisering – appen är öppen för alla med URL:en
- localStorage-gräns ~5MB – räcker länge för normal NPS-användning
- `master`-branchen är Vercels deploy-branch (inte `main`) pga GitHub default-branch-inställning

---

## Framtida idéer (ej byggt)
- Excel-mall för bulk-import av kedjor/avdelningar/mätpunkter
- Periodnollställning (från/till datum) – datastrukturen är förberedd
- Backend/databas för delad data mellan enheter
- Autentisering
