import argparse
import csv
import datetime
import html
import http.server
import json
import math
import os
import secrets
import socket
import sys
import threading
import webbrowser
from pathlib import Path
from urllib.parse import urlsplit

MAX_BODY_BYTES = 4 * 1024 * 1024
MAX_PHOTO_RECORDS = 20_000


def _load_amap_key() -> str:
    """Return the Gaode Maps Web JS API key from env or local config.

    The key is required by the Web JS API (docs: https://lbs.amap.com/api/jsapi-v2/summary),
    and should be provisioned under the "Web服务"/"Web端(JS API)" product type in the AMap
    developer console. We allow both `AMAP_WEB_KEY` and `AMAP_KEY` to support existing setups.
    The ignored `amap.local.key` file is preferred for local use.
    """

    env_candidates = ("AMAP_WEB_KEY", "AMAP_KEY")
    for name in env_candidates:
        value = os.environ.get(name)
        if value:
            return value.strip()

    key_file = Path(__file__).with_name("amap.local.key")
    if key_file.exists():
        try:
            return key_file.read_text(encoding="utf-8").strip()
        except OSError as exc:
            raise RuntimeError(f"读取 {key_file.name} 失败: {exc}") from exc

    return ""


STATIC_ROOT = Path(__file__).with_name("web")
INDEX_FILE = STATIC_ROOT / "index.html"


class _AppHandler(http.server.SimpleHTTPRequestHandler):
    """Serve the web UI and handle flight-plan persistence."""

    def __init__(self, *args: object, **kwargs: object) -> None:
        super().__init__(*args, directory=str(STATIC_ROOT), **kwargs)

    def setup(self) -> None:
        super().setup()
        self.connection.settimeout(getattr(self.server, "request_timeout", 10.0))

    def end_headers(self) -> None:
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("X-Frame-Options", "DENY")
        super().end_headers()

    def _targets_index_file(self) -> bool:
        try:
            target = Path(self.translate_path(self.path)).resolve()
            return target in (STATIC_ROOT.resolve(), INDEX_FILE.resolve())
        except (OSError, ValueError):
            return False

    def _valid_host(self) -> bool:
        return self.headers.get("Host", "") == getattr(self.server, "expected_host", "")

    def _send_json(self, status: int, payload: dict[str, object]) -> None:
        body = json.dumps(payload, ensure_ascii=False, allow_nan=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _read_json_body(self) -> dict[str, object] | None:
        if not self._valid_host() or self.headers.get("Origin") != getattr(self.server, "origin", ""):
            self._send_json(403, {"status": "error", "message": "请求来源无效。"})
            self.close_connection = True
            return None
        if self.headers.get("Transfer-Encoding"):
            self._send_json(400, {"status": "error", "message": "不支持 Transfer-Encoding。"})
            self.close_connection = True
            return None
        if self.headers.get_content_type() != "application/json":
            self._send_json(415, {"status": "error", "message": "仅接受 application/json。"})
            self.close_connection = True
            return None
        length_values = self.headers.get_all("Content-Length", [])
        length_header = length_values[0] if len(length_values) == 1 else ""
        if not length_header.isascii() or not length_header.isdecimal():
            self._send_json(400, {"status": "error", "message": "Content-Length 无效。"})
            self.close_connection = True
            return None
        max_body_bytes = getattr(self.server, "max_body_bytes", MAX_BODY_BYTES)
        normalized_length = length_header.lstrip("0") or "0"
        max_length_text = str(max_body_bytes)
        if len(normalized_length) > len(max_length_text) or (
            len(normalized_length) == len(max_length_text) and normalized_length > max_length_text
        ):
            self._send_json(413, {"status": "error", "message": "请求体超过安全上限。"})
            self.close_connection = True
            return None
        length = int(normalized_length)
        if length <= 0:
            self._send_json(400, {"status": "error", "message": "请求体不能为空。"})
            return None
        try:
            raw_body = self.rfile.read(length)
            if len(raw_body) != length:
                raise ValueError("请求体不完整")
            payload = json.loads(
                raw_body.decode("utf-8"),
                parse_constant=lambda value: (_ for _ in ()).throw(ValueError(value)),
            )
        except (UnicodeDecodeError, json.JSONDecodeError, ValueError, RecursionError, socket.timeout):
            self._send_json(400, {"status": "error", "message": "JSON 请求体无效。"})
            return None
        if not isinstance(payload, dict):
            self._send_json(400, {"status": "error", "message": "JSON 顶层必须是对象。"})
            return None
        token = payload.get("token")
        expected_token = getattr(self.server, "session_token", None)
        if (
            not isinstance(token, str)
            or not isinstance(expected_token, str)
            or not expected_token
            or not secrets.compare_digest(token, expected_token)
        ):
            self._send_json(403, {"status": "error", "message": "会话令牌无效。"})
            return None
        return payload

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
        if not self._valid_host():
            self._send_json(403, {"status": "error", "message": "Host 无效。"})
            return
        if self._targets_index_file():
            self._serve_index()
            return
        super().do_GET()

    def do_HEAD(self) -> None:  # noqa: N802 - SimpleHTTPRequestHandler signature
        if not self._valid_host():
            self._send_json(403, {"status": "error", "message": "Host 无效。"})
            return
        if self._targets_index_file():
            self._serve_index()
            return
        super().do_HEAD()

    def do_POST(self) -> None:  # noqa: N802 - SimpleHTTPRequestHandler signature
        target = urlsplit(self.path)
        if target.query:
            self._send_json(400, {"status": "error", "message": "API 路径不接受 query。"})
            self.close_connection = True
        elif target.path == "/save_flight_plan":
            self._handle_save_flight_plan()
        elif target.path == "/shutdown":
            self._handle_shutdown_request()
        else:
            self._send_json(404, {"status": "error", "message": "Not Found"})

    def _serve_index(self) -> None:
        try:
            template = INDEX_FILE.read_text(encoding="utf-8")
        except OSError as exc:
            self.send_error(500, f"Failed to load index.html: {exc}")
            return
        replacements = {
            "__AMAP_KEY__": html.escape(getattr(self.server, "amap_key", ""), quote=True),
            "__AMAP_SECURITY_CODE__": html.escape(getattr(self.server, "amap_security_code", ""), quote=True),
            "__SESSION_TOKEN__": html.escape(getattr(self.server, "session_token", ""), quote=True),
        }
        for placeholder, value in replacements.items():
            template = template.replace(placeholder, value)
        encoded = template.encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(encoded)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(encoded)

    def _handle_save_flight_plan(self) -> None:
        payload = self._read_json_body()
        if payload is None:
            return
        records = payload.get("photoRecords")
        max_records = getattr(self.server, "max_photo_records", MAX_PHOTO_RECORDS)
        if not isinstance(records, list) or not records:
            self._send_json(422, {"status": "error", "message": "摄影点列表不能为空。"})
            return
        if len(records) > max_records:
            self._send_json(413, {"status": "error", "message": "摄影点数量超过安全上限。"})
            return
        rows: list[tuple[int, int, float, float, str]] = []
        for index, entry in enumerate(records):
            if not isinstance(entry, dict):
                self._send_json(422, {"status": "error", "message": f"第 {index + 1} 个摄影点结构无效。"})
                return
            sequence = entry.get("sequence")
            line = entry.get("line")
            lng = entry.get("longitude")
            lat = entry.get("latitude")
            numeric_values = (lng, lat)
            if (
                isinstance(sequence, bool) or not isinstance(sequence, int) or sequence < 1
                or isinstance(line, bool) or not isinstance(line, int) or line < 1
                or any(isinstance(value, bool) or not isinstance(value, (int, float)) for value in numeric_values)
            ):
                self._send_json(422, {"status": "error", "message": f"第 {index + 1} 个摄影点字段无效。"})
                return
            try:
                lng_value = float(lng)
                lat_value = float(lat)
            except (OverflowError, ValueError):
                self._send_json(422, {"status": "error", "message": f"第 {index + 1} 个摄影点坐标无效。"})
                return
            if (
                not math.isfinite(lng_value)
                or not math.isfinite(lat_value)
                or not -180 <= lng_value <= 180
                or not -90 <= lat_value <= 90
            ):
                self._send_json(422, {"status": "error", "message": f"第 {index + 1} 个摄影点坐标越界。"})
                return
            rows.append((sequence, line, lng_value, lat_value, "GCJ-02"))

        timestamp = datetime.datetime.now().strftime("%Y%m%d%H%M%S")
        output_dir = getattr(self.server, "output_dir", Path.cwd())
        output_path: Path | None = None
        try:
            with self.server.csv_lock:
                for counter in range(10_000):
                    suffix = "" if counter == 0 else f"_{counter}"
                    filename = f"{timestamp}{suffix}.csv"
                    candidate = output_dir / filename
                    try:
                        csv_file = candidate.open("x", newline="", encoding="utf-8-sig")
                    except FileExistsError:
                        continue
                    output_path = candidate
                    with csv_file:
                        writer = csv.writer(csv_file)
                        writer.writerow(
                            [
                                "sequence",
                                "flight_line",
                                "longitude_gcj02",
                                "latitude_gcj02",
                                "coordinate_system",
                            ]
                        )
                        writer.writerows(rows)
                    break
                else:
                    raise OSError("无法生成唯一文件名")
        except OSError:
            if output_path is not None:
                output_path.unlink(missing_ok=True)
            self._send_json(500, {"status": "error", "message": "无法写入 CSV，请检查输出目录权限。"})
            return
        self._send_json(
            200,
            {
                "status": "ok",
                "filename": output_path.name,
                "count": len(rows),
                "coordinateSystem": "GCJ-02",
            },
        )

    def _handle_shutdown_request(self) -> None:
        if self._read_json_body() is None:
            return
        self._send_json(200, {"status": "stopping"})
        self._schedule_shutdown()

    def log_message(self, fmt: str, *args: object) -> None:
        # Quieter server logs while still accessible for debugging via stderr.
        sys.stderr.write("[INFO] " + fmt % args + "\n")


class _AppServer(http.server.ThreadingHTTPServer):
    # Wait for an in-progress CSV write instead of ending the process while a
    # request thread is still flushing the file.
    daemon_threads = False
    allow_reuse_address = True
    request_timeout = 10.0
    max_body_bytes = MAX_BODY_BYTES
    max_photo_records = MAX_PHOTO_RECORDS


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="本地航空摄影航迹规划工具")
    parser.add_argument("--port", type=int, default=0, help="本地端口，0 表示自动选择")
    parser.add_argument("--output-dir", type=Path, default=Path.cwd(), help="CSV 输出目录")
    parser.add_argument("--no-browser", action="store_true", help="不自动打开浏览器")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = _build_parser().parse_args(argv)
    if args.port < 0 or args.port > 65535:
        print("端口必须在 0 到 65535 之间。", file=sys.stderr)
        return 2
    try:
        amap_key = _load_amap_key()
    except RuntimeError as exc:
        print(str(exc), file=sys.stderr)
        return 2
    if not amap_key:
        print(
            "缺少高德 Web 端 Key。请设置 AMAP_WEB_KEY，或在脚本目录创建 amap.local.key。",
            file=sys.stderr,
        )
        return 2
    if len(amap_key) > 256 or any(ord(char) < 32 for char in amap_key):
        print("高德 Key 格式无效。", file=sys.stderr)
        return 2
    amap_security_code = os.environ.get("AMAP_SECURITY_JS_CODE", "").strip()
    if len(amap_security_code) > 512 or any(ord(char) < 32 for char in amap_security_code):
        print("高德安全密钥格式无效。", file=sys.stderr)
        return 2
    try:
        output_dir = args.output_dir.expanduser().resolve()
        output_dir.mkdir(parents=True, exist_ok=True)
    except OSError as exc:
        print(f"无法创建输出目录：{exc}", file=sys.stderr)
        return 2
    if not output_dir.is_dir():
        print("CSV 输出路径不是目录。", file=sys.stderr)
        return 2
    if not INDEX_FILE.is_file():
        print("缺少 web/index.html，无法启动。", file=sys.stderr)
        return 2

    try:
        httpd = _AppServer(("127.0.0.1", args.port), _AppHandler)
    except OSError as exc:
        print(f"无法启动本地服务：{exc}", file=sys.stderr)
        return 2

    with httpd:
        httpd.shutdown_lock = threading.Lock()
        httpd.shutdown_timer = None
        httpd.csv_lock = threading.Lock()
        httpd.session_token = secrets.token_urlsafe(32)
        httpd.amap_key = amap_key
        httpd.amap_security_code = amap_security_code
        httpd.output_dir = output_dir
        port = httpd.server_address[1]
        httpd.expected_host = f"127.0.0.1:{port}"
        httpd.origin = f"http://{httpd.expected_host}"
        url = f"{httpd.origin}/"
        print("已启动本地航迹规划服务：")
        print(f"  {url}")
        print(f"CSV 输出目录：{output_dir}")
        if not amap_security_code:
            print("提示：未设置 AMAP_SECURITY_JS_CODE；新申请的高德 Key 可能无法通过鉴权。")
        print("可点击页面右上角“关闭服务”，或按 Ctrl+C 停止。")

        if not args.no_browser:
            threading.Thread(target=webbrowser.open, args=(url,), daemon=True).start()
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n收到中断，正在退出...")
        finally:
            print("服务已停止。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
