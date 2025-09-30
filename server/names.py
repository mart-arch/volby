"""Utilities for mapping election identifiers to human readable names."""

from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Dict, Iterable, List, Mapping, MutableMapping, Tuple
import xml.etree.ElementTree as ET

VOL_NAMESPACE = {"vol": "http://www.volby.cz/vol/"}
PS_NAMESPACE = {"ps": "http://www.volby.cz/ps/"}


@dataclass(frozen=True)
class PartyDictionary:
    """Mapping between party identifiers and their display names."""

    lookup: Mapping[int, str]

    def resolve(self, party_id: int) -> str:
        """Return a display name for the given party identifier."""
        return self.lookup.get(party_id, str(party_id))


@dataclass(frozen=True)
class CandidateDictionary:
    """Mapping between candidate identifiers and their display names."""

    lookup: Mapping[Tuple[int, int, int], str]

    def resolve(self, region_id: int, party_id: int, candidate_number: int) -> str:
        """Return a display name for a candidate identified by region/party/number."""
        key = (region_id, party_id, candidate_number)
        return self.lookup.get(key, f"{region_id}-{party_id}-{candidate_number}")


@dataclass
class NameTranslator:
    """Enrich election results with human readable party and candidate names."""

    party_dictionary: PartyDictionary
    candidate_dictionary: CandidateDictionary

    @classmethod
    def from_files(cls, cns_path: Path, psrk_path: Path) -> "NameTranslator":
        """Create a translator by loading the official XML dictionaries."""

        party_dict = PartyDictionary(_load_party_dictionary(cns_path))
        candidate_dict = CandidateDictionary(_load_candidate_dictionary(psrk_path))
        return cls(party_dict, candidate_dict)

    def translate(self, results: Iterable[MutableMapping]) -> List[MutableMapping]:
        """Return results with numeric identifiers replaced by names.

        Each result dictionary is expected to follow the structure::

            {
                "party_id": 1,
                "votes": 1234,
                "candidates": [
                    {"region": 1, "number": 1, "votes": 345},
                    ...
                ],
            }

        The returned structure preserves all other fields but replaces the
        numerical identifiers with the resolved names. The original numeric
        identifiers are removed so that consumers only display names.
        """

        translated: List[MutableMapping] = []
        for party_result in results:
            party_id = int(party_result.get("party_id", 0))
            party_name = self.party_dictionary.resolve(party_id)

            new_party_result = dict(party_result)
            new_party_result.pop("party_id", None)
            new_party_result["party"] = party_name

            raw_candidates = party_result.get("candidates", [])
            translated_candidates = []
            for candidate in raw_candidates:
                region_id = int(candidate.get("region", 0))
                candidate_number = int(candidate.get("number", 0))
                candidate_name = self.candidate_dictionary.resolve(
                    region_id, party_id, candidate_number
                )

                new_candidate = dict(candidate)
                new_candidate.pop("number", None)
                new_candidate["name"] = candidate_name
                translated_candidates.append(new_candidate)

            new_party_result["candidates"] = translated_candidates
            translated.append(new_party_result)

        return translated


@lru_cache(maxsize=1)
def _load_party_dictionary(path: Path) -> Dict[int, str]:
    tree = ET.parse(path)
    root = tree.getroot()
    lookup: Dict[int, str] = {}

    for row in root.findall("vol:CNS_ROW", VOL_NAMESPACE):
        party_id_text = row.findtext("vol:NSTRANA", default="", namespaces=VOL_NAMESPACE)
        if not party_id_text:
            continue
        party_id = int(party_id_text)
        full_name = (row.findtext("vol:NAZEV_STRN", default="", namespaces=VOL_NAMESPACE) or "").strip()
        short_name = (row.findtext("vol:ZKRATKAN30", default="", namespaces=VOL_NAMESPACE) or "").strip()
        fallback_name = (row.findtext("vol:ZKRATKAN8", default="", namespaces=VOL_NAMESPACE) or "").strip()

        display_name = full_name or short_name or fallback_name or party_id_text.strip()
        lookup[party_id] = display_name

    return lookup


@lru_cache(maxsize=1)
def _load_candidate_dictionary(path: Path) -> Dict[Tuple[int, int, int], str]:
    tree = ET.parse(path)
    root = tree.getroot()
    lookup: Dict[Tuple[int, int, int], str] = {}

    for row in root.findall("ps:PS_REGKAND_ROW", PS_NAMESPACE):
        if row.findtext("ps:PLATNOST", default="", namespaces=PS_NAMESPACE) == "0":
            continue

        try:
            region_id = int(row.findtext("ps:VOLKRAJ", namespaces=PS_NAMESPACE))
            party_id = int(row.findtext("ps:KSTRANA", namespaces=PS_NAMESPACE))
            candidate_number = int(row.findtext("ps:PORCISLO", namespaces=PS_NAMESPACE))
        except (TypeError, ValueError):
            continue

        name_parts = [
            (row.findtext("ps:TITULPRED", default="", namespaces=PS_NAMESPACE) or "").strip(),
            (row.findtext("ps:JMENO", default="", namespaces=PS_NAMESPACE) or "").strip(),
            (row.findtext("ps:PRIJMENI", default="", namespaces=PS_NAMESPACE) or "").strip(),
        ]
        main_name = " ".join(part for part in name_parts if part)
        suffix = (row.findtext("ps:TITULZA", default="", namespaces=PS_NAMESPACE) or "").strip()
        display_name = main_name if main_name else f"{region_id}-{party_id}-{candidate_number}"
        if suffix:
            display_name = f"{display_name}, {suffix}"

        lookup[(region_id, party_id, candidate_number)] = display_name

    return lookup
