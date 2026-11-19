# Lumen

Un desktop più pulito per Windows: dock, barra dei menu, ricerca rapida, widget e strumenti in stile macOS. Minimal, personalizzabile, in italiano e inglese.

## Download

Scarica l'ultima versione dalla pagina [Releases](../../releases):

- **Lumen-Setup-x.y.z.exe** — installer (si aggiorna da solo)
- **Lumen-Portable-x.y.z.exe** — versione portatile, senza installazione

Al primo avvio Windows SmartScreen può mostrare un avviso perché l'app non è firmata: *Ulteriori informazioni → Esegui comunque*.

## Cosa fa

| | |
|---|---|
| **Dock** | Ingrandimento, cartelle a ventaglio, cestino, app aperte, anteprime delle finestre |
| **Barra dei menu** | App attiva, desktop virtuali, timer Pomodoro, CPU/RAM, batteria, orologio |
| **Ricerca rapida** (Alt+Spazio) | App, file, calcoli, unità e valute, comandi, snippet, preferiti e cronologia del browser |
| **Launchpad** (Alt+A) | Tutte le app installate a schermo intero, con ricerca e pagine |
| **Mission Control** (Alt+W) | Tutte le finestre affiancate, desktop virtuali |
| **Quick Look** (Alt+Q) | Anteprima del file selezionato in Esplora file: immagini, video, PDF, testo |
| **Centro di controllo** | Volume, luminosità, Wi-Fi, Bluetooth, tema scuro, Non disturbare, musica, profili, OBS |
| **Pannello laterale** | Notifiche, calendario con impegni, meteo, musica |
| **Appunti** (Ctrl+Shift+V) | Cronologia di testo e immagini (ignora i password manager) |
| **Snippet** | Scrivi una sigla, diventa testo, in qualsiasi app |
| **Finestre** | Ctrl+Alt+frecce per metà, quarti e terzi; layout salvati |
| **Profili** | Lavoro, Gioco, Batteria, Live (con OBS) |
| **Prestazioni** | Pulizia in un clic, app all'avvio, app preinstallate, effetti, avvisi RAM/disco |
| **Strumenti** | Selettore colore, rinomina in blocco, conversione immagini |
| **Aspetto** | Temi pronti (incluso Demoniaccio), sfondo dinamico, sfondo per desktop virtuale, widget |

## Sviluppo

```powershell
npm install
npm start          # avvia in sviluppo
npm run dist       # crea installer e versione portatile in dist/
npm run release    # crea e pubblica una release su GitHub (serve GH_TOKEN)
```

Electron + un piccolo motore nativo in PowerShell/C# compilato al volo (nessun SDK da installare).
