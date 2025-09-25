const statusElement = document.getElementById('status');
const tableBody = document.querySelector('#candidates-table tbody');
const regionFilter = document.getElementById('region-filter');

let cachedCandidates = [];

const numberFormatter = new Intl.NumberFormat('cs-CZ');
const percentFormatter = new Intl.NumberFormat('cs-CZ', {
  style: 'percent',
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

function setStatus(message, isError = false) {
  if (!message) {
    statusElement.classList.add('hidden');
    statusElement.textContent = '';
    statusElement.classList.remove('error');
    return;
  }
  statusElement.textContent = message;
  statusElement.classList.remove('hidden');
  statusElement.classList.toggle('error', isError);
}

function renderTable(candidates) {
  tableBody.innerHTML = '';
  if (candidates.length === 0) {
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = 8;
    cell.textContent = 'Žádní kandidáti nesplňují zadaná kritéria.';
    row.appendChild(cell);
    tableBody.appendChild(row);
    return;
  }

  const fragment = document.createDocumentFragment();
  candidates.forEach((candidate) => {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${candidate.regionName ?? candidate.regionCode ?? '—'}</td>
      <td>${candidate.candidateNumber ?? '—'}</td>
      <td>${candidate.candidateName || '—'}</td>
      <td>${candidate.partyId}</td>
      <td>${candidate.partyName}</td>
      <td>${numberFormatter.format(candidate.votes)}</td>
      <td>${numberFormatter.format(candidate.partyVotes)}</td>
      <td>${percentFormatter.format(candidate.votes / candidate.partyVotes)}</td>
    `;
    fragment.appendChild(row);
  });
  tableBody.appendChild(fragment);
}

function populateRegions(candidates) {
  const regionPairs = candidates
    .map(({ regionCode, regionName }) => ({
      regionCode: regionCode || regionName || '',
      regionName: regionName || regionCode || '',
    }))
    .filter(({ regionCode }) => regionCode !== '');

  const uniqueRegions = Array.from(
    regionPairs.reduce((map, { regionCode, regionName }) => {
      if (!map.has(regionCode)) {
        map.set(regionCode, regionName);
      }
      return map;
    }, new Map())
  ).sort((a, b) => a[1].localeCompare(b[1], 'cs'));

  uniqueRegions.forEach(([code, name]) => {
    const option = document.createElement('option');
    option.value = code;
    option.textContent = name;
    regionFilter.appendChild(option);
  });
}

function applyFilters() {
  const regionValue = regionFilter.value;
  const filtered = regionValue
    ? cachedCandidates.filter((candidate) => candidate.regionCode === regionValue)
    : cachedCandidates;
  renderTable(filtered);
}

async function loadData() {
  setStatus('Načítám data...');
  try {
    const response = await fetch('/api/candidates');
    if (!response.ok) {
      let errorDetails = '';
      try {
        const errorPayload = await response.json();
        if (errorPayload?.details) {
          errorDetails = ` (${errorPayload.details})`;
        }
      } catch (parseError) {
        console.error('Chyba při parsování chybové odpovědi', parseError);
      }
      throw new Error(`Chyba při načítání dat: ${response.status}${errorDetails}`);
    }
    const payload = await response.json();
    cachedCandidates = Array.isArray(payload.candidates) ? payload.candidates : [];
    cachedCandidates.sort((a, b) => {
      if (a.regionName && b.regionName && a.regionName !== b.regionName) {
        return a.regionName.localeCompare(b.regionName, 'cs');
      }
      if (a.partyName !== b.partyName) {
        return a.partyName.localeCompare(b.partyName, 'cs');
      }
      return (Number(a.candidateNumber) || 0) - (Number(b.candidateNumber) || 0);
    });

    populateRegions(cachedCandidates);
    applyFilters();
    setStatus('');
  } catch (error) {
    console.error(error);
    setStatus(`Nepodařilo se načíst data. ${error instanceof Error ? error.message : ''}`.trim(), true);
  }
}

regionFilter.addEventListener('change', applyFilters);

loadData();
