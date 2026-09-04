"""Generate the NSIS installer branding bitmaps from the Amply logo.

Outputs (24-bit BMP, the format NSIS/MUI2 expects):
  src-tauri/installer/header.bmp   150 x 57   top-right header strip on every page
  src-tauri/installer/sidebar.bmp  164 x 314  welcome/finish page sidebar

Run: python scripts/installer-branding.py
"""
from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parent.parent
LOGO = ROOT / "src-tauri" / "icons" / "LogoAmply.png"
OUT = ROOT / "src-tauri" / "installer"

# Light theme tokens from src/index.css.
BG = (236, 232, 225)
BG_DEEP = (229, 224, 216)
TEXT = (35, 31, 27)
TEXT_SECONDARY = (84, 76, 67)
ACCENT = (235, 126, 35)
SHADOW_LIGHT = (255, 255, 255)
SHADOW_DARK = (163, 150, 132)


def font(size: int, weight: str = "semibold") -> ImageFont.FreeTypeFont:
    candidates = {
        "bold": ["segoeuib.ttf", "arialbd.ttf"],
        "semibold": ["seguisb.ttf", "segoeuib.ttf", "arialbd.ttf"],
        "regular": ["segoeui.ttf", "arial.ttf"],
    }[weight]
    for name in candidates:
        path = Path("C:/Windows/Fonts") / name
        if path.exists():
            return ImageFont.truetype(str(path), size)
    return ImageFont.load_default()


def neu_disc(canvas: Image.Image, center: tuple[int, int], radius: int) -> None:
    """Soft raised disc: light shadow up-left, dark shadow down-right, flat bg face."""
    cx, cy = center
    pad = radius + 24
    layer = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    draw.ellipse((cx - radius + 6, cy - radius + 6, cx + radius + 6, cy + radius + 6), fill=SHADOW_DARK + (110,))
    draw.ellipse((cx - radius - 6, cy - radius - 6, cx + radius - 6, cy + radius - 6), fill=SHADOW_LIGHT + (200,))
    layer = layer.filter(ImageFilter.GaussianBlur(9))
    canvas.alpha_composite(layer)
    face = ImageDraw.Draw(canvas)
    face.ellipse((cx - radius, cy - radius, cx + radius, cy + radius), fill=BG + (255,))
    del pad


def paste_logo(canvas: Image.Image, size: int, position: tuple[int, int]) -> None:
    logo = Image.open(LOGO).convert("RGBA").resize((size, size), Image.LANCZOS)
    canvas.alpha_composite(logo, position)


def header() -> Image.Image:
    w, h = 150, 57
    canvas = Image.new("RGBA", (w, h), BG + (255,))
    draw = ImageDraw.Draw(canvas)
    # Hairline at the bottom so the strip separates from the page body.
    draw.line((0, h - 1, w, h - 1), fill=BG_DEEP)
    paste_logo(canvas, 34, (12, (h - 34) // 2))
    wordmark = font(22, "bold")
    draw.text((54, h // 2), "Amply", font=wordmark, fill=TEXT, anchor="lm")
    return canvas


def sidebar() -> Image.Image:
    w, h = 164, 314
    canvas = Image.new("RGBA", (w, h), BG + (255,))
    neu_disc(canvas, (w // 2, 104), 54)
    paste_logo(canvas, 72, (w // 2 - 36, 104 - 36))
    draw = ImageDraw.Draw(canvas)
    draw.text((w // 2, 192), "Amply", font=font(28, "bold"), fill=TEXT, anchor="mm")
    draw.text((w // 2, 220), "Your music, offline.", font=font(12, "regular"), fill=TEXT_SECONDARY, anchor="mm")
    # Accent pill, echoing the in-app primary button.
    draw.rounded_rectangle((w // 2 - 18, 246, w // 2 + 18, 252), radius=3, fill=ACCENT)
    return canvas


def save_bmp(image: Image.Image, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    image.convert("RGB").save(path, format="BMP")
    image.convert("RGB").save(path.with_suffix(".preview.png"), format="PNG")


if __name__ == "__main__":
    save_bmp(header(), OUT / "header.bmp")
    save_bmp(sidebar(), OUT / "sidebar.bmp")
    print("wrote", OUT / "header.bmp", "and", OUT / "sidebar.bmp")
