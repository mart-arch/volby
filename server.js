import express from 'express';
import fetch from 'node-fetch';
import iconv from 'iconv-lite';
import { XMLParser } from 'fast-xml-parser';

const app = express();
const PORT = process.env.PORT || 3000;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  textNodeName: 'value',
  parseTagValue: false,
});

const candidateUrl = 'https://www.volby.cz/pls/ps2021/vysledky_kandid';
const partyDictionaryUrl = 'https://www.volby.cz/opendata/ps2021/xml/cvs.xml';

app.use(express.static('public'));

function toArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function extractNumber(value) {
  if (value === undefined || value === null) {
    return NaN;
  }
  if (typeof value === 'number') {
    return value;
  }
  if (typeof value === 'string') {
    const normalized = value.replace(/\s+/g, '').replace(',', '.');
    const parsed = Number(normalized);
    return Number.isNaN(parsed) ? NaN : parsed;
  }
  if (typeof value === 'object' && 'value' in value) {
    return extractNumber(value.value);
  }
  return NaN;
}

function firstDefined(object, candidates) {
  for (const key of candidates) {
    if (key in object && object[key] !== undefined) {
      return object[key];
    }
  }
  return undefined;
}

async function fetchXml(url, encoding = 'utf-8') {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; ElectionDataFetcher/1.0)',
      'Accept': 'application/xml,text/xml;q=0.9,*/*;q=0.8',
      'Referer': 'https://www.volby.cz/',
    },
  });

  if (!response.ok) {
    const message = `Request to ${url} failed with status ${response.status}`;
    throw new Error(message);
  }

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const text = iconv.decode(buffer, encoding);
  return parser.parse(text);
}

async function buildPartyDictionary() {
  const rawDictionary = await fetchXml(partyDictionaryUrl, 'windows-1250');
  const result = new Map();

  const dictionaryRoot = rawDictionary?.CISOB || rawDictionary?.CIS || rawDictionary;
  const partyContainer =
    dictionaryRoot?.STRANY ||
    dictionaryRoot?.STRANA ||
    dictionaryRoot?.TABULKA ||
    dictionaryRoot?.ciselnik ||
    dictionaryRoot;

  const partyEntries = toArray(partyContainer?.STRANA || partyContainer?.row || partyContainer);
  for (const partyEntry of partyEntries) {
    if (!partyEntry) continue;
    const partyId = firstDefined(partyEntry, ['KSTRANA', 'KOD', 'CISLO', 'K_CISLO', 'ID', 'KOD_STR']) || partyEntry?.['@_KSTRANA'];
    if (!partyId) {
      continue;
    }

    const name =
      firstDefined(partyEntry, ['NAZEV', 'NAZEV_STRANA', 'NAZEV_STR', 'TXT', 'text', 'NAZEV1']) ||
      partyEntry?.['@_NAZEV'] ||
      partyEntry?.['@_NAZEV_STR'];

    const shortName =
      firstDefined(partyEntry, ['ZKRATKA', 'ZKRATKA_STR', 'ZKRATKA8']) ||
      partyEntry?.['@_ZKRATKA'] ||
      partyEntry?.['@_ZKRATKA_STR'];

    const displayName = name ? name : shortName ? shortName : `Strana ${partyId}`;
    result.set(String(partyId).trim(), displayName.trim());
  }

  return result;
}

function collectQualifiedCandidates(electionData, partyNames) {
  const qualified = [];
  const regions = toArray(electionData?.VYSLEDKY?.KRAJ || electionData?.KRAJE || electionData?.KRAJ);
  for (const region of regions) {
    if (!region) continue;

    const regionName =
      firstDefined(region, ['NAZEV_KRAJ', 'NAZ_KRAJ', 'NAZEV', 'NAZ_KRAJ_SHORT']) ||
      region?.['@_NAZEV_KRAJ'] ||
      region?.['@_NAZEV'];

    const regionCode =
      firstDefined(region, ['CIS_KRAJ', 'KRAJ', 'KOD_KRAJ', 'KOD']) ||
      region?.['@_CIS_KRAJ'] ||
      region?.['@_KOD'];

    const partyVoteContainer = region?.STRANY || region?.STRANA || region;
    const partyItems = toArray(partyVoteContainer?.STRANA || partyVoteContainer);
    const partyVotes = new Map();
    for (const party of partyItems) {
      if (!party) continue;
      const partyIdRaw =
        firstDefined(party, ['KSTRANA', 'STRANA', 'KOD', 'KOD_STRANA', 'ID']) ||
        party?.['@_KSTRANA'] ||
        party?.['@_KOD'];
      const partyId = partyIdRaw ? String(partyIdRaw).trim() : undefined;
      if (!partyId) continue;
      const votesValue = firstDefined(party, ['POC_HLASU', 'HLASY', 'VOTES', 'HLA']) || party?.['@_POC_HLASU'];
      const votes = extractNumber(votesValue);
      if (!Number.isNaN(votes)) {
        partyVotes.set(partyId, votes);
      }
    }

    const candidateContainer = region?.KANDIDATI || region?.KANDIDAT || region;
    const candidateItems = toArray(candidateContainer?.KANDIDAT || candidateContainer);
    for (const candidate of candidateItems) {
      if (!candidate) continue;
      const partyIdRaw =
        firstDefined(candidate, ['KSTRANA', 'STRANA', 'KOD_STRANA']) ||
        candidate?.['@_KSTRANA'] ||
        candidate?.['@_KOD_STRANA'];
      const partyId = partyIdRaw ? String(partyIdRaw).trim() : undefined;
      if (!partyId) continue;

      const partyTotalVotes = partyVotes.get(partyId);
      if (!partyTotalVotes || partyTotalVotes <= 0) {
        continue;
      }

      const prefVotesValue = firstDefined(candidate, ['HLASY', 'PREF_HLASY', 'POC_PRED_HLASU']) || candidate?.['@_HLASY'];
      const prefVotes = extractNumber(prefVotesValue);
      if (Number.isNaN(prefVotes)) {
        continue;
      }

      if (prefVotes < partyTotalVotes * 0.05) {
        continue;
      }

      const candidateNumber =
        firstDefined(candidate, ['PORCISLO', 'PORADI', 'PORADI_KAND', 'PORC']) ||
        candidate?.['@_PORCISLO'] ||
        candidate?.['@_PORADI'];

      const firstName =
        firstDefined(candidate, ['JMENO', 'JMENO_KANDIDATA', 'JMENO1']) ||
        candidate?.['@_JMENO'];
      const lastName =
        firstDefined(candidate, ['PRIJMENI', 'PRIJMENI_KANDIDATA', 'PRIJMENI1']) ||
        candidate?.['@_PRIJMENI'];
      const title =
        firstDefined(candidate, ['TITUL', 'TITULPRED', 'TITUL_ZA']) ||
        candidate?.['@_TITUL'];

      const partyName = partyNames.get(partyId) || `Strana ${partyId}`;
      const candidateName = [title, firstName, lastName].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();

      qualified.push({
        regionCode: regionCode ? String(regionCode).trim() : undefined,
        regionName: regionName ? regionName.trim() : undefined,
        partyId,
        partyName,
        candidateNumber: candidateNumber ? String(candidateNumber).trim() : undefined,
        votes: prefVotes,
        partyVotes: partyTotalVotes,
        candidateName,
      });
    }
  }

  return qualified;
}

app.get('/api/candidates', async (_req, res) => {
  try {
    const [partyNames, electionData] = await Promise.all([
      buildPartyDictionary(),
      fetchXml(candidateUrl, 'windows-1250'),
    ]);
    const qualifiedCandidates = collectQualifiedCandidates(electionData, partyNames);
    res.json({ candidates: qualifiedCandidates });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to load election data' });
  }
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
