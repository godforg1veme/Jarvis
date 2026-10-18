"""Stratified CPU PNG parity check against a completed local evaluation."""
import argparse
from collections import defaultdict
import hashlib
import io
import json
from pathlib import Path
import random
import statistics
import time
from PIL import Image
from frozen_backend import FrozenRecognizer


def verify(bundle, reference, output):
    if output.exists():
        raise ValueError('Preserve the earlier report')
    groups = defaultdict(list)
    for line in (reference / 'predictions.jsonl').read_text(encoding='utf-8').splitlines():
        record = json.loads(line)
        groups[record['set']].append(record)
    rng = random.Random(2026101802)
    rows = []
    for name, count in [('known_originals_regression', 9), ('final_fresh', 32),
                        ('final_stress_fresh', 16), ('new_geometry_20261018', 16)]:
        rows.extend(rng.sample(groups[name], count))
    recognizer = FrozenRecognizer(bundle, hashlib.sha256((bundle / 'bundle.json').read_bytes()).hexdigest())
    matching = correct = invalid = 0
    latencies = []
    for i, record in enumerate(rows):
        with Image.open(record['file']) as image:
            png = io.BytesIO(); image.convert('RGB').save(png, 'PNG')
        started = time.perf_counter()
        try:
            answer = recognizer.recognize(png.getvalue())
        except ValueError as error:
            if str(error) != 'OCR_NO_CONSENSUS':
                raise
            answer = None
            invalid += 1
        latencies.append(time.perf_counter() - started)
        matching += answer == (record['text'] if record['valid'] else None)
        correct += answer == ' '.join(record['truth'].casefold().split())
        if (i + 1) % 16 == 0:
            print(json.dumps({'cpuPngProcessed': i + 1, 'n': len(rows)}), flush=True)
    report = {'n': len(rows), 'matchingReference': matching, 'correct': correct, 'invalid': invalid,
              'medianSeconds': statistics.median(latencies), 'maxSeconds': max(latencies),
              'seed': 2026101802, 'device': 'cpu', 'transport': 'PNG single request'}
    output.write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(report), flush=True)
    if matching != len(rows):
        raise ValueError('CPU parity mismatch')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--bundle', type=Path, default=Path(__file__).parent / 'frozen-bundle')
    parser.add_argument('--reference', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    verify(args.bundle, args.reference, args.output)
