# Sky texture

`milky-way-gaia-4k.webp` (4096×2048) and `milky-way-gaia-8k.webp`
(8192×4096) derive from `milkyway_2020_8k_gal.exr` in
[Deep Star Maps 2020, NASA SVS item 4851](https://svs.gsfc.nasa.gov/4851/).

Credit: NASA/Goddard Space Flight Center Scientific Visualization Studio.
Gaia DR2: ESA/Gaia/DPAC. Visualization: Ernie Wright (USRA).
The Milky Way layer omits the bright Hipparcos and Tycho foreground stars.
No constellation figures or boundaries are used.

The source is native 8192×4096. Packaging converts linear Rec.709 RGB to sRGB,
encodes WebP at quality 92 and derives the 4096×2048 variant by downsampling.
No image is upscaled. The application applies grayscale, contrast and diagonal
rotation in CSS. The animated foreground stars are rendered separately.

Source file:
- https://svs.gsfc.nasa.gov/vis/a000000/a004800/a004851/milkyway_2020_8k_gal.exr

[NASA media usage guidelines](https://www.nasa.gov/nasa-brand-center/images-and-media/)
apply. No NASA logo is used.
