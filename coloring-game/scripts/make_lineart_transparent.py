from pathlib import Path
from PIL import Image


PROJECT_ROOT = Path(__file__).resolve().parents[1]
SOURCE = PROJECT_ROOT / 'public' / 'ling-ling-lineart.png'
TARGET = PROJECT_ROOT / 'public' / 'ling-ling-lineart-transparent.png'
INK = (45, 42, 38)


def main():
  source = Image.open(SOURCE).convert('RGB')
  output = Image.new('RGBA', source.size)
  pixels = []
  for red, green, blue in source.getdata():
    luminance = (red * 0.2126) + (green * 0.7152) + (blue * 0.0722)
    alpha = max(0, min(255, round((255 - luminance) * 1.35)))
    pixels.append((*INK, alpha))
  output.putdata(pixels)
  output.save(TARGET)
  print(f'created {TARGET}')


if __name__ == '__main__':
  main()
