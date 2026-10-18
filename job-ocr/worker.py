"""Offline image recognizer. No browser, credentials, LLM, or network client."""
import collections
import hashlib
import io
import json
import math
import os
import re
import socket
import socketserver
import stat
import threading
import warnings
from http.server import BaseHTTPRequestHandler
from pathlib import Path
from preprocessing import recognition_images, recognition_tensor

MAX_BYTES = 262144
SOCKET = '/run/job-ocr/ocr.sock'
MODEL_ROOT = Path('/opt/ocr-model')
ANSWER = re.compile(r'[а-яё]{2,20} [а-яё]{2,20}')


def valid_answer(value):
    return isinstance(value, str) and ANSWER.fullmatch(value) is not None


def image_from_bytes(data):
    from PIL import Image
    if not isinstance(data, bytes) or not 0 < len(data) <= MAX_BYTES or not data.startswith(b'\x89PNG\r\n\x1a\n'):
        raise ValueError('OCR_INPUT_REJECTED')
    with warnings.catch_warnings():
        warnings.simplefilter('error', Image.DecompressionBombWarning)
        image = Image.open(io.BytesIO(data))
        if image.format != 'PNG' or getattr(image, 'n_frames', 1) != 1 or not (1 <= image.width <= 2048
                and 1 <= image.height <= 512 and image.width * image.height <= 1048576):
            raise ValueError('OCR_INPUT_REJECTED')
        image.load()
        return image.convert('RGB')


def choose_answer(candidates):
    groups = collections.defaultdict(list)
    for answer, confidence in candidates:
        if valid_answer(answer) and isinstance(confidence, (float, int)) and math.isfinite(confidence) and 0.85 <= confidence <= 1:
            groups[answer].append(float(confidence))
    total = sum(map(len, groups.values()))
    if not total:
        raise ValueError('OCR_NO_CONSENSUS')
    ranked = sorted(groups.items(), key=lambda item: (len(item[1]), sum(item[1]) / len(item[1])), reverse=True)
    answer, votes = ranked[0]
    if len(votes) < 4 or len(votes) / total < 0.60:
        raise ValueError('OCR_NO_CONSENSUS')
    return answer


class Recognizer:
    def __init__(self, root=MODEL_ROOT):
        import numpy as np
        import onnxruntime as ort
        self.np = np
        manifest = json.loads((root / 'model.json').read_text(encoding='utf-8'))
        model = root / 'model.onnx'
        if model.stat().st_size != manifest['size'] or hashlib.sha256(model.read_bytes()).hexdigest() != manifest['sha256']:
            raise ValueError('OCR_MODEL_REJECTED')
        charset_bytes = (root / 'characters.json').read_bytes()
        if hashlib.sha256(charset_bytes).hexdigest() != manifest['charactersSha256']:
            raise ValueError('OCR_MODEL_REJECTED')
        self.characters = json.loads(charset_bytes)['characters']
        if not isinstance(self.characters, list) or not 1 < len(self.characters) < 2000 or not all(isinstance(c, str) and len(c) == 1 for c in self.characters):
            raise ValueError('OCR_MODEL_REJECTED')
        options = ort.SessionOptions()
        options.intra_op_num_threads = 1
        options.inter_op_num_threads = 1
        self.session = ort.InferenceSession(str(model), sess_options=options, providers=['CPUExecutionProvider'])
        if len(self.session.get_inputs()) != 1 or len(self.session.get_outputs()) != 1:
            raise ValueError('OCR_MODEL_REJECTED')
        self.input_name = self.session.get_inputs()[0].name
        self.allowed = {0} | {i + 1 for i, c in enumerate(self.characters) if c == ' ' or re.fullmatch('[а-яё]', c.lower())}

    def recognize(self, data):
        np = self.np
        candidates = []
        for image in recognition_images(image_from_bytes(data)):
            tensor = recognition_tensor(image)
            probabilities = self.session.run(None, {self.input_name: tensor})[0][0]
            if probabilities.ndim != 2 or probabilities.shape[1] != len(self.characters) + 1 or not np.isfinite(probabilities).all():
                raise ValueError('OCR_RESULT_REJECTED')
            masked = probabilities.copy()
            masked[:, [i for i in range(masked.shape[1]) if i not in self.allowed]] = -1
            ids = masked.argmax(axis=-1)
            answer, confidence, last = [], [], -1
            for t, index in enumerate(ids):
                if index != last and index > 0:
                    answer.append(self.characters[int(index) - 1])
                    confidence.append(float(probabilities[t, index]))
                last = index
            candidates.append((''.join(answer).strip().lower(), sum(confidence) / len(confidence) if confidence else 0))
        return choose_answer(candidates)


def rejection_code(error):
    # No exception text may escape. Only these literal internal ValueErrors
    # are public diagnostics; arbitrary messages collapse to a fixed fallback.
    allowed = {'OCR_NO_CONSENSUS', 'OCR_INPUT_REJECTED', 'OCR_RESULT_REJECTED'}
    return str(error) if type(error) is ValueError and str(error) in allowed else 'OCR_REJECTED'


class Handler(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.0'

    def setup(self):
        super().setup()
        self.connection.settimeout(3)

    def log_message(self, *args):
        pass  # Never log request data, headers, images, answers, or exception messages.

    def respond(self, status_code, value):
        body = json.dumps(value, ensure_ascii=True).encode()
        self.send_response(status_code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        self.respond(200 if self.path == '/health' else 404, {'ok': self.path == '/health'})

    def do_POST(self):
        watchdog = None
        try:
            lengths = self.headers.get_all('Content-Length', [])
            if self.path not in ('/ocr', '/ocr/frozen') or self.headers.get('Content-Type') != 'image/png' or self.headers.get('Transfer-Encoding') or len(lengths) != 1 or not re.fullmatch('[0-9]{1,6}', lengths[0]):
                return self.respond(400, {'code': 'OCR_INPUT_REJECTED'})
            if self.path == '/ocr/frozen' and getattr(self.server, 'backend', None) != 'frozen':
                return self.respond(503, {'code': 'OCR_MODEL_REJECTED'})
            length = int(lengths[0])
            if not 0 < length <= MAX_BYTES:
                return self.respond(413, {'code': 'OCR_INPUT_REJECTED'})
            data = self.rfile.read(length)
            if len(data) != length:
                return self.respond(400, {'code': 'OCR_INPUT_REJECTED'})
            watchdog = threading.Timer(12, lambda: os._exit(70))
            watchdog.daemon = True
            watchdog.start()
            answer = self.server.recognizer.recognize(data)
            if not valid_answer(answer):
                raise ValueError('OCR_RESULT_REJECTED')
            self.respond(200, {'answer': answer})
        except Exception as error:
            code = rejection_code(error)
            print('JOB_' + code, flush=True)
            self.respond(422, {'code': code})
        finally:
            if watchdog:
                watchdog.cancel()


class Server(getattr(socketserver, 'UnixStreamServer', socketserver.TCPServer)):
    def handle_error(self, request, client_address):
        print('JOB_OCR_REQUEST_FAILED', flush=True)


def main():
    if not hasattr(socket, 'AF_UNIX') or not hasattr(socketserver, 'UnixStreamServer'):
        raise ValueError('OCR_SOCKET_REJECTED')
    os.umask(0o077)
    directory = Path(SOCKET).parent
    directory_stat = directory.lstat()
    if not stat.S_ISDIR(directory_stat.st_mode) or directory_stat.st_uid != os.getuid() or directory_stat.st_mode & 0o077:
        raise ValueError('OCR_SOCKET_REJECTED')
    try:
        old = os.lstat(SOCKET)
        if not stat.S_ISSOCK(old.st_mode) or old.st_uid != os.getuid():
            raise ValueError('OCR_SOCKET_REJECTED')
        os.unlink(SOCKET)
    except FileNotFoundError:
        pass
    backend = os.environ.get('JARVIS_OCR_BACKEND', 'onnx')
    if backend == 'frozen':
        from frozen_backend import FrozenRecognizer
        recognizer = FrozenRecognizer()
    elif backend == 'onnx':
        recognizer = Recognizer()
    else:
        raise ValueError('OCR_MODEL_REJECTED')
    with Server(SOCKET, Handler) as server:
        os.chmod(SOCKET, 0o600)
        server.recognizer = recognizer
        server.backend = backend
        server.serve_forever(poll_interval=0.25)


if __name__ == '__main__':
    try:
        main()
    except Exception:
        print('JOB_OCR_START_FAILED', flush=True)
        raise SystemExit(1)
