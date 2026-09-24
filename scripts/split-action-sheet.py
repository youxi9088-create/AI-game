"""Split a declared regular 3x2 sheet, never an irregular reference board.
Output cells require visual review before publication.
"""
import json
import sys
from pathlib import Path
from PIL import Image

source = Path(sys.argv[1])
image = Image.open(source).convert('RGBA')
width, height = image.size
if width < 300 or height < 200:
    raise ValueError('Action sheet is too small for five runtime images')
outputs = {}
for index in range(5):
    x, y = index % 3, index // 3
    box = (round(x * width / 3), round(y * height / 2), round((x + 1) * width / 3), round((y + 1) * height / 2))
    target = source.with_name(f'{source.stem}-A0{index + 1}.png')
    image.crop(box).save(target)
    outputs[f'A0{index + 1}'] = {'file': target.name, 'sourceRect': list(box)}
print(json.dumps(outputs))
