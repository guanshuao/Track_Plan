from __future__ import annotations
import csv
import datetime
import http.server
import json
import socketserver
import sys
import os
import threading
import webbrowser
from pathlib import Path

def _load_amap_key() -> str:
    """Return the Gaode Maps Web JS API key from env or local config.

    The key is required by the Web JS API (docs: https://lbs.amap.com/api/jsapi-v2/summary),
    and should be provisioned under the "Web服务"/"Web端(JS API)" product type in the AMap
    developer console. We allow both `AMAP_WEB_KEY` and `AMAP_KEY` to support existing setups.
    A plain-text fallback file named `amap.key` alongside this script is also accepted to reduce
    friction when running locally without permanent environment changes.
    """

    env_candidates = ("AMAP_WEB_KEY", "AMAP_KEY")
    for name in env_candidates:
        value = os.environ.get(name)
        if value:
            return value.strip()

    key_file = Path(__file__).with_name("amap.key")
    if key_file.exists():
        try:
            return key_file.read_text(encoding="utf-8").strip()
        except OSError as exc:
            raise RuntimeError(f"读取 {key_file.name} 失败: {exc}") from exc

    return ""


AMAP_KEY = _load_amap_key()


if not AMAP_KEY:
    error = (
        "缺少高德 Web 服务 key。请在环境变量 AMAP_WEB_KEY (或 AMAP_KEY) 中设置，"
        "或者在脚本同目录放置包含 key 的 amap.key 文件，然后重新运行脚本。"
    )
    raise RuntimeError(error)


STATIC_ROOT = Path(__file__).with_name("web")
INDEX_FILE = STATIC_ROOT / "index.html"


class _AppHandler(http.server.SimpleHTTPRequestHandler):
    """Serve the web UI and handle flight-plan persistence."""

    def __init__(self, *args: object, **kwargs: object) -> None:
        super().__init__(*args, directory=str(STATIC_ROOT), **kwargs)

    def _cancel_pending_shutdown(self) -> None:
        server = self.server
        lock = getattr(server, "shutdown_lock", None)
        if lock is None:
            return
        with lock:
            timer = getattr(server, "shutdown_timer", None)
            if timer is not None:
                timer.cancel()
                server.shutdown_timer = None

    def _schedule_shutdown(self, delay: float = 1.5) -> None:
        server = self.server
        lock = getattr(server, "shutdown_lock", None)
        if lock is None:
            return

        def _invoke_shutdown() -> None:
            try:
                server.shutdown()
            finally:
                with lock:
                    server.shutdown_timer = None

        with lock:
            timer = getattr(server, "shutdown_timer", None)
            if timer is not None:
                timer.cancel()
            new_timer = threading.Timer(delay, _invoke_shutdown)
            new_timer.daemon = True
            server.shutdown_timer = new_timer
            new_timer.start()

    def do_GET(self) -> None:  # noqa: N802 - SimpleHTTPRequestHandler signature
        if self.path in ("/", "/index.html"):
            self._cancel_pending_shutdown()
            self._serve_index()
            return
        self._cancel_pending_shutdown()
        super().do_GET()

    def do_POST(self) -> None:  # noqa: N802 - SimpleHTTPRequestHandler signature
        if self.path == "/save_flight_plan":
            self._cancel_pending_shutdown()
            self._handle_save_flight_plan()
        elif self.path == "/shutdown":
            self._handle_shutdown_request()
        else:
            self.send_error(404, "Not Found")

    def _serve_index(self) -> None:
        try:
            html = INDEX_FILE.read_text(encoding="utf-8")
        except OSError as exc:
            self.send_error(500, f"Failed to load index.html: {exc}")
            return
        encoded = html.replace("__AMAP_KEY__", AMAP_KEY).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def _handle_save_flight_plan(self) -> None:
        length_header = self.headers.get("Content-Length")
        if length_header is None:
            self.send_error(400, "Missing Content-Length")
            return
        try:
            length = int(length_header)
        except ValueError:
            self.send_error(400, "Invalid Content-Length")
            return
        raw_body = self.rfile.read(length)
        try:
            payload = json.loads(raw_body.decode("utf-8"))
        except json.JSONDecodeError:
            self.send_error(400, "Invalid JSON payload")
            return
        centers = payload.get("photoCenters")
        if not isinstance(centers, list):
            self.send_error(400, "Invalid payload structure")
            return
        rows = []
        for entry in centers:
            lng = None
            lat = None
            if isinstance(entry, (list, tuple)) and len(entry) >= 2:
                lng, lat = entry[0], entry[1]
            elif isinstance(entry, dict):
                lng = entry.get("lng") or entry.get("lon") or entry.get("longitude")
                lat = entry.get("lat") or entry.get("latitude")
            try:
                lng_value = float(lng)
                lat_value = float(lat)
            except (TypeError, ValueError):
                continue
            rows.append((lng_value, lat_value))
        timestamp = datetime.datetime.now().strftime("%Y%m%d%H%M%S")
        filename = f"{timestamp}.csv"
        output_path = Path.cwd() / filename
        counter = 1
        while output_path.exists():
            filename = f"{timestamp}_{counter}.csv"
            output_path = Path.cwd() / filename
            counter += 1
        try:
            with output_path.open("w", newline="", encoding="utf-8") as csv_file:
                writer = csv.writer(csv_file)
                writer.writerow(["longitude", "latitude"])
                writer.writerows(rows)
        except OSError as exc:
            self.send_error(500, f"Failed to write CSV: {exc}")
            return
        body = json.dumps({"status": "ok", "filename": filename, "count": len(rows)}).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _handle_shutdown_request(self) -> None:
        # Stop the HTTP server after returning a response to the browser.
        length_header = self.headers.get("Content-Length")
        if length_header:
            try:
                length = int(length_header)
            except ValueError:
                length = 0
            if length > 0:
                self.rfile.read(length)
        body = json.dumps({"status": "stopping"}).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)
        self._schedule_shutdown()

    def log_message(self, fmt: str, *args: object) -> None:
        # Quieter server logs while still accessible for debugging via stderr.
        sys.stderr.write("[INFO] " + fmt % args + "\n")


def main() -> None:
    # Use an ephemeral port to avoid clashes, bind to localhost only for safety.
    with socketserver.TCPServer(("127.0.0.1", 0), _AppHandler) as httpd:
        httpd.shutdown_lock = threading.Lock()
        httpd.shutdown_timer = None
        port = httpd.server_address[1]
        url = f"http://127.0.0.1:{port}/"
        print("已启动本地服务，用于地图选点界面：")
        print(f"  {url}")
        print("按 Ctrl+C 停止服务。")

        # Launch the default browser in a background thread to avoid blocking.
        threading.Thread(target=webbrowser.open, args=(url,), daemon=True).start()

        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n收到中断，正在退出...")
        finally:
            print("服务已停止。")


if __name__ == "__main__":
    main()