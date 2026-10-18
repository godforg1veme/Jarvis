"""Prepare a hash-pinned local inference bundle; never copy datasets or secrets."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil

HERE = Path(__file__).resolve().parent


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def prepare(source, destination):
    source = Path(source).resolve()
    destination = Path(destination).resolve()
    pinned = json.loads((HERE / 'frozen-source.json').read_text(encoding='utf-8'))
    # Check everything before writing anything. The pin file, not the supplied
    # source checkout, selects the paths and hashes permitted in this bundle.
    for name, expected in pinned['files'].items():
        relative = Path(name)
        if relative.is_absolute() or '..' in relative.parts:
            raise ValueError('OCR_BUNDLE_REJECTED')
        path = source / relative
        if path.is_symlink() or not path.resolve().is_relative_to(source) or digest(path) != expected:
            raise ValueError('OCR_BUNDLE_REJECTED')
    destination.mkdir(parents=True, exist_ok=False, mode=0o700)
    for name in pinned['files']:
        target = destination / name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source / name, target)
    # Windows DLL discovery has no meaning in the Linux CPU worker.
    model = destination / 'recognition_model.py'
    text = model.read_text(encoding='utf-8')
    text = text.replace('if base.exists():', "if os.name == 'nt' and base.exists():")
    model.write_text(text, encoding='utf-8', newline='\n')
    # Bound the curve remap before it allocates its output mesh. This rejects
    # pathological geometry; ordinary recognized images follow the same path.
    rectifier = destination / 'rectifier.py'
    text = rectifier.read_text(encoding='utf-8')
    marker = '        int(round(arc_length)),\n    )'
    if text.count(marker) != 1:
        raise ValueError('OCR_BUNDLE_REJECTED')
    text = text.replace(marker, marker + "\n    if output_width > 1024:\n        raise ValueError('OCR_INPUT_REJECTED')")
    rectifier.write_text(text, encoding='utf-8', newline='\n')
    manifest = {'sourceRevision': pinned['sourceRevision'],
                'files': {name: digest(destination / name) for name in pinned['files']}}
    (destination / 'bundle.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'prepared': True, 'files': len(manifest['files']),
                      'manifestSha256': digest(destination / 'bundle.json')}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('--output', type=Path, default=HERE / 'frozen-bundle')
    args = parser.parse_args()
    prepare(args.source, args.output)
