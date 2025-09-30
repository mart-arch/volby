const PREFERENCE_THRESHOLD_RATIO = 0.05;

const statusContainer = document.querySelector("#status");
const statusText = statusContainer?.querySelector(".status__text");
const statusIcon = statusContainer?.querySelector(".status__icon");
const resultsSection = document.querySelector("#results");
const regionSelect = document.querySelector("#regionSelect");
const regionHeading = document.querySelector("#regionHeading");
const regionMeta = document.querySelector("#regionMeta");
const partiesContainer = document.querySelector("#regionParties");

let regions = [];

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}

function init() {
  if (regionSelect) {
    regionSelect.addEventListener("change", handleRegionChange);
  }
  loadAndRender();
}

async function loadAndRender() {
  try {
    const response = await fetch("ps.xml", { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Server vrátil stav ${response.status}`);
    }

    const xmlText = await response.text();
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlText, "application/xml");

    const parseError = xmlDoc.querySelector("parsererror");
    if (parseError) {
      throw new Error("XML soubor se nepodařilo zpracovat.");
    }

    regions = parseResults(xmlDoc);

    if (!regions.length) {
      throw new Error("V souboru nebyly nalezeny žádné kraje.");
    }

    regions.sort((a, b) => {
      const codeA = Number.parseInt(a.code, 10);
      const codeB = Number.parseInt(b.code, 10);
      if (Number.isFinite(codeA) && Number.isFinite(codeB) && codeA !== codeB) {
        return codeA - codeB;
      }
      return a.name.localeCompare(b.name, "cs");
    });

    populateRegionSelect(regions);

    const initialRegion = regions[0];
    if (initialRegion) {
      showRegion(initialRegion);
      if (regionSelect) {
        regionSelect.value = initialRegion.code;
        regionSelect.disabled = false;
      }
    }

    if (resultsSection) {
      resultsSection.hidden = false;
    }

    updateStatus(
      `Načteno ${regions.length} ${decline(regions.length, "kraj", "kraje", "krajů")}.`,
      "success",
      "✅"
    );
  } catch (error) {
    console.error(error);
    updateStatus(error.message || "Nepodařilo se načíst data.", "error", "⚠️");
  }
}

function handleRegionChange(event) {
  const selectedCode = event.target.value;
  const region = regions.find((item) => item.code === selectedCode);
  if (region) {
    showRegion(region);
  }
}

function parseResults(xmlDoc) {
  const root = xmlDoc.documentElement;
  if (!root || root.localName !== "VYSLEDKY_KANDID") {
    return [];
  }

  const regionElements = Array.from(xmlDoc.getElementsByTagNameNS("*", "KRAJ"));

  return regionElements
    .filter((element) => element.parentElement === root)
    .map((regionElement) => parseRegion(regionElement))
    .filter(Boolean);
}

function parseRegion(regionElement) {
  const attributes = collectAttributes(regionElement);
  const code = attributes.get("CIS_KRAJ") || attributes.get("KOD") || "";
  const name =
    attributes.get("NAZ_KRAJ") ||
    getChildTextByLocalNames(regionElement, ["NAZ_KRAJ", "NAZEV_KRAJE", "NAZEV"]) ||
    (code ? `Kraj ${code}` : "Neznámý kraj");

  const turnout = parseTurnout(regionElement);
  const partiesMap = parseParties(regionElement);
  const candidates = parseCandidates(regionElement);

  candidates.forEach((candidate) => {
    let party = partiesMap.get(candidate.partyCode);
    if (!party) {
      party = {
        code: candidate.partyCode,
        name: `Strana ${candidate.partyCode}`,
        totalVotes: 0,
        candidates: [],
      };
      partiesMap.set(candidate.partyCode, party);
    }
    party.candidates.push(candidate);
  });

  const parties = Array.from(partiesMap.values()).map((party) => enhanceParty(party));

  parties.sort((a, b) => {
    if (b.totalVotes !== a.totalVotes) {
      return b.totalVotes - a.totalVotes;
    }
    return a.name.localeCompare(b.name, "cs");
  });

  return {
    code,
    name,
    turnout,
    parties,
  };
}

function parseTurnout(regionElement) {
  const turnoutElement = getFirstChildByLocalName(regionElement, "UCAST");
  if (!turnoutElement) {
    return null;
  }

  const attributes = collectAttributes(turnoutElement);

  return {
    processedPrecincts: parseNumber(attributes.get("OKRSKY_ZPRAC")),
    precinctsTotal: parseNumber(attributes.get("OKRSKY_CELKEM")),
    processedPercent: parseNumber(attributes.get("OKRSKY_ZPRAC_PROC")),
    turnoutPercent: parseNumber(attributes.get("UCAST_PROC")),
    validVotes: parseNumber(attributes.get("PLATNE_HLASY")),
  };
}

function parseParties(regionElement) {
  const partiesContainer = getFirstChildByLocalName(regionElement, "STRANY");
  const partiesMap = new Map();

  if (!partiesContainer) {
    return partiesMap;
  }

  const partyElements = getChildrenByLocalName(partiesContainer, "STRANA");

  partyElements.forEach((partyElement) => {
    const attributes = collectAttributes(partyElement);
    const code = attributes.get("KSTRANA");
    if (!code) {
      return;
    }

    const totalVotes = parseNumber(
      attributes.get("POC_HLASU") ||
        getChildTextByLocalNames(partyElement, ["POC_HLASU", "HLASY", "HLASY_CELKEM"])
    );

    const name =
      attributes.get("NAZEV_STRANY") ||
      attributes.get("NAZ_STRANA") ||
      getChildTextByLocalNames(partyElement, ["NAZEV", "NAZEV_STRANY", "NAZ_STRANA"]) ||
      `Strana ${code}`;

    partiesMap.set(code, {
      code,
      name,
      totalVotes: Number.isFinite(totalVotes) ? totalVotes : 0,
      candidates: [],
    });
  });

  return partiesMap;
}

function parseCandidates(regionElement) {
  const candidatesContainer = getFirstChildByLocalName(regionElement, "KANDIDATI");
  if (!candidatesContainer) {
    return [];
  }

  const candidateElements = getChildrenByLocalName(candidatesContainer, "KANDIDAT");

  return candidateElements
    .map((candidateElement) => parseCandidate(candidateElement))
    .filter(Boolean);
}

function parseCandidate(candidateElement) {
  const attributes = collectAttributes(candidateElement);
  const partyCode = attributes.get("KSTRANA");
  if (!partyCode) {
    return null;
  }

  const votes = parseNumber(
    attributes.get("HLASY") ||
      getChildTextByLocalNames(candidateElement, ["HLASY", "PREF_HLASY", "PREFERENCNI_HLASY"])
  );

  if (!Number.isFinite(votes)) {
    return null;
  }

  const order = parseNumber(attributes.get("PORCISLO"));
  const prefix =
    attributes.get("TITUL_PRED") ||
    attributes.get("TITULPRED") ||
    getChildTextByLocalNames(candidateElement, ["TITUL_PRED", "TITULPRED"]);
  const suffix =
    attributes.get("TITUL_ZA") ||
    attributes.get("TITULZA") ||
    getChildTextByLocalNames(candidateElement, ["TITUL_ZA", "TITULZA"]);
  const firstName =
    attributes.get("JMENO") ||
    attributes.get("KRESTNI_JMENO") ||
    attributes.get("KRESTNIJMENO") ||
    getChildTextByLocalNames(candidateElement, ["JMENO", "KRESTNI_JMENO", "KRESTNIJMENO"]);
  const lastName =
    attributes.get("PRIJMENI") ||
    getChildTextByLocalNames(candidateElement, ["PRIJMENI", "PRIJMENI_KANDIDATA"]);

  const pieces = [];
  if (prefix) {
    pieces.push(prefix);
  }
  const coreName = [firstName, lastName].filter(Boolean).join(" ").trim();
  if (coreName) {
    pieces.push(coreName);
  }

  let name = pieces.join(" ").trim();
  if (!name) {
    const fallbackText = candidateElement.textContent.trim();
    name = fallbackText || `Kandidát ${Number.isFinite(order) ? order : ""}`.trim();
  }

  if (suffix) {
    name = name ? `${name}, ${suffix}` : suffix;
  }

  return {
    partyCode,
    name,
    votes,
    order: Number.isFinite(order) ? order : null,
  };
}

function enhanceParty(party) {
  const threshold = Math.ceil(party.totalVotes * PREFERENCE_THRESHOLD_RATIO);
  const candidates = party.candidates
    .slice()
    .sort((a, b) => {
      if (b.votes !== a.votes) {
        return b.votes - a.votes;
      }
      if (a.order != null && b.order != null) {
        return a.order - b.order;
      }
      if (a.order != null) {
        return -1;
      }
      if (b.order != null) {
        return 1;
      }
      return a.name.localeCompare(b.name, "cs");
    })
    .map((candidate) => ({
      ...candidate,
      qualifies: threshold > 0 && candidate.votes >= threshold,
    }));

  const qualifiedCount = candidates.filter((candidate) => candidate.qualifies).length;

  return {
    ...party,
    threshold,
    candidates,
    qualifiedCount,
  };
}

function populateRegionSelect(regionList) {
  if (!regionSelect) {
    return;
  }

  regionSelect.replaceChildren();

  regionList.forEach((region) => {
    const option = document.createElement("option");
    option.value = region.code;
    option.textContent = region.name;
    regionSelect.appendChild(option);
  });
}

function showRegion(region) {
  if (regionHeading) {
    regionHeading.textContent = region.name;
  }

  if (regionMeta) {
    const parts = [];
    if (region.turnout) {
      const { processedPrecincts, precinctsTotal, processedPercent, turnoutPercent, validVotes } =
        region.turnout;

      if (Number.isFinite(processedPrecincts) && Number.isFinite(precinctsTotal)) {
        parts.push(`Okrsky zpracovány: ${formatNumber(processedPrecincts)} / ${formatNumber(precinctsTotal)}`);
      }
      if (Number.isFinite(processedPercent)) {
        parts.push(`Zpracováno: ${formatPercent(processedPercent)}`);
      }
      if (Number.isFinite(turnoutPercent)) {
        parts.push(`Účast: ${formatPercent(turnoutPercent)}`);
      }
      if (Number.isFinite(validVotes)) {
        parts.push(`Platné hlasy: ${formatNumber(validVotes)}`);
      }
    }

    regionMeta.textContent = parts.join(" · ");
    regionMeta.hidden = parts.length === 0;
  }

  if (!partiesContainer) {
    return;
  }

  const fragment = document.createDocumentFragment();

  if (!region.parties.length) {
    const notice = document.createElement("p");
    notice.className = "region__notice";
    notice.textContent = "V tomto kraji nebyly nalezeny žádné kandidující subjekty.";
    fragment.appendChild(notice);
  } else {
    region.parties.forEach((party) => {
      fragment.appendChild(renderParty(party));
    });
  }

  partiesContainer.replaceChildren(fragment);
}

function renderParty(party) {
  const article = document.createElement("article");
  article.className = "party";

  const header = document.createElement("header");
  header.className = "party__header";

  const title = document.createElement("h3");
  title.className = "party__title";
  title.textContent = party.name;

  const meta = document.createElement("p");
  meta.className = "party__meta";
  meta.innerHTML = `Celkem hlasů: <strong>${formatNumber(party.totalVotes)}</strong> · Limit pro posun: <strong>${formatNumber(party.threshold)}</strong> · Splnilo: <strong>${party.qualifiedCount}</strong>`;

  header.append(title, meta);

  const table = document.createElement("table");
  table.className = "candidate-table";

  const thead = document.createElement("thead");
  const headerRow = document.createElement("tr");
  ["Pořadí", "Kandidát", "Preferenční hlasy", "Splněno"].forEach((label) => {
    const th = document.createElement("th");
    th.textContent = label;
    headerRow.appendChild(th);
  });
  thead.appendChild(headerRow);

  const tbody = document.createElement("tbody");

  if (!party.candidates.length) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 4;
    cell.className = "candidate-table__note";
    cell.textContent = "U této strany nebyli nalezeni žádní kandidáti.";
    row.appendChild(cell);
    tbody.appendChild(row);
  } else {
    party.candidates.forEach((candidate) => {
      const row = document.createElement("tr");
      if (candidate.qualifies) {
        row.classList.add("is-qualified");
      }

      const orderCell = document.createElement("td");
      orderCell.textContent = candidate.order != null ? candidate.order.toString() : "–";

      const nameCell = document.createElement("td");
      nameCell.textContent = candidate.name;

      const votesCell = document.createElement("td");
      votesCell.textContent = formatNumber(candidate.votes);

      const qualifiesCell = document.createElement("td");
      qualifiesCell.textContent = candidate.qualifies ? "Ano" : "Ne";

      row.append(orderCell, nameCell, votesCell, qualifiesCell);
      tbody.appendChild(row);
    });
  }

  table.append(thead, tbody);
  article.append(header, table);
  return article;
}

function updateStatus(message, type = "info", icon = "ℹ️") {
  if (statusText) {
    statusText.textContent = message;
  }
  if (statusIcon) {
    statusIcon.textContent = icon;
  }
  if (!statusContainer) {
    return;
  }
  statusContainer.classList.remove("status--error", "status--success");
  if (type === "error") {
    statusContainer.classList.add("status--error");
  } else if (type === "success") {
    statusContainer.classList.add("status--success");
  }
}

function collectAttributes(element) {
  const map = new Map();
  if (!element) {
    return map;
  }
  Array.from(element.attributes || []).forEach((attribute) => {
    const key = attribute.name.toUpperCase();
    map.set(key, attribute.value.trim());
  });
  return map;
}

function getFirstChildByLocalName(element, localName) {
  if (!element) {
    return null;
  }
  return Array.from(element.children).find((child) => child.localName === localName) || null;
}

function getChildrenByLocalName(element, localName) {
  if (!element) {
    return [];
  }
  return Array.from(element.children).filter((child) => child.localName === localName);
}

function getChildTextByLocalNames(element, localNames) {
  if (!element) {
    return "";
  }
  for (const child of Array.from(element.children)) {
    if (localNames.includes(child.localName)) {
      const text = child.textContent.trim();
      if (text) {
        return text;
      }
    }
  }
  return "";
}

function parseNumber(value) {
  if (typeof value !== "string" || value.trim() === "") {
    return NaN;
  }
  const normalized = value.replace(/\s+/g, "").replace(/,/g, ".");
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : NaN;
}

const numberFormatter = new Intl.NumberFormat("cs-CZ");
const percentFormatter = new Intl.NumberFormat("cs-CZ", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

function formatNumber(value) {
  return numberFormatter.format(Number.isFinite(value) ? value : 0);
}

function formatPercent(value) {
  return `${percentFormatter.format(value)} %`;
}

function decline(value, singular, paucal, plural) {
  const mod10 = value % 10;
  const mod100 = value % 100;
  if (value === 1) {
    return singular;
  }
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
    return paucal;
  }
  return plural;
}
