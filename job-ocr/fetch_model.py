"""Build-time download of one pinned public model; never used by the worker."""
import hashlib
import json
import pathlib
import urllib.request

def main():
    root = pathlib.Path('/opt/ocr-model')
    manifest = json.loads((root / 'model.json').read_text(encoding='utf-8'))
    expected = 'https://huggingface.co/PaddlePaddle/cyrillic_PP-OCRv5_mobile_rec_onnx/resolve/'
    if not manifest['url'].startswith(expected) or not 1 <= manifest['size'] <= 16000000:
        raise ValueError()
    with urllib.request.urlopen(manifest['url'], timeout=60) as response:
        data = response.read(manifest['size'] + 1)
    if len(data) != manifest['size'] or hashlib.sha256(data).hexdigest() != manifest['sha256']:
        raise ValueError()
    (root / 'model.onnx').write_bytes(data)


if __name__ == '__main__':
    try:
        main()
    except Exception:
        raise SystemExit('OCR_MODEL_DOWNLOAD_FAILED')
