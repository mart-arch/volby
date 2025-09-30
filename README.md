# volby

Minimal tools and web server for translating Czech election identifiers to
human-readable names.

## Running the server

```bash
python -m server.web
```

The server exposes two endpoints:

* `GET /health` – returns a simple status response.
* `POST /translate` – accepts a JSON array of party results and returns the
  same structure with numeric identifiers replaced by names.

Example request body:

```json
[
  {
    "party_id": 1,
    "votes": 100,
    "candidates": [
      {"region": 1, "number": 1, "votes": 50}
    ]
  }
]
```
