import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import iconv from 'iconv-lite';
import { XMLParser } from 'fast-xml-parser';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 3000;
const ELECTION_DATA_URL = 'https://www.volby.cz/pls/ps2021/vysledky_kandid';
const PARTY_DICTIONARY_URL = 'https://www.volby.cz/opendata/ps2021/xml/cvs.xml';
const PREFERENCE_THRESHOLD = 0.05;

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  trimValues: true,
});

const app = express();

app.use(express.static(path.join(__dirname, 'public')));

function ensureArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function parseNumber(raw) {
  if (raw == null) return NaN;
  const normalized = String(raw).replace(/\s+/g, '').replace(',', '.');
  const parsed = Number(normalized);
  return Number.isNaN(parsed) ? NaN : parsed;
}

function buildPartyMap(dictionaryRoot) {
  const candidatesRoot =
    dictionaryRoot?.SEZNAM?.STRANA ||
    dictionaryRoot?.SEZNAM_STRAN?.STRANA ||
    dictionaryRoot?.CIS_STR?.STRANA ||
    dictionaryRoot?.CIS?.STRANA ||
    dictionaryRoot?.STRANA;
  const items = ensureArray(candidatesRoot);
  const parties = new Map();
  for (const item of items) {
    const id =
      item?.KSTRANA ||
      item?.KOD ||
      item?.KOD_STR ||
      item?.CISLO ||
      item?.ID ||
      item?.PORADI;
    if (!id) continue;
    const name =
      item?.NAZEV ||
      item?.NAZEV1 ||
      item?.NAZEV_STR ||
      item?.TXT ||
      item?.ZKRATKA ||
      item?.ZKRATKA_STR;
    parties.set(String(id).trim(), name ? String(name).trim() : `Strana ${id}`);
  }
  return parties;
}

function resolveRegionNodes(electionRoot) {
  const fallback =
    electionRoot?.VYSLEDKY?.KRAJ ||
    electionRoot?.VYSLEDKY_KANDIDAT?.KRAJ ||
    electionRoot?.KRAJ ||
    [];
  return ensureArray(fallback);
}

function buildCandidates(electionRoot, parties) {
  const regions = resolveRegionNodes(electionRoot);
  const results = [];
  const regionList = [];

  for (const region of regions) {
    const regionCode =
      region?.CIS_KRAJ ||
      region?.KOD_KRAJ ||
      region?.KRAJ ||
      region?.KRAJ_CIS ||
      region?.ID_KRAJ;
    const regionName =
      region?.NAZEV_KRAJ ||
      region?.NAZ_KRAJ ||
      region?.NAZEV ||
      region?.TEXT;

    if (regionCode && regionName) {
      regionList.push({ code: String(regionCode).trim(), name: String(regionName).trim() });
    }

    const partyTotals = new Map();
    const partyNodes = [
      ...ensureArray(region?.STRANA),
      ...ensureArray(region?.STRANY?.STRANA),
    ];
    for (const party of partyNodes) {
      const partyId =
        party?.KSTRANA ||
        party?.STRANA ||
        party?.KOD ||
        party?.KOD_STRANA ||
        party?.ID ||
        party?.PORADI;
      if (!partyId) continue;
      const totalVotes = parseNumber(
        party?.POC_HLASU ||
          party?.HLASY ||
          party?.HLA ||
          party?.VOTES ||
          party?.text ||
          party?.['#text'],
      );
      if (!Number.isNaN(totalVotes) && totalVotes > 0) {
        partyTotals.set(String(partyId).trim(), totalVotes);
      }
    }

    const candidateNodes = [
      ...ensureArray(region?.KANDIDAT),
      ...ensureArray(region?.KANDIDATI?.KANDIDAT),
    ];
    for (const candidate of candidateNodes) {
      const partyId =
        candidate?.KSTRANA || candidate?.STRANA || candidate?.KOD_STRANA || candidate?.ID_STRANA;
      if (!partyId) continue;
      const partyKey = String(partyId).trim();
      const partyVotes = partyTotals.get(partyKey);
      if (!partyVotes || partyVotes <= 0) continue;

      const preferenceVotes = parseNumber(
        candidate?.HLASY ||
          candidate?.PREF_HLASY ||
          candidate?.POC_PRED_HLASU ||
          candidate?.text ||
          candidate?.['#text'],
      );
      if (Number.isNaN(preferenceVotes)) continue;
      if (preferenceVotes < partyVotes * PREFERENCE_THRESHOLD) continue;

      const candidateNumber =
        candidate?.PORCISLO || candidate?.PORADI || candidate?.PORADI_KAND || candidate?.PORADI_STR;
      const firstName = candidate?.JMENO || candidate?.JMENO1 || candidate?.JMENO_1;
      const lastName = candidate?.PRIJMENI || candidate?.PRIJMENI1 || candidate?.PRIJMENI_1;
      const titleBefore = candidate?.TITUL || candidate?.TITULPRED;
      const titleAfter = candidate?.TITULZA;

      const candidateName = [titleBefore, firstName, lastName, titleAfter]
        .filter(Boolean)
        .map((part) => String(part).trim())
        .filter((part) => part.length > 0)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim() || '(bez jména)';

      const regionLabel = regionName ? String(regionName).trim() : '—';
      const partyName = parties.get(partyKey) || `Strana ${partyKey}`;

      results.push({
        regionCode: regionCode ? String(regionCode).trim() : '',
        regionName: regionLabel,
        partyId: partyKey,
        partyName,
        candidateNumber: candidateNumber ? String(candidateNumber).trim() : '',
        candidateName,
        preferenceVotes,
        partyVotes,
        ratio: preferenceVotes / partyVotes,
      });
    }
  }

  const uniqueRegions = Array.from(new Map(regionList.map((item) => [item.code, item])).values())
    .filter((item) => item.code && item.name)
    .sort((a, b) => a.name.localeCompare(b.name, 'cs'));

  return { candidates: results, regions: uniqueRegions };
}

async function fetchXml(url) {
  const start = Date.now();
  const response = await fetch(url, {
    headers: {
      Accept: 'application/xml,text/xml;q=0.9,*/*;q=0.8',
    },
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} při čtení ${url}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const decoded = iconv.decode(buffer, 'windows-1250');
  const parsed = xmlParser.parse(decoded);
  const elapsed = Date.now() - start;
  console.info(`Staženo ${url} za ${elapsed} ms`);
  return parsed;
}

app.get('/api/candidates', async (req, res) => {
  try {
    const [dictionaryRoot, electionRoot] = await Promise.all([
      fetchXml(PARTY_DICTIONARY_URL),
      fetchXml(ELECTION_DATA_URL),
    ]);
    const parties = buildPartyMap(dictionaryRoot);
    const { candidates, regions } = buildCandidates(electionRoot, parties);
    res.json({
      generatedAt: new Date().toISOString(),
      candidates,
      regions,
    });
  } catch (error) {
    console.error('Nepodařilo se načíst data:', error);
    res.status(500).json({
      error: 'Nepodařilo se načíst podklady z volby.cz',
      details: error instanceof Error ? error.message : String(error),
    });
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server běží na http://localhost:${PORT}`);
});
