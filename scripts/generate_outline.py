from pathlib import Path

from PIL import Image, ImageEnhance, ImageFilter, ImageOps


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'public' / 'ling-ling-garden.png'
OUTPUT = ROOT / 'public' / 'ling-ling-outline.png'


def main() -> None:
    image = Image.open(SOURCE).convert('RGB')
    # 先降噪再取边缘，尽量保住画中的人物、狗、草地和手写文字轮廓。
    smooth = image.filter(ImageFilter.GaussianBlur(radius=3.5))
    gray = ImageOps.grayscale(smooth)
    edges = gray.filter(ImageFilter.FIND_EDGES)
    edges = ImageEnhance.Contrast(edges).enhance(3.4)
    line_art = edges.point(lambda value: 55 if value > 12 else 255)
    line_art.save(OUTPUT, optimize=True)


if __name__ == '__main__':
    main()
