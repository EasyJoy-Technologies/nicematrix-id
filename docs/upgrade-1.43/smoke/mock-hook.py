#!/usr/bin/env python3
"""Mock webhook receiver for the Logto 1.43 retry-contract smoke.

Routes:
  /always500  -> always HTTP 500   (expect 1 + 3 retries = 4 deliveries)
  /always400  -> always HTTP 400   (expect exactly 1 delivery, no retry)
  /flaky      -> 500, 500, then 200 (expect exactly 3 deliveries)
  /ok         -> always 200        (expect exactly 1 delivery)
  /_stats     -> JSON counters + the distinct raw bodies seen per route
"""
import json
from collections import defaultdict
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

counts = defaultdict(int)
bodies = defaultdict(set)


class H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_GET(self):
        if self.path == "/_stats":
            payload = json.dumps(
                {
                    "counts": dict(counts),
                    "distinct_bodies": {k: len(v) for k, v in bodies.items()},
                }
            ).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
            return
        self.send_response(404)
        self.end_headers()

    def do_POST(self):
        route = self.path.split("?")[0]
        n = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(n)
        counts[route] += 1
        bodies[route].add(raw)

        if route == "/always500":
            code = 500
        elif route == "/always400":
            code = 400
        elif route == "/flaky":
            code = 500 if counts[route] <= 2 else 200
        else:
            code = 200

        self.send_response(code)
        self.send_header("Content-Length", "0")
        self.end_headers()


ThreadingHTTPServer(("0.0.0.0", 18099), H).serve_forever()
