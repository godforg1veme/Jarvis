import argparse
import os
import sys


def parse_args():
    parser = argparse.ArgumentParser(description="Generate a WAV file with Silero TTS.")
    parser.add_argument("--model-path", required=True)
    parser.add_argument("--speaker", default="baya")
    parser.add_argument("--sample-rate", type=int, default=48000)
    parser.add_argument("--threads", type=int, default=4)
    parser.add_argument("--output-file", required=True)
    return parser.parse_args()


def main():
    args = parse_args()
    text = sys.stdin.buffer.read().decode("utf-8").strip()
    if not text:
        raise SystemExit("No text provided on stdin.")

    if not os.path.exists(args.model_path):
        raise SystemExit(f"Silero model not found: {args.model_path}")

    import torch

    torch.set_num_threads(max(1, args.threads))
    device = torch.device("cpu")
    model = torch.package.PackageImporter(args.model_path).load_pickle("tts_models", "model")
    model.to(device)

    os.makedirs(os.path.dirname(args.output_file), exist_ok=True)
    model.save_wav(
        text=text,
        speaker=args.speaker,
        sample_rate=args.sample_rate,
        audio_path=args.output_file,
        put_accent=True,
        put_yo=True,
    )


if __name__ == "__main__":
    main()
