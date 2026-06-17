import argparse
import io
import json
import os
import sys
import traceback


def parse_args():
    parser = argparse.ArgumentParser(description="Long-running Silero TTS worker.")
    parser.add_argument("--model-path", required=True)
    parser.add_argument("--speaker", default="baya")
    parser.add_argument("--sample-rate", type=int, default=48000)
    parser.add_argument("--threads", type=int, default=4)
    return parser.parse_args()


def write_json(payload):
    sys.stdout.write(json.dumps(payload, ensure_ascii=True) + "\n")
    sys.stdout.flush()


def stdin_lines():
    return io.TextIOWrapper(sys.stdin.buffer, encoding="utf-8")


def load_model(args):
    if not os.path.exists(args.model_path):
        raise FileNotFoundError(f"Silero model not found: {args.model_path}")

    import torch

    torch.set_num_threads(max(1, args.threads))
    device = torch.device("cpu")
    model = torch.package.PackageImporter(args.model_path).load_pickle("tts_models", "model")
    model.to(device)
    return model


def synthesize(model, args, request):
    text = str(request.get("text") or "").strip()
    output_file = str(request.get("outputFile") or "").strip()

    if not text:
        raise ValueError("text is required")
    if not output_file:
        raise ValueError("outputFile is required")

    os.makedirs(os.path.dirname(output_file), exist_ok=True)
    model.save_wav(
        text=text,
        speaker=args.speaker,
        sample_rate=args.sample_rate,
        audio_path=output_file,
        put_accent=True,
        put_yo=True,
    )


def main():
    args = parse_args()

    try:
        model = load_model(args)
        write_json({"type": "ready"})
    except Exception as error:
        write_json({"type": "error", "error": str(error)})
        traceback.print_exc(file=sys.stderr)
        raise SystemExit(1)

    for line in stdin_lines():
        line = line.strip()
        if not line:
            continue

        request = {}
        try:
            request = json.loads(line)
            request_id = request.get("id")
            synthesize(model, args, request)
            write_json({"id": request_id, "ok": True, "outputFile": request.get("outputFile")})
        except Exception as error:
            write_json({"id": request.get("id"), "ok": False, "error": str(error)})
            traceback.print_exc(file=sys.stderr)


if __name__ == "__main__":
    main()
