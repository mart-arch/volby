# Preferenční hlasy – volby 2021

Tento projekt kombinuje klientskou aplikaci a serverovou proxy. Serverová část stáhne
oficiální XML soubory České volební statistiky, dekóduje je z Windows-1250 a převede
je na JSON. Frontend následně zobrazí kandidáty, kteří ve svém kraji získali alespoň
5 % preferenčních hlasů své strany, včetně názvu strany z číselníku `cvs.xml`.

## Jak aplikace funguje

1. Express server zpřístupňuje statické soubory v adresáři `public/` a endpoint
   `GET /api/candidates`.
2. Při každém dotazu na API se stáhnou dva XML dokumenty:
   - `https://www.volby.cz/pls/ps2021/vysledky_kandid`
   - `https://www.volby.cz/opendata/ps2021/xml/cvs.xml`
3. Server agreguje data za všechny kraje, u každého kandidáta spočte podíl
   preferenčních hlasů vůči celkovému počtu hlasů strany v daném kraji a vrátí jen ty,
   kteří dosáhli alespoň 5 %.
4. Frontend zobrazuje výsledky v přehledné tabulce s možností filtrovat podle kraje.

> **Poznámka:** Při nasazení mimo GitHub Pages je potřeba, aby běžel Node.js server,
> který proxy poskytuje. GitHub Pages samotné serverovou logiku nepodporuje.

## Požadavky

- Node.js 18+

## Lokální spuštění

```bash
npm install
npm start
```

Aplikace se spustí na adrese <http://localhost:3000>. Po načtení stránky proběhne
volání `/api/candidates`; v případě problémů zkontrolujte log serveru v konzoli.

## Struktura projektu

- `public/index.html` – HTML rozhraní s filtrem krajů a tabulkou kandidátů.
- `public/styles.css` – responzivní vzhled včetně tmavého režimu.
- `public/app.js` – klientská logika pro načtení a vykreslení dat.
- `server.js` – Express server, který zprostředkuje data ve formátu JSON.

## Licence

Projekt je poskytován „tak jak je“ bez záruky. Data pochází z veřejných zdrojů
Českého statistického úřadu.
