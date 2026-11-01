"""Real HTTP regressions: repeat loads, byte ranges, and serving confinement."""
import importlib.util
import http.client
import pathlib
import socketserver
import tempfile
import threading
import unittest

spec = importlib.util.spec_from_file_location('game_server', pathlib.Path(__file__).with_name('server.py'))
server = importlib.util.module_from_spec(spec)
spec.loader.exec_module(server)

class ServingContract(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        server.ROOT = cls.tmp.name
        pathlib.Path(server.ROOT, 'engine.wasm').write_bytes(b'0123456789')
        pathlib.Path(server.ROOT, 'index.html').write_text('JEDI:RE')
        cls.http = socketserver.ThreadingTCPServer(('127.0.0.1', 0), server.H)
        cls.thread = threading.Thread(target=cls.http.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.http.shutdown(); cls.http.server_close(); cls.tmp.cleanup()

    def request(self, path, headers=None):
        conn = http.client.HTTPConnection('127.0.0.1', self.http.server_address[1], timeout=3)
        conn.request('GET', path, headers=headers or {})
        response = conn.getresponse(); result = response.status, dict(response.getheaders()), response.read()
        conn.close(); return result

    def test_repeat_load_reuses_bytes(self):
        status, headers, body = self.request('/engine.wasm')
        self.assertEqual(status, 200); self.assertEqual(body, b'0123456789')
        self.assertIn('must-revalidate', headers['Cache-Control'])
        self.assertEqual(self.request('/engine.wasm', {'If-Modified-Since':headers['Last-Modified']})[0], 304)
        self.assertEqual(self.request('/index.html')[1]['Cache-Control'], 'no-store')

    def test_ranges_and_if_range(self):
        status, headers, body = self.request('/engine.wasm', {'Range':'bytes=2-4'})
        self.assertEqual((status, body), (206, b'234'))
        self.assertEqual(headers['Content-Range'], 'bytes 2-4/10')
        self.assertEqual(self.request('/engine.wasm', {'Range':'bytes=-3'})[2], b'789')
        self.assertEqual(self.request('/engine.wasm', {'Range':'bytes=2-4','If-Range':'Wed, 01 Jan 1997 00:00:00 GMT'})[0],200)
        self.assertEqual(self.request('/engine.wasm', {'Range':'bytes=99-'})[0],416)

    def test_isolation_and_root(self):
        self.assertEqual(self.request('/engine.wasm')[1]['Cross-Origin-Opener-Policy'], 'same-origin')
        self.assertEqual(self.request('/%2e%2e/engine.wasm')[0],404)

if __name__ == '__main__': unittest.main()
