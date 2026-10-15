"""Bounded, deterministic image alternatives; no guessing or external resources."""
import numpy as np
from PIL import Image, ImageOps

MAX_VARIANTS = 54
MAX_RECOGNITION_WIDTH = 1024


def recognition_images(image):
    gray = ImageOps.grayscale(image)
    contrast = ImageOps.autocontrast(gray)
    # Keep an unwarped path: an arc transform can destroy already straight text.
    yield gray
    yield contrast
    yield ImageOps.invert(gray)
    yield ImageOps.invert(contrast)
    array = np.asarray(gray)
    height, width = array.shape
    for lower in (False, True):
        angles = np.linspace(2.95, 0.19, 900)[None, :] if lower else np.linspace(-2.95, -0.19, 900)[None, :]
        for factor in (0.9 + i * 0.025 for i in range(25)):
            center_y = height * (1 - factor) if lower else height * factor
            outer = height - center_y if lower else center_y
            # Both directions map left-to-right and top-to-bottom. Mirroring
            # the input alone would also mirror the glyphs and is insufficient.
            radii = np.linspace(outer - 80, outer + 12, 140)[:, None] if lower else np.linspace(outer + 12, outer - 80, 140)[:, None]
            xs = np.rint(width / 2 + radii * np.cos(angles)).astype(int)
            ys = np.rint(center_y + radii * np.sin(angles)).astype(int)
            good = (xs >= 0) & (xs < width) & (ys >= 0) & (ys < height)
            unwrapped = np.full((140, 900), 255, dtype=np.uint8)
            unwrapped[good] = array[ys[good], xs[good]]
            yield ImageOps.autocontrast(Image.fromarray(unwrapped))


def recognition_tensor(image):
    image = ImageOps.expand(image, border=4, fill=255).convert('RGB')
    width = max(16, min(MAX_RECOGNITION_WIDTH, round(image.width / image.height * 48)))
    image = image.resize((width, 48), Image.Resampling.BICUBIC)
    return (np.asarray(image).astype(np.float32) / 127.5 - 1).transpose(2, 0, 1)[None, :, :, :]
