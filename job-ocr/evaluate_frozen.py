"""Offline, aggregate-only evaluation. Images/answers never enter stdout or Git."""
import argparse
import csv
import hashlib
import io
import json
from pathlib import Path
import statistics
import time
from PIL import Image
from frozen_backend import FrozenRecognizer
from worker import valid_answer


def norm(text):
    return ' '.join(text.casefold().split())


def evaluate(source, bundle, output, new_set=None, device='cpu'):
    source, bundle, output = map(Path, (source, bundle, output))
    if output.exists():
        raise ValueError('Evaluation output already exists; preserve earlier results.')
    output.mkdir(parents=True)
    digest = hashlib.sha256((bundle / 'bundle.json').read_bytes()).hexdigest()
    started = time.perf_counter()
    recognizer = FrozenRecognizer(bundle, digest, device=device)
    report = {'bundleSha256': digest, 'device': device, 'loadSeconds': time.perf_counter() - started,
              'normalization': 'casefold/whitespace; internal space and ё significant', 'sets': {}}
    exp = source / 'experiments/recognition_v2'
    originals = []
    with (source / 'evaluation_current/ground_truth_visual.tsv').open(encoding='utf-8') as f:
        for name, truth in csv.reader(f, delimiter='\t'):
            originals.append((source / name if name == 'test.jpg' else source / 'test_samples' / name, truth))
    sets = {'known_originals_regression': originals}
    for name in ['final_fresh', 'final_stress_fresh']:
        with (exp / name / 'labels.tsv').open(encoding='utf-8') as f:
            sets[name] = [(exp / name / 'curved' / Path(p).name, text) for p, text in csv.reader(f, delimiter='\t')]
    if new_set:
        root = Path(new_set)
        with (root / 'labels.tsv').open(encoding='utf-8') as f:
            sets['new_geometry_20261018'] = [(root / p, text) for p, text in csv.reader(f, delimiter='\t')]
    prior = {}
    with (exp / 'final_evaluation_v4/predictions.jsonl').open(encoding='utf-8') as f:
        for line in f:
            record = json.loads(line)
            prior[(source / record['file']).resolve()] = record['after']
    predictions = []
    for name, rows in sets.items():
        started = time.perf_counter()
        correct = invalid = compared = parity = 0
        for offset in range(0, len(rows), 16):
            batch = rows[offset:offset + 16]
            images = []
            for path, _ in batch:
                with Image.open(path) as image:
                    images.append(image.convert('RGB'))
            results = recognizer.predict_images(images)
            for (path, truth), (text, score) in zip(batch, results):
                valid = valid_answer(text)
                correct += valid and norm(text) == norm(truth)
                invalid += not valid
                if path.resolve() in prior:
                    compared += 1
                    parity += text == prior[path.resolve()]
                predictions.append({'set': name, 'file': str(path), 'truth': truth, 'text': text,
                                    'score': score, 'valid': valid})
            if (offset // 16) % 10 == 0:
                print(json.dumps({'set': name, 'processed': min(offset + 16, len(rows)), 'total': len(rows)}), flush=True)
        report['sets'][name] = {'n': len(rows), 'correct': correct, 'invalid': invalid,
                               'accuracy': correct / len(rows), 'seconds': time.perf_counter() - started,
                               'priorCompared': compared, 'priorMatching': parity}
        print(json.dumps({'set': name, **report['sets'][name]}), flush=True)
    latencies = []
    for path, truth in originals:
        with Image.open(path) as image:
            data = io.BytesIO()
            image.convert('RGB').save(data, format='PNG')
        start = time.perf_counter()
        answer = recognizer.recognize(data.getvalue())
        latencies.append(time.perf_counter() - start)
        if norm(answer) != norm(truth):
            raise ValueError('Original PNG transport regression')
    report['singlePngSeconds'] = {'n': len(latencies), 'median': statistics.median(latencies), 'max': max(latencies)}
    (output / 'predictions.jsonl').write_text('\n'.join(json.dumps(v, ensure_ascii=False) for v in predictions) + '\n', encoding='utf-8')
    (output / 'summary.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(report), flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('--bundle', type=Path, default=Path(__file__).parent / 'frozen-bundle')
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--new-set', type=Path)
    parser.add_argument('--device', choices=['cpu', 'gpu:0'], default='cpu')
    args = parser.parse_args()
    evaluate(args.source, args.bundle, args.output, args.new_set, args.device)
