#!/usr/bin/env python3
"""Serve the static portfolio on loopback without exposing hidden workspace files."""

from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
NOT_FOUND = ROOT / "index.html" / "__preview_not_found__"
ALLOWED_ROOTS = {"index.html", "src", "docs"}


def is_allowed_path(path):
    candidate = Path(path).resolve()
    try:
        relative = candidate.relative_to(ROOT)
    except ValueError:
        return False
    if any(part.startswith(".") for part in relative.parts):
        return False
    return not relative.parts or relative.parts[0] in ALLOWED_ROOTS


class PortfolioHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def translate_path(self, path):
        candidate = Path(super().translate_path(path)).resolve()
        return str(candidate) if is_allowed_path(candidate) else str(NOT_FOUND)

    def list_directory(self, path):
        self.send_error(404, "Directory listing is disabled")
        return None


if __name__ == "__main__":
    server = ThreadingHTTPServer(("127.0.0.1", 4173), PortfolioHandler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
