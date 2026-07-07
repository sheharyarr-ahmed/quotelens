"""Regenerate the committed integration-run media fixtures.

Run from backend/:  uv run python tests/fixtures/generate_fixtures.py

Photos are Pillow-rendered scenes of the demo story (water-damaged bedroom,
SPEC.md - price book seed): simple but visually unambiguous, so the real
vision model produces stable observations. Audio is synthesized with macOS
`say` + `afconvert` (16kHz mono wav for faster-whisper). The narration
mirrors the seeded Painting book tasks plus one task deliberately absent
from the book ("replace the window blinds") to exercise the unpriced path.
"""

import pathlib
import subprocess

from PIL import Image, ImageDraw

HERE = pathlib.Path(__file__).parent

NARRATION = (
    "Okay, bedroom walk-through. This is the back bedroom, about twelve by "
    "fifteen feet. There was a roof leak over the winter, so we have a big "
    "water stain on the ceiling in the corner, and it runs partway down the "
    "wall. Plan is: treat the ceiling water stain, then stain-blocking primer "
    "on the stained wall area, call it about eighty square feet of primer. "
    "Then repaint all the walls, two coats, roughly three hundred and fifty "
    "square feet total. There's also a small drywall patch needed where the "
    "corner got soft, just one small patch. And the customer asked us to "
    "replace the window blinds while we're here, one set of blinds for the "
    "back window."
)


def _room_base(draw: ImageDraw.ImageDraw, w: int, h: int) -> None:
    """Beige wall, white ceiling plane, wood-ish floor strip, window."""
    draw.rectangle([0, 0, w, int(h * 0.18)], fill=(245, 244, 238))  # ceiling
    draw.rectangle([0, int(h * 0.18), w, int(h * 0.88)], fill=(214, 203, 178))  # wall
    draw.rectangle([0, int(h * 0.88), w, h], fill=(150, 111, 74))  # floor
    draw.line([0, int(h * 0.18), w, int(h * 0.18)], fill=(180, 175, 165), width=4)
    # window on the right
    draw.rectangle([int(w * 0.68), int(h * 0.30), int(w * 0.92), int(h * 0.66)],
                   fill=(200, 224, 240), outline=(120, 110, 95), width=8)
    draw.line([int(w * 0.80), int(h * 0.30), int(w * 0.80), int(h * 0.66)],
              fill=(120, 110, 95), width=6)


def photo_water_stain(path: pathlib.Path) -> None:
    w, h = 1024, 768
    img = Image.new("RGB", (w, h))
    draw = ImageDraw.Draw(img)
    _room_base(draw, w, h)
    # brown water stain spreading from ceiling corner down the wall
    for i, (dx, dy, rw, rh, col) in enumerate([
        (0.02, 0.02, 0.30, 0.14, (168, 128, 82)),
        (0.04, 0.05, 0.24, 0.16, (146, 105, 60)),
        (0.05, 0.14, 0.16, 0.22, (155, 116, 72)),
        (0.07, 0.18, 0.10, 0.24, (170, 133, 90)),
    ]):
        draw.ellipse(
            [int(w * dx), int(h * dy), int(w * (dx + rw)), int(h * (dy + rh))],
            fill=col,
        )
    # stain ring outlines make it read as water damage rather than paint
    draw.ellipse([int(w * 0.015), int(h * 0.015), int(w * 0.33), int(h * 0.17)],
                 outline=(120, 84, 45), width=5)
    draw.ellipse([int(w * 0.045), int(h * 0.13), int(w * 0.22), int(h * 0.38)],
                 outline=(126, 90, 52), width=4)
    img.save(path, "JPEG", quality=88)


def photo_scuffed_wall(path: pathlib.Path) -> None:
    w, h = 1024, 768
    img = Image.new("RGB", (w, h))
    draw = ImageDraw.Draw(img)
    _room_base(draw, w, h)
    # baseboard
    draw.rectangle([0, int(h * 0.84), w, int(h * 0.88)], fill=(235, 232, 224))
    # grey scuff marks and a cracked drywall patch low on the wall
    for x0, y0, x1, y1 in [
        (0.10, 0.70, 0.22, 0.74), (0.16, 0.76, 0.30, 0.79),
        (0.34, 0.72, 0.42, 0.76), (0.25, 0.66, 0.31, 0.69),
    ]:
        draw.ellipse([int(w * x0), int(h * y0), int(w * x1), int(h * y1)],
                     fill=(158, 152, 140))
    # crack lines
    draw.line([int(w * 0.48), int(h * 0.60), int(w * 0.52), int(h * 0.72),
               int(w * 0.50), int(h * 0.82)], fill=(110, 100, 88), width=5)
    draw.line([int(w * 0.52), int(h * 0.68), int(w * 0.57), int(h * 0.74)],
              fill=(110, 100, 88), width=4)
    img.save(path, "JPEG", quality=88)


def voice_note(path: pathlib.Path) -> None:
    aiff = path.with_suffix(".aiff")
    subprocess.run(["say", "-o", str(aiff), NARRATION], check=True)
    subprocess.run(
        ["afconvert", "-f", "WAVE", "-d", "LEI16@16000", "-c", "1",
         str(aiff), str(path)],
        check=True,
    )
    aiff.unlink()


if __name__ == "__main__":
    photo_water_stain(HERE / "photo-water-stain.jpg")
    photo_scuffed_wall(HERE / "photo-scuffed-wall.jpg")
    voice_note(HERE / "voice-note.wav")
    for name in ["photo-water-stain.jpg", "photo-scuffed-wall.jpg", "voice-note.wav"]:
        print(f"{name}: {(HERE / name).stat().st_size} bytes")
