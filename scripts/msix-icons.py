"""Builds the MSIX icon set in src-tauri/icons/msix from src-tauri/icons/512x512.png.

Windows draws a packaged app's taskbar, Start and Alt+Tab icon from Square44x44Logo. Without the
"targetsize-N_altform-unplated" variants it falls back to the plated icon: the logo shrunk onto a
coloured square. package-msix.ps1 copies this folder and indexes it with makepri.

    python scripts/msix-icons.py
"""

from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "src-tauri" / "icons" / "512x512.png"
OUT = ROOT / "src-tauri" / "icons" / "msix"

TARGET_SIZES = [16, 20, 24, 30, 32, 36, 40, 48, 60, 64, 72, 80, 96, 256]
SCALES = [100, 125, 150, 200, 400]
TILES = {"Square44x44Logo": 44, "Square71x71Logo": 71, "Square150x150Logo": 150, "StoreLogo": 50}


def main() -> None:
    logo = Image.open(SOURCE).convert("RGBA")
    OUT.mkdir(parents=True, exist_ok=True)
    for old in OUT.glob("*.png"):
        old.unlink()

    def save(size: int, name: str) -> None:
        logo.resize((size, size), Image.LANCZOS).save(OUT / name, optimize=True)

    for name, base in TILES.items():
        save(base, f"{name}.png")
        for scale in SCALES:
            save(round(base * scale / 100), f"{name}.scale-{scale}.png")
    for size in TARGET_SIZES:
        save(size, f"Square44x44Logo.targetsize-{size}.png")
        save(size, f"Square44x44Logo.targetsize-{size}_altform-unplated.png")
        save(size, f"Square44x44Logo.targetsize-{size}_altform-lightunplated.png")
    print(f"{len(list(OUT.glob('*.png')))} icons in {OUT}")


if __name__ == "__main__":
    main()
