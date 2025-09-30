from __future__ import annotations

import json
import threading
import time
from http.client import HTTPConnection
from pathlib import Path

import pytest

from server.names import NameTranslator
from server.web import create_server


@pytest.fixture(name="translator")
def fixture_translator() -> NameTranslator:
    base_path = Path(__file__).resolve().parents[1] / "server"
    return NameTranslator.from_files(base_path / "cns.xml", base_path / "psrk.xml")


@pytest.fixture(name="server")
def fixture_server(translator: NameTranslator):
    http_server = create_server("127.0.0.1", 0, translator=translator)

    thread = threading.Thread(target=http_server.serve_forever, daemon=True)
    thread.start()

    # give the thread a moment to spin up
    time.sleep(0.05)

    yield http_server

    http_server.shutdown()
    http_server.server_close()
    thread.join(timeout=1)


def _request_json(port: int, method: str, path: str, payload: object | None = None):
    body = None
    headers = {}
    if payload is not None:
        body = json.dumps(payload).encode("utf-8")
        headers["Content-Type"] = "application/json"

    connection = HTTPConnection("127.0.0.1", port)
    connection.request(method, path, body=body, headers=headers)
    response = connection.getresponse()
    data = response.read().decode("utf-8")
    connection.close()

    return response.status, json.loads(data)


def test_health_endpoint(server):
    port = server.server_address[1]
    status, payload = _request_json(port, "GET", "/health")

    assert status == 200
    assert payload == {"status": "ok"}


def test_translate_endpoint(server):
    port = server.server_address[1]
    sample_payload = [
        {
            "party_id": 1,
            "votes": 100,
            "candidates": [
                {"region": 1, "number": 1, "votes": 50},
                {"region": 1, "number": 2, "votes": 25},
            ],
        }
    ]

    status, payload = _request_json(port, "POST", "/translate", sample_payload)

    assert status == 200
    assert payload[0]["party"] == "Občanská demokratická strana"
    assert payload[0]["candidates"][0]["name"].startswith("Ing. Jan Novák")


def test_translate_rejects_invalid_payload(server):
    port = server.server_address[1]

    status, payload = _request_json(port, "POST", "/translate", {"party_id": 1})

    assert status == 400
    assert "error" in payload
