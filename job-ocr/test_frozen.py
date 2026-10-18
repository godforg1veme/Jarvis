import hashlib
import io
import json
from pathlib import Path
import tempfile
import unittest
import http.client
from http.server import HTTPServer
import threading
from frozen_backend import FrozenRecognizer, verify_bundle
from prepare_frozen import prepare
from worker import Handler


class FrozenTests(unittest.TestCase):
    def test_frozen_endpoint_refuses_legacy_backend_before_inference(self):
        from PIL import Image
        png = io.BytesIO(); Image.new('RGB', (250, 90)).save(png, 'PNG')
        for backend in ('onnx', 'frozen'):
            class Model:
                calls = 0
                def recognize(self, data):
                    self.calls += 1
                    return 'проверка картинки'
            with HTTPServer(('127.0.0.1', 0), Handler) as server:
                server.recognizer = Model(); server.backend = backend
                task = threading.Thread(target=server.handle_request, daemon=True); task.start()
                client = http.client.HTTPConnection('127.0.0.1', server.server_port, timeout=3)
                try:
                    client.request('POST', '/ocr/frozen', body=png.getvalue(), headers={'Content-Type': 'image/png'})
                    response = client.getresponse()
                    self.assertEqual(response.status, 200 if backend == 'frozen' else 503)
                    value = json.loads(response.read())
                    self.assertEqual(value, {'answer': 'проверка картинки'} if backend == 'frozen' else {'code': 'OCR_MODEL_REJECTED'})
                    self.assertEqual(server.recognizer.calls, int(backend == 'frozen'))
                finally:
                    client.close(); task.join(timeout=5)

    def test_bundle_rejects_hash_changes_extra_code_and_path_escape(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'code.py').write_text('trusted')
            manifest = {'sourceRevision': 'fixture', 'files': {'code.py': hashlib.sha256(b'trusted').hexdigest()}}
            path = root / 'bundle.json'
            def write():
                path.write_text(json.dumps(manifest))
                return hashlib.sha256(path.read_bytes()).hexdigest()
            digest = write()
            self.assertEqual(verify_bundle(root, digest), manifest)
            with self.assertRaises(ValueError): verify_bundle(root, 'a' * 64)
            (root / 'extra.py').write_text('untrusted')
            with self.assertRaises(ValueError): verify_bundle(root, digest)
            (root / 'extra.py').unlink()
            (root / 'code.py').write_text('tampered')
            with self.assertRaises(ValueError): verify_bundle(root, digest)
            manifest['files'] = {'../outside': 'a' * 64}
            with self.assertRaises(ValueError): verify_bundle(root, write())

    def test_preparation_checks_source_before_creating_output(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with self.assertRaises((ValueError, FileNotFoundError)):
                prepare(root, root / 'output')
            self.assertFalse((root / 'output').exists())

    def test_pixels_keep_bgr_order_and_one_original_pipeline_pass(self):
        from PIL import Image
        import numpy as np
        recognizer = FrozenRecognizer.__new__(FrozenRecognizer)
        class Model:
            def predict(self, images):
                self.images = images
                return [('проверка картинки', 0.99)]
        recognizer.model = Model()
        data = io.BytesIO()
        Image.new('RGB', (250, 90), (10, 20, 30)).save(data, 'PNG')
        self.assertEqual(recognizer.recognize(data.getvalue()), 'проверка картинки')
        np.testing.assert_array_equal(recognizer.model.images[0][0, 0], [30, 20, 10])
        with self.assertRaises(ValueError): recognizer.recognize(b'not a png')
        with self.assertRaises(ValueError): recognizer.predict_image(Image.new('RGB', (500, 180)))
        with self.assertRaises(ValueError): recognizer.predict_images([Image.new('RGB', (250, 90))] * 33)

    def test_invalid_nonfinite_and_nonrussian_outputs_do_not_escape(self):
        from PIL import Image
        recognizer = FrozenRecognizer.__new__(FrozenRecognizer)
        data = io.BytesIO(); Image.new('RGB', (250, 90)).save(data, 'PNG')
        for result in [[], [('слово слово', float('nan'))], [('слово слово', float('inf'))], [(123, .9)], [('english words', .99)], [('а б', .99)]]:
            class Model:
                def predict(self, images): return result
            recognizer.model = Model()
            with self.assertRaises(ValueError): recognizer.recognize(data.getvalue())


if __name__ == '__main__':
    unittest.main()
