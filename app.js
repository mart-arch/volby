const ELECTION_DATA_URL = 'https://www.volby.cz/pls/ps2021/vysledky_kandid';
const PARTY_DICTIONARY_URL = 'https://www.volby.cz/opendata/ps2021/xml/cvs.xml';
const PREFERENCE_THRESHOLD = 0.05;
const LOCAL_STORAGE_KEY = 'volby-preferences';

const numberFormatter = new Intl.NumberFormat('cs-CZ');
const percentFormatter = new Intl.NumberFormat('cs-CZ', {
  style: 'percent',
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

const dom = {
  status: document.getElementById('status'),
  tableBody: document.querySelector('#resultsTable tbody'),
  rowTemplate: document.getElementById('rowTemplate'),
  regionFilter: document.getElementById('regionFilter'),
  reloadButton: document.getElementById('reloadButton'),
  proxyInput: document.getElementById('proxyInput'),
};

const state = {
  candidates: [],
  regions: [],
  proxyUrl: '',
};

function loadPreferences() {
  try {
    const raw = window.localStorage.getItem(LOCAL_STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (parsed.proxyUrl && typeof parsed.proxyUrl === 'string') {
      state.proxyUrl = parsed.proxyUrl;
    }
  } catch (error) {
    console.warn('Failed to load stored preferences', error);
  }
}

function savePreferences() {
  try {
    const payload = JSON.stringify({ proxyUrl: state.proxyUrl });
    window.localStorage.setItem(LOCAL_STORAGE_KEY, payload);
  } catch (error) {
    console.warn('Failed to persist preferences', error);
  }
}

function setStatus(message, options = {}) {
  const { isError = false, details } = options;
  dom.status.textContent = '';
  dom.status.classList.toggle('status--error', Boolean(isError));
  if (message) {
    const strong = document.createElement('strong');
    strong.textContent = message;
    dom.status.appendChild(strong);
  }
  if (details) {
    const detailBlock = document.createElement('div');
    detailBlock.textContent = details;
    dom.status.appendChild(detailBlock);
  }
}

function combineProxyUrl(proxyUrl, targetUrl) {
  if (!proxyUrl) {
    return targetUrl;
  }
  const trimmed = proxyUrl.trim();
  if (!trimmed) {
    return targetUrl;
  }
  if (trimmed.includes('{url}')) {
    return trimmed.replaceAll('{url}', encodeURIComponent(targetUrl));
  }
  if (trimmed.endsWith('/')) {
    return trimmed + targetUrl;
  }
  return `${trimmed}/${targetUrl}`;
}

async function fetchXml(url, encoding = 'windows-1250') {
  const attempts = [];
  attempts.push({ label: 'přímé připojení', url });
  if (state.proxyUrl) {
    attempts.push({ label: 'CORS proxy', url: combineProxyUrl(state.proxyUrl, url) });
  }

  const encountered = [];
  for (const attempt of attempts) {
    try {
      const response = await fetch(attempt.url, {
        headers: {
          Accept: 'application/xml,text/xml;q=0.9,*/*;q=0.8',
        },
        cache: 'no-store',
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} při čtení ${attempt.label}`);
      }
      const buffer = await response.arrayBuffer();
      const decoder = new TextDecoder(encoding);
      const text = decoder.decode(buffer);
      const doc = new DOMParser().parseFromString(text, 'application/xml');
      if (doc.querySelector('parsererror')) {
        throw new Error('XML dokument se nepodařilo zpracovat');
      }
      return doc;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      encountered.push(`${attempt.label}: ${reason}`);
    }
  }

  throw new Error(encountered.join('\n'));
}

function getFirstAvailable(node, keys) {
  for (const key of keys) {
    const attr = node.getAttribute?.(key);
    if (attr && attr.trim()) {
      return attr.trim();
    }
    const child = node.querySelector?.(key);
    if (child) {
      const text = child.textContent?.trim();
      if (text) {
        return text;
      }
    }
  }
  return undefined;
}

function parseNumber(value) {
  if (value == null) {
    return NaN;
  }
  const normalized = String(value).replace(/\s+/g, '').replace(',', '.');
  const parsed = Number(normalized);
  return Number.isNaN(parsed) ? NaN : parsed;
}

function parsePartyDictionary(doc) {
  const parties = new Map();
  const stranaNodes = Array.from(doc.getElementsByTagName('STRANA'));
  for (const node of stranaNodes) {
    const id =
      getFirstAvailable(node, ['KSTRANA', 'KOD', 'KOD_STR', 'CISLO', 'ID']) ||
      node.getAttribute?.('PORADI');
    if (!id) {
      continue;
    }
    const name =
      getFirstAvailable(node, ['NAZEV', 'NAZEV_STR', 'NAZEV1', 'TXT']) ||
      getFirstAvailable(node, ['ZKRATKA', 'ZKRATKA_STR', 'ZKRATKA8']);
    parties.set(String(id).trim(), name ? name.trim() : `Strana ${id}`);
  }
  return parties;
}

function parseElectionData(doc, parties) {
  const candidates = [];
  const regions = [];
  const regionNodes = Array.from(doc.getElementsByTagName('KRAJ'));

  for (const regionNode of regionNodes) {
    const regionCode =
      getFirstAvailable(regionNode, ['CIS_KRAJ', 'KOD_KRAJ', 'KRAJ']) ||
      regionNode.getAttribute?.('KRAJ');
    const regionName =
      getFirstAvailable(regionNode, ['NAZEV_KRAJ', 'NAZ_KRAJ', 'NAZEV']) ||
      regionNode.getAttribute?.('NAZEV_KRAJ');

    if (regionCode && regionName) {
      regions.push({ code: regionCode, name: regionName });
    }

    const partyVotes = new Map();
    const partyNodes = Array.from(regionNode.getElementsByTagName('STRANA'));
    for (const partyNode of partyNodes) {
      const partyId =
        getFirstAvailable(partyNode, ['KSTRANA', 'STRANA', 'KOD', 'KOD_STRANA', 'ID']) ||
        partyNode.getAttribute?.('PORADI');
      if (!partyId) continue;
      const totalVotesRaw =
        getFirstAvailable(partyNode, ['POC_HLASU', 'HLASY', 'HLA', 'VOTES']) ||
        partyNode.getAttribute?.('POC_HLASU');
      const totalVotes = parseNumber(totalVotesRaw);
      if (!Number.isNaN(totalVotes)) {
        partyVotes.set(String(partyId).trim(), totalVotes);
      }
    }

    const candidateNodes = Array.from(regionNode.getElementsByTagName('KANDIDAT'));
    for (const candidateNode of candidateNodes) {
      const partyId =
        getFirstAvailable(candidateNode, ['KSTRANA', 'STRANA', 'KOD_STRANA']) ||
        candidateNode.getAttribute?.('KSTRANA');
      if (!partyId) continue;
      const partyTotal = partyVotes.get(String(partyId).trim());
      if (!partyTotal || partyTotal <= 0) continue;

      const candidateVotesRaw =
        getFirstAvailable(candidateNode, ['HLASY', 'PREF_HLASY', 'POC_PRED_HLASU']) ||
        candidateNode.getAttribute?.('HLASY');
      const candidateVotes = parseNumber(candidateVotesRaw);
      if (Number.isNaN(candidateVotes)) continue;

      if (candidateVotes < partyTotal * PREFERENCE_THRESHOLD) {
        continue;
      }

      const candidateNumber =
        getFirstAvailable(candidateNode, ['PORCISLO', 'PORADI', 'PORADI_KAND']) ||
        candidateNode.getAttribute?.('PORCISLO');
      const firstName =
        getFirstAvailable(candidateNode, ['JMENO', 'JMENO1']) ||
        candidateNode.getAttribute?.('JMENO');
      const lastName =
        getFirstAvailable(candidateNode, ['PRIJMENI', 'PRIJMENI1']) ||
        candidateNode.getAttribute?.('PRIJMENI');
      const title =
        getFirstAvailable(candidateNode, ['TITUL', 'TITULPRED']) ||
        candidateNode.getAttribute?.('TITUL');

      const displayName = [title, firstName, lastName]
        .filter(Boolean)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();

      const partyName = parties.get(String(partyId).trim()) || `Strana ${partyId}`;

      candidates.push({
        regionCode: regionCode || '',
        regionName: regionName || '',
        partyId: String(partyId).trim(),
        partyName,
        candidateNumber: candidateNumber ? String(candidateNumber).trim() : '',
        candidateName: displayName || '(bez jména)',
        preferenceVotes: candidateVotes,
        partyVotes: partyTotal,
        ratio: candidateVotes / partyTotal,
      });
    }
  }

  const uniqueRegions = Array.from(
    new Map(regions.map((item) => [item.code, item])).values()
  ).sort((a, b) => a.name.localeCompare(b.name, 'cs'));

  return { candidates, regions: uniqueRegions };
}

function renderRegionFilter(regions) {
  while (dom.regionFilter.options.length > 1) {
    dom.regionFilter.remove(1);
  }
  for (const region of regions) {
    const option = document.createElement('option');
    option.value = region.code;
    option.textContent = region.name;
    dom.regionFilter.appendChild(option);
  }
}

function renderCandidates(candidates) {
  dom.tableBody.innerHTML = '';
  const regionFilterValue = dom.regionFilter.value;

  const filtered = regionFilterValue
    ? candidates.filter((candidate) => candidate.regionCode === regionFilterValue)
    : candidates.slice();

  filtered.sort((a, b) => {
    const regionCompare = a.regionName.localeCompare(b.regionName, 'cs');
    if (regionCompare !== 0) return regionCompare;
    const partyCompare = a.partyName.localeCompare(b.partyName, 'cs');
    if (partyCompare !== 0) return partyCompare;
    const ratioCompare = b.ratio - a.ratio;
    if (Math.abs(ratioCompare) > Number.EPSILON) return ratioCompare;
    return (a.candidateNumber || '').localeCompare(b.candidateNumber || '');
  });

  const fragment = document.createDocumentFragment();
  for (const candidate of filtered) {
    const row = dom.rowTemplate.content.firstElementChild.cloneNode(true);
    row.querySelector('.cell-region').textContent = candidate.regionName || '—';
    row.querySelector('.cell-party').textContent = `${candidate.partyId} – ${candidate.partyName}`;
    row.querySelector('.cell-candidate-number').textContent = candidate.candidateNumber || '—';
    row.querySelector('.cell-candidate-name').textContent = candidate.candidateName;
    row.querySelector('.cell-preference').textContent = numberFormatter.format(
      candidate.preferenceVotes
    );
    row.querySelector('.cell-party-total').textContent = numberFormatter.format(
      candidate.partyVotes
    );
    row.querySelector('.cell-ratio').textContent = percentFormatter.format(candidate.ratio);
    fragment.appendChild(row);
  }

  dom.tableBody.appendChild(fragment);

  if (filtered.length === 0) {
    setStatus('Nenalezeni žádní kandidáti pro zvolený filtr.');
  } else {
    setStatus(`Zobrazuji ${filtered.length} kandidátů splňujících podmínku 5 %.`);
  }
}

async function loadData() {
  setStatus('Načítám XML data…');
  dom.reloadButton.disabled = true;
  try {
    const [partyDoc, electionDoc] = await Promise.all([
      fetchXml(PARTY_DICTIONARY_URL),
      fetchXml(ELECTION_DATA_URL),
    ]);
    const parties = parsePartyDictionary(partyDoc);
    const { candidates, regions } = parseElectionData(electionDoc, parties);
    state.candidates = candidates;
    state.regions = regions;
    renderRegionFilter(regions);
    renderCandidates(candidates);
  } catch (error) {
    const message =
      'Nepodařilo se načíst potřebná data. Zkontrolujte prosím CORS omezení a případně nastavte proxy.';
    setStatus(message, {
      isError: true,
      details: error instanceof Error ? error.message : String(error),
    });
  } finally {
    dom.reloadButton.disabled = false;
  }
}

function handleProxyInputChange(event) {
  state.proxyUrl = event.target.value.trim();
  savePreferences();
}

function initialize() {
  loadPreferences();
  dom.proxyInput.value = state.proxyUrl;
  dom.regionFilter.addEventListener('change', () => renderCandidates(state.candidates));
  dom.reloadButton.addEventListener('click', () => loadData());
  dom.proxyInput.addEventListener('change', handleProxyInputChange);
  dom.proxyInput.addEventListener('blur', handleProxyInputChange);
  loadData();
}

window.addEventListener('DOMContentLoaded', initialize);
