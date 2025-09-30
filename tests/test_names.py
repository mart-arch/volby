from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.append(str(ROOT))

from server.names import NameTranslator


def _translator() -> NameTranslator:
    base = ROOT / "server"
    return NameTranslator.from_files(base / "cns.xml", base / "psrk.xml")


def test_party_name_is_resolved_and_id_removed():
    translator = _translator()
    results = [
        {
            "party_id": 1,
            "votes": 2000,
            "candidates": [],
        }
    ]

    translated = translator.translate(results)

    assert translated == [
        {
            "votes": 2000,
            "candidates": [],
            "party": "Občanská demokratická strana",
        }
    ]


def test_candidate_name_includes_titles_and_number_removed():
    translator = _translator()
    results = [
        {
            "party_id": 1,
            "candidates": [
                {"region": 1, "number": 1, "votes": 500},
                {"region": 1, "number": 2, "votes": 400},
            ],
        }
    ]

    translated = translator.translate(results)

    assert translated[0]["candidates"] == [
        {"region": 1, "votes": 500, "name": "Ing. Jan Novák"},
        {"region": 1, "votes": 400, "name": "Petr Svoboda, Ph.D."},
    ]


def test_fallback_for_unknown_entities():
    translator = _translator()
    results = [
        {
            "party_id": 999,
            "candidates": [
                {"region": 4, "number": 3},
            ],
        }
    ]

    translated = translator.translate(results)

    assert translated[0]["party"] == "999"
    assert translated[0]["candidates"][0]["name"] == "4-999-3"
