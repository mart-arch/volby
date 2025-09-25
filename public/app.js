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
};

const state = {
  candidates: [],
  regions: [],
};

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
    detailBlock.className = 'status__details';
    detailBlock.textContent = details;
    dom.status.appendChild(detailBlock);
  }
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
      candidate.preferenceVotes,
    );
    row.querySelector('.cell-party-total').textContent = numberFormatter.format(
      candidate.partyVotes,
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
  setStatus('Načítám data ze serverové proxy…');
  dom.reloadButton.disabled = true;
  try {
    const response = await fetch('/api/candidates');
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`HTTP ${response.status}: ${body}`);
    }
    const payload = await response.json();
    state.candidates = Array.isArray(payload.candidates) ? payload.candidates : [];
    state.regions = Array.isArray(payload.regions) ? payload.regions : [];
    renderRegionFilter(state.regions);
    renderCandidates(state.candidates);
  } catch (error) {
    const message =
      'Nepodařilo se načíst data ani přes serverovou proxy. Zkontrolujte log serveru a připojení k internetu.';
    const detailText = error instanceof Error ? error.message : String(error);
    setStatus(message, { isError: true, details: detailText });
  } finally {
    dom.reloadButton.disabled = false;
  }
}

function initialize() {
  dom.regionFilter.addEventListener('change', () => renderCandidates(state.candidates));
  dom.reloadButton.addEventListener('click', () => loadData());
  loadData();
}

window.addEventListener('DOMContentLoaded', initialize);
