const CANDIDATES_URL = 'https://www.volby.cz/pls/ps2021/vysledky_kandid';
const PARTY_DICTIONARY_URL = 'https://www.volby.cz/opendata/ps2021/xml/cvs.xml';

const statusElement = document.getElementById('status');
const resultsSection = document.getElementById('results-section');
const tableBody = document.getElementById('results-body');

function setStatus(message, isError = false) {
  statusElement.textContent = message;
  statusElement.classList.toggle('error', isError);
}

function formatNumber(value) {
  return new Intl.NumberFormat('cs-CZ').format(value);
}

function formatPercent(numerator, denominator) {
  if (!denominator) {
    return '—';
  }
  const value = (numerator / denominator) * 100;
  return `${value.toFixed(2).replace('.', ',')} %`;
}

function parseNumber(value) {
  if (typeof value !== 'string') {
    return Number.NaN;
  }
  const normalized = value.replace(/\s+/g, '').replace(/\u00a0/g, '');
  const parsed = Number.parseInt(normalized, 10);
  return Number.isNaN(parsed) ? Number.NaN : parsed;
}

function getNodeValue(node, possibleNames) {
  for (const name of possibleNames) {
    if (node.hasAttribute?.(name)) {
      const value = node.getAttribute(name);
      if (value !== null) {
        return value.trim();
      }
    }
    const child = node.querySelector?.(name);
    if (child && child.textContent) {
      return child.textContent.trim();
    }
  }
  return undefined;
}

async function fetchXml(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Načtení ${url} selhalo (HTTP ${response.status}).`);
  }
  const text = await response.text();
  const parser = new DOMParser();
  const doc = parser.parseFromString(text, 'application/xml');
  if (doc.querySelector('parsererror')) {
    throw new Error(`Dokument z ${url} není platné XML.`);
  }
  return doc;
}

function buildPartyDictionary(dictionaryDoc) {
  const dictionary = new Map();
  dictionaryDoc.querySelectorAll('STRANA').forEach((party) => {
    const id = getNodeValue(party, ['KSTRANA', 'CIS_STRANA', 'CISLO_STRANY']);
    const name = getNodeValue(party, ['NAZEV', 'NAZ_STRANA', 'NAZEV_STRANY']);
    if (id) {
      dictionary.set(id, name ?? '');
    }
  });
  return dictionary;
}

function extractPartyVotes(regionNode) {
  const map = new Map();
  const partiesRoot = regionNode.querySelector('STRANY');
  if (!partiesRoot) {
    return map;
  }
  partiesRoot.querySelectorAll('STRANA').forEach((partyNode) => {
    const id = getNodeValue(partyNode, ['CISLO_STRANY', 'KSTRANA']);
    const voteCount = parseNumber(getNodeValue(partyNode, ['POC_HLASU', 'HLASY']));
    if (id && Number.isFinite(voteCount)) {
      map.set(id, voteCount);
    }
  });
  return map;
}

function extractQualifiedCandidates(regionNode, partyNames) {
  const results = [];
  const regionName = getNodeValue(regionNode, ['NAZEV_KRAJ', 'NAZ_KRAJ']);
  const partyVotes = extractPartyVotes(regionNode);
  const candidatesRoot = regionNode.querySelector('KANDIDATI');
  if (!candidatesRoot) {
    return results;
  }

  candidatesRoot.querySelectorAll('KANDIDAT').forEach((candidateNode) => {
    const partyId = getNodeValue(candidateNode, ['STRANA', 'KSTRANA', 'CISLO_STRANY']);
    const candidateNumber = getNodeValue(candidateNode, ['POR_STRANA', 'PORADOVE_CISLO', 'PORCISLO', 'PORADI']);
    const firstName = getNodeValue(candidateNode, ['JMENO']);
    const lastName = getNodeValue(candidateNode, ['PRIJMENI']);
    const votes = parseNumber(
      getNodeValue(candidateNode, [
        'HLASY',
        'POC_PREFERENC',
        'POC_PREDNOST',
        'POC_PREDNOSTNI',
        'POC_PREFERENCNICH',
      ]),
    );

    if (!partyId || !Number.isFinite(votes)) {
      return;
    }

    const totalPartyVotes = partyVotes.get(partyId);
    if (!Number.isFinite(totalPartyVotes)) {
      return;
    }

    if (votes >= totalPartyVotes * 0.05) {
      results.push({
        regionName: regionName ?? 'Neznámý kraj',
        candidateNumber: candidateNumber ?? '—',
        candidateName: [firstName, lastName].filter(Boolean).join(' ') || 'Bez jména',
        partyId,
        partyName: partyNames.get(partyId) ?? 'Neznámá strana',
        votes,
        totalPartyVotes,
        ratio: votes / totalPartyVotes,
      });
    }
  });

  return results;
}

function renderResults(candidates) {
  tableBody.replaceChildren();
  const fragment = document.createDocumentFragment();

  candidates
    .sort((a, b) => {
      if (a.regionName !== b.regionName) {
        return a.regionName.localeCompare(b.regionName, 'cs');
      }
      if (a.partyId !== b.partyId) {
        return a.partyId.localeCompare(b.partyId, 'cs');
      }
      return (a.candidateNumber || '').localeCompare(b.candidateNumber || '', 'cs', { numeric: true });
    })
    .forEach((item) => {
      const row = document.createElement('tr');

      const cells = [
        item.regionName,
        item.candidateNumber,
        item.candidateName,
        item.partyId,
        item.partyName,
        formatNumber(item.votes),
        formatNumber(item.totalPartyVotes),
        formatPercent(item.votes, item.totalPartyVotes),
      ];

      cells.forEach((value) => {
        const cell = document.createElement('td');
        cell.textContent = value;
        row.appendChild(cell);
      });

      fragment.appendChild(row);
    });

  tableBody.appendChild(fragment);
}

async function init() {
  try {
    setStatus('Načítám data ze serveru volby.cz…');
    const [candidatesDoc, partyDictionaryDoc] = await Promise.all([
      fetchXml(CANDIDATES_URL),
      fetchXml(PARTY_DICTIONARY_URL),
    ]);

    const partyNames = buildPartyDictionary(partyDictionaryDoc);
    const qualifiedCandidates = [];

    candidatesDoc.querySelectorAll('KRAJ').forEach((regionNode) => {
      qualifiedCandidates.push(
        ...extractQualifiedCandidates(regionNode, partyNames),
      );
    });

    if (qualifiedCandidates.length === 0) {
      setStatus('Žádný kandidát nesplnil požadovaný limit preferenčních hlasů.');
      return;
    }

    renderResults(qualifiedCandidates);
    setStatus(`Nalezeno ${qualifiedCandidates.length} kandidátů splňujících podmínku.`);
    resultsSection.classList.remove('hidden');
  } catch (error) {
    console.error(error);
    setStatus(error.message || 'Při načítání dat došlo k chybě.', true);
  }
}

init();
