# Slipstreet launcher: serves the game folder on this computer and opens it in your browser.
# (Browsers will not run a web game opened directly from a file, so a tiny local server is needed.)
import functools, http.server, os, socketserver, threading, webbrowser

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "game")
MIME = {".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json",
        ".wav": "audio/wav", ".bin": "application/octet-stream", ".html": "text/html", ".svg": "image/svg+xml"}

class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, **MIME}
    def log_message(self, *args):
        pass

for port in range(8765, 8785):
    try:
        server = socketserver.TCPServer(("127.0.0.1", port), functools.partial(Handler, directory=ROOT))
        break
    except OSError:
        continue
else:
    raise SystemExit("No free port between 8765 and 8784.")

url = f"http://localhost:{port}/"
print(f"Slipstreet is running at {url}")
print("Keep this window open while you play. Close it (or press Ctrl+C) to stop.")
threading.Timer(0.8, lambda: webbrowser.open(url)).start()
try:
    server.serve_forever()
except KeyboardInterrupt:
    pass
