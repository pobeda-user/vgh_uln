import json
import os
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.error import URLError, HTTPError

ROOT_DIR = Path(__file__).resolve().parent

STATIC_FILES = {
    "/": "index.html",
    "/index.html": "index.html",
    "/app.js": "app.js",
    "/styles.css": "styles.css",
    "/manifest.json": "manifest.json",
    "/sw.js": "sw.js",
    "/icon.svg": "icon.svg",
}

MIME_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
}


def load_dotenv(dotenv_path: Path) -> None:
    if not dotenv_path.exists():
        return
    try:
        for line in dotenv_path.read_text(encoding="utf-8").splitlines():
            s = line.strip()
            if not s or s.startswith("#"):
                continue
            if "=" not in s:
                continue
            k, v = s.split("=", 1)
            k = k.strip()
            v = v.strip().strip('"').strip("'")
            if k and k not in os.environ:
                os.environ[k] = v
    except Exception:
        # dotenv is optional
        return


class Handler(BaseHTTPRequestHandler):
    server_version = "VGHProxyPython/1.0"

    def do_GET(self):
        path = self.path.split("?", 1)[0]
        rel = STATIC_FILES.get(path)
        if not rel:
            self.send_response(404)
            self.end_headers()
            return

        file_path = ROOT_DIR / rel
        if not file_path.exists() or not file_path.is_file():
            self.send_response(404)
            self.end_headers()
            return

        ext = file_path.suffix.lower()
        ctype = MIME_TYPES.get(ext, "application/octet-stream")
        data = file_path.read_bytes()

        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        self.wfile.write(data)

    def do_POST(self):
        path = self.path.split("?", 1)[0]
        if path != "/api/submit":
            self.send_response(404)
            self.end_headers()
            return

        apps_script_url = os.environ.get("APPS_SCRIPT_URL", "").strip()
        if not apps_script_url:
            self._json(500, {"ok": False, "error": "APPS_SCRIPT_URL is not set. Create .env with APPS_SCRIPT_URL=..."})
            return

        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            length = 0

        body = self.rfile.read(length) if length > 0 else b"{}"

        req = Request(
            apps_script_url,
            data=body,
            method="POST",
            headers={"Content-Type": "application/json"},
        )

        try:
            with urlopen(req, timeout=60) as resp:
                resp_body = resp.read()
                status = getattr(resp, "status", 200)
                content_type = resp.headers.get("Content-Type") or "text/plain; charset=utf-8"

            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(resp_body)))
            self.end_headers()
            self.wfile.write(resp_body)
        except HTTPError as e:
            payload = e.read() if hasattr(e, "read") else b""
            self.send_response(e.code)
            self.send_header("Content-Type", e.headers.get("Content-Type") if e.headers else "text/plain; charset=utf-8")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
        except URLError as e:
            self._json(502, {"ok": False, "error": f"Upstream URLError: {e}"})
        except Exception as e:
            self._json(500, {"ok": False, "error": str(e)})

    def _json(self, code: int, obj):
        data = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, fmt, *args):
        # Keep default logging, but shorter
        sys.stderr.write("%s - - [%s] %s\n" % (self.address_string(), self.log_date_time_string(), fmt % args))


def main():
    load_dotenv(ROOT_DIR / ".env")

    port = int(os.environ.get("PORT", "5173"))
    host = os.environ.get("HOST", "0.0.0.0")

    httpd = ThreadingHTTPServer((host, port), Handler)
    print(f"Serving on http://localhost:{port}")
    httpd.serve_forever()


if __name__ == "__main__":
    main()
