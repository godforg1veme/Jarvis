"""Offline acceptance helper: print the bounded answer only to the test process."""
import argparse
import hashlib
import json
from pathlib import Path
from frozen_backend import FrozenRecognizer

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('png', type=Path)
    parser.add_argument('--bundle', type=Path, default=Path(__file__).parent / 'frozen-bundle')
    args = parser.parse_args()
    recognizer = FrozenRecognizer(args.bundle, hashlib.sha256((args.bundle / 'bundle.json').read_bytes()).hexdigest())
    with args.png.open('rb') as source:
        data = source.read(262145)
    print(json.dumps({'answer': recognizer.recognize(data)}, ensure_ascii=True))
