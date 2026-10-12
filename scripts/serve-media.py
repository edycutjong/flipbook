#!/usr/bin/env python3
"""Static file server with HTTP Range support, for the Matches row's demo media (see DEMO.md).
Usage: python3 scripts/serve-media.py <root> [port]   (default port 8765)
It binds 0.0.0.0 so the Vega Virtual Device can reach the Mac at 10.0.2.2: it serves <root> to your whole network, so stop it when you are done."""
import os, re, sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from functools import partial

class RangeHandler(SimpleHTTPRequestHandler):
    def send_head(self):
        path = self.translate_path(self.path)
        rng = self.headers.get('Range')
        if not rng or not os.path.isfile(path):
            return super().send_head()
        m = re.match(r'bytes=(\d*)-(\d*)', rng)
        size = os.path.getsize(path)
        start = int(m.group(1)) if m.group(1) else 0
        end = int(m.group(2)) if m.group(2) else size - 1
        if m.group(1) == '' and m.group(2):
            start, end = size - int(m.group(2)), size - 1
        end = min(end, size - 1)
        if start > end:
            self.send_error(416); return None
        f = open(path, 'rb'); f.seek(start)
        self.send_response(206)
        self.send_header('Content-Type', self.guess_type(path))
        self.send_header('Accept-Ranges', 'bytes')
        self.send_header('Content-Range', f'bytes {start}-{end}/{size}')
        self.send_header('Content-Length', str(end - start + 1))
        self.end_headers()
        self.range_left = end - start + 1
        return f
    def copyfile(self, src, dst):
        left = getattr(self, 'range_left', None)
        if left is None:
            return super().copyfile(src, dst)
        while left > 0:
            buf = src.read(min(65536, left))
            if not buf: break
            try: dst.write(buf)
            except (BrokenPipeError, ConnectionResetError): break
            left -= len(buf)
    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        if not self.headers.get('Range'):
            self.send_header('Accept-Ranges', 'bytes')
        super().end_headers()
    def log_message(self, fmt, *args):
        sys.stderr.write("%s %s\n" % (self.log_date_time_string(), fmt % args))

root = sys.argv[1]; port = int(sys.argv[2]) if len(sys.argv) > 2 else 8765
ThreadingHTTPServer(('0.0.0.0', port), partial(RangeHandler, directory=root)).serve_forever()
