const PREFERENCE_THRESHOLD_RATIO = 0.05;
const PARTY_TAG_NAMES = [
  "STRANA",
  "STRANA_KANDIDATKA",
  "KANDIDATKA",
  "PARTY",
  "LIST",
  "LISTINA"
];
const PARTY_NAME_TAGS = [
  "NAZEV",
  "NAZEV_STRANY",
  "STRANA",
  "PARTY_NAME",
  "NAZEV_KANDIDATKY",
  "NAZEV_PARTY"
];
const PARTY_TOTAL_VOTES_TAGS = [
  "HLASY_STRANA",
  "HLASY",
  "VOTES",
  "HLASY_CELKEM",
  "HLASY_PLATNE",
  "TOTAL_VOTES"
];
const CANDIDATE_TAG_NAMES = [
  "KANDIDAT",
  "KANDIDATKA",
  "CANDIDATE",
  "OSOBA",
  "PERSON"
];
const CANDIDATE_FIRST_NAME_TAGS = [
  "JMENO",
  "KRESTNI_JMENO",
  "FIRST_NAME",
  "KRESTNIJMENO"
];
const CANDIDATE_LAST_NAME_TAGS = [
  "PRIJMENI",
  "SURNAME",
  "LAST_NAME"
];
const CANDIDATE_TITLE_PREFIX_TAGS = ["TITUL_PRED", "TITLE_BEFORE"];
const CANDIDATE_TITLE_SUFFIX_TAGS = ["TITUL_ZA", "TITLE_AFTER"];
const CANDIDATE_VOTES_TAGS = [
  "PREFERENCNI_HLASY",
  "PREF_HLASY",
  "HLASY",
  "VOTES",
  "PREF_VOTES",
  "PREFERENTIAL_VOTES"
];

const statusContainer = document.querySelector("#status");
const statusText = statusContainer.querySelector(".status__text");
const statusIcon = statusContainer.querySelector(".status__icon");
const resultsContainer = document.querySelector("#results");

document.addEventListener("DOMContentLoaded", () => {
  loadAndRender();
});

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

    const parties = extractParties(xmlDoc);
    if (!parties.length) {
      throw new Error("V souboru nebyly nalezeny žádné kandidující subjekty.");
    }

    renderParties(parties);
    updateStatus(
      `Načteno ${parties.length} ${decline(parties.length, "subjekt", "subjekty", "subjektů")}.`,
      "success",
      "✅"
    );
  } catch (error) {
    console.error(error);
    updateStatus(error.message || "Nepodařilo se načíst data.", "error", "⚠️");
  }
}

function extractParties(xmlDoc) {
  const partyElements = findElementsByTagNames(
    xmlDoc.documentElement,
    PARTY_TAG_NAMES
  );

  const parties = partyElements.map((partyElement) => parseParty(partyElement));
  return parties.filter(Boolean);
}

function parseParty(partyElement) {
  const partyName =
    findTextByTagNames(partyElement, PARTY_NAME_TAGS) ||
    getAttributeByNames(partyElement, PARTY_NAME_TAGS) ||
    "Neznámý subjekt";

  let totalVotes = findNumberByTagNames(partyElement, PARTY_TOTAL_VOTES_TAGS);
  if (!Number.isFinite(totalVotes)) {
    const fallbackAttribute = getAttributeByNames(
      partyElement,
      PARTY_TOTAL_VOTES_TAGS,
      true
    );
    totalVotes = fallbackAttribute;
  }

  const candidates = extractCandidates(partyElement);

  if (!Number.isFinite(totalVotes)) {
    const summedVotes = candidates.reduce((acc, candidate) => {
      return acc + (candidate.preferenceVotes || 0);
    }, 0);
    totalVotes = summedVotes || 0;
  }

  const threshold = Math.ceil(totalVotes * PREFERENCE_THRESHOLD_RATIO);

  const enhancedCandidates = candidates.map((candidate) => ({
    ...candidate,
    qualifies: candidate.preferenceVotes >= threshold && threshold > 0,
  }));

  const qualifiedCandidates = enhancedCandidates.filter(
    (candidate) => candidate.qualifies
  );

  return {
    partyName,
    totalVotes,
    threshold,
    candidates: enhancedCandidates,
    qualifiedCandidates,
  };
}

function extractCandidates(partyElement) {
  let candidateElements = findElementsByTagNames(
    partyElement,
    CANDIDATE_TAG_NAMES,
    { onlyChildrenOf: partyElement }
  );

  if (!candidateElements.length) {
    candidateElements = findElementsByTagNames(
      partyElement,
      CANDIDATE_TAG_NAMES
    );
  }

  return candidateElements
    .map((candidateElement) => parseCandidate(candidateElement))
    .filter(Boolean);
}

function parseCandidate(candidateElement) {
  const prefix =
    findTextByTagNames(candidateElement, CANDIDATE_TITLE_PREFIX_TAGS) || "";
  const firstName =
    findTextByTagNames(candidateElement, CANDIDATE_FIRST_NAME_TAGS) || "";
  const lastName =
    findTextByTagNames(candidateElement, CANDIDATE_LAST_NAME_TAGS) || "";
  const suffix =
    findTextByTagNames(candidateElement, CANDIDATE_TITLE_SUFFIX_TAGS) || "";

  let displayName =
    `${prefix} ${[firstName, lastName].filter(Boolean).join(" ")}`.trim();
  if (!displayName) {
    displayName = (candidateElement.textContent || "").trim();
  }
  if (suffix) {
    displayName = `${displayName}, ${suffix}`;
  }

  const preferenceVotes = findNumberByTagNames(
    candidateElement,
    CANDIDATE_VOTES_TAGS
  );

  const votesFromAttribute = getAttributeByNames(
    candidateElement,
    CANDIDATE_VOTES_TAGS,
    true
  );

  const totalVotes = Number.isFinite(preferenceVotes)
    ? preferenceVotes
    : votesFromAttribute;

  if (!Number.isFinite(totalVotes)) {
    return null;
  }

  return {
    name: displayName || "Neznámý kandidát",
    preferenceVotes: totalVotes,
  };
}

function renderParties(parties) {
  const fragment = document.createDocumentFragment();
  parties.forEach((party) => {
    const partySection = document.createElement("article");
    partySection.className = "party";

    const header = document.createElement("header");
    header.className = "party__header";

    const title = document.createElement("h2");
    title.className = "party__title";
    title.textContent = party.partyName;

    const meta = document.createElement("p");
    meta.className = "party__meta";
    meta.innerHTML = `Celkem hlasů: <strong>${formatNumber(
      party.totalVotes
    )}</strong> · Limit pro posun: <strong>${formatNumber(
      party.threshold
    )}</strong>`;

    header.append(title, meta);

    const table = document.createElement("table");
    table.className = "candidate-table";

    const thead = document.createElement("thead");
    const headerRow = document.createElement("tr");
    ["Kandidát", "Preferenční hlasy", "Splněno"].forEach((label) => {
      const th = document.createElement("th");
      th.textContent = label;
      headerRow.appendChild(th);
    });
    thead.appendChild(headerRow);

    const tbody = document.createElement("tbody");

    if (!party.candidates.length) {
      const row = document.createElement("tr");
      const cell = document.createElement("td");
      cell.colSpan = 3;
      cell.className = "candidate-table__note";
      cell.textContent = "U tohoto subjektu nebyli nalezeni žádní kandidáti.";
      row.appendChild(cell);
      tbody.appendChild(row);
    } else {
      party.candidates
        .sort((a, b) => b.preferenceVotes - a.preferenceVotes)
        .forEach((candidate) => {
          const row = document.createElement("tr");
          if (candidate.qualifies) {
            row.classList.add("is-qualified");
          }

          const nameCell = document.createElement("td");
          nameCell.textContent = candidate.name;

          const votesCell = document.createElement("td");
          votesCell.textContent = formatNumber(candidate.preferenceVotes);

          const qualifiesCell = document.createElement("td");
          qualifiesCell.textContent = candidate.qualifies ? "Ano" : "Ne";

          row.append(nameCell, votesCell, qualifiesCell);
          tbody.appendChild(row);
        });
    }

    table.append(thead, tbody);
    partySection.append(header, table);
    fragment.appendChild(partySection);
  });

  resultsContainer.replaceChildren(fragment);
  resultsContainer.hidden = false;
}

function updateStatus(message, type = "info", icon = "ℹ️") {
  statusText.textContent = message;
  statusIcon.textContent = icon;
  statusContainer.classList.remove("status--error", "status--success");
  if (type === "error") {
    statusContainer.classList.add("status--error");
  } else if (type === "success") {
    statusContainer.classList.add("status--success");
  }
}

function findElementsByTagNames(root, names, options = {}) {
  const normalizedNames = names.map((name) => name.toLowerCase());
  const elements = [];
  const stack = options.onlyChildrenOf
    ? Array.from(options.onlyChildrenOf.children)
    : Array.from(root.getElementsByTagName("*"));

  stack.forEach((node) => {
    if (normalizedNames.includes(normalizeName(node.tagName))) {
      elements.push(node);
    }
  });

  return elements;
}

function findTextByTagNames(element, tagNames) {
  const match = findFirstElementByTagNames(element, tagNames);
  return match ? match.textContent.trim() : "";
}

function findNumberByTagNames(element, tagNames) {
  const text = findTextByTagNames(element, tagNames);
  const value = parseNumber(text);
  return Number.isFinite(value) ? value : NaN;
}

function findFirstElementByTagNames(element, tagNames) {
  const normalized = tagNames.map((name) => name.toLowerCase());
  for (const child of Array.from(element.children)) {
    if (normalized.includes(normalizeName(child.tagName))) {
      return child;
    }
  }
  const descendants = element.getElementsByTagName("*");
  for (const descendant of Array.from(descendants)) {
    if (normalized.includes(normalizeName(descendant.tagName))) {
      return descendant;
    }
  }
  return null;
}

function getAttributeByNames(element, names, asNumber = false) {
  const normalized = names.map((name) => name.toLowerCase());
  for (const attribute of Array.from(element.attributes || [])) {
    if (normalized.includes(normalizeName(attribute.name))) {
      const value = asNumber ? parseNumber(attribute.value) : attribute.value;
      if (asNumber) {
        if (Number.isFinite(value)) {
          return value;
        }
      } else if (value) {
        return value;
      }
    }
  }
  return asNumber ? NaN : "";
}

function parseNumber(value) {
  if (typeof value !== "string") {
    return NaN;
  }
  const normalized = value.replace(/\s+/g, "").replace(/,/, ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : NaN;
}

function normalizeName(name) {
  return (name || "").toString().toLowerCase().split(":").pop();
}

function formatNumber(value) {
  const formatter = new Intl.NumberFormat("cs-CZ");
  return formatter.format(Number(value) || 0);
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
