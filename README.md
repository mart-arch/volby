# Preferenční hlasy – volby 2021

Tento projekt zobrazuje kandidáty do Poslanecké sněmovny 2021, kteří ve svém kraji
získali alespoň 5 % preferenčních hlasů své strany. Celá aplikace běží na straně
klienta, takže ji lze nasadit na [GitHub Pages](https://pages.github.com/)
bez nutnosti provozovat vlastní backend.

## Omezení GitHub Pages

GitHub Pages poskytuje pouze statické soubory. Všechny požadavky na externí API
jsou tedy zpracovávány přímo prohlížečem a podléhají CORS pravidlům cílového
serveru. Pokud server `volby.cz` nevrací hlavičku `Access-Control-Allow-Origin`
s hodnotou umožňující přístup z vašeho webu, prohlížeč požadavek z bezpečnostních
důvodů zablokuje. V takovém případě je nutné použít vlastní CORS proxy (např.
s implementací na Cloudflare Workers, Vercelu apod.), která požadavky přepošle a
potřebné hlavičky doplní.

Aplikace umožňuje zadat URL takové proxy přímo v rozhraní. Pokud pole ponecháte
prázdné, pokusí se nejprve o přímé načtení bez proxy.

## Lokální spuštění

Protože jde o čistě statický web, postačí jakýkoliv HTTP server. Nejjednodušší je
použít vestavěný server v Pythonu:

```bash
python3 -m http.server 8000
```

Poté otevřete stránku [http://localhost:8000](http://localhost:8000) ve svém
prohlížeči.

## Struktura projektu

- `index.html` – základní HTML stránka v češtině.
- `styles.css` – responzivní vzhled se světlým i tmavým režimem.
- `app.js` – načtení XML z `volby.cz`, jejich dekódování (Windows-1250) a
  filtrování kandidátů splňujících hranici 5 %.

## Nasazení na GitHub Pages

1. Nahrajte obsah repozitáře do větve `main`.
2. V nastavení GitHub Pages zvolte zdroj `Deploy from a branch` a složku `/ (root)`.
3. Po nasazení spusťte aplikaci ve svém prohlížeči. Pokud se data nenačtou, zadejte
   v sekci „Pokročilé nastavení“ URL své CORS proxy a stránku znovu načtěte.

## Licence

Projekt je poskytován „tak jak je“ bez záruky. Data pochází z veřejných zdrojů
Českého statistického úřadu.
