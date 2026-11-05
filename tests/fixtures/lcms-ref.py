# Referenzwerte für kw-core color (architecture.md §10, 3f): Little CMS über Pillow ImageCms, unabhängig von kw-core.
# Volle Rechenkette ohne 8-bit-Vorberechnung (NOOPTIMIZE), Tiefenkompensierung an wie in kw-core.
# Aufruf: ~/.local/bin/uv run --no-project --with pillow python tests/fixtures/lcms-ref.py > tests/fixtures/color-ref.json
import itertools
import json

from PIL import Image, ImageCms

PROFILE = "/System/Library/ColorSync/Profiles/Generic CMYK Profile.icc"
INTENTS = ["perceptual", "relative", "saturation", "absolute"]
LEVELS = [0, 128, 255]
# Eigene Stichproben: Tiefschwarz, Hauttöne, Stencil-Violett, reine Sekundärfarben.
CMYK_EXTRA = [(153, 102, 102, 255), (0, 64, 89, 13), (20, 89, 128, 51), (179, 230, 0, 0), (255, 0, 255, 0)]
RGB_EXTRA = [(200, 150, 120), (90, 40, 160), (12, 12, 12), (240, 240, 240)]

cmyk = ImageCms.getOpenProfile(PROFILE)
srgb = ImageCms.createProfile("sRGB")
flags = ImageCms.Flags.NOOPTIMIZE | ImageCms.Flags.BLACKPOINTCOMPENSATION


def run(src, dst, src_mode, dst_mode, intent, values):
    t = ImageCms.buildTransform(src, dst, src_mode, dst_mode, renderingIntent=intent, flags=flags)
    img = Image.new(src_mode, (len(values), 1))
    img.putdata(values)
    return list(ImageCms.applyTransform(img, t).getdata())


cmyk_in = list(itertools.product(LEVELS, repeat=4)) + CMYK_EXTRA
rgb_in = list(itertools.product(LEVELS, repeat=3)) + RGB_EXTRA
cases = []
for i, name in enumerate(INTENTS):
    for a, b in zip(cmyk_in, run(cmyk, srgb, "CMYK", "RGB", i, cmyk_in)):
        cases.append({"intent": name, "from": "cmyk", "in": list(a), "out": list(b)})
    for a, b in zip(rgb_in, run(srgb, cmyk, "RGB", "CMYK", i, rgb_in)):
        cases.append({"intent": name, "from": "rgb", "in": list(a), "out": list(b)})

print(json.dumps({"profile": PROFILE, "lcms": ImageCms.core.littlecms_version, "cases": cases}, separators=(",", ":")))
