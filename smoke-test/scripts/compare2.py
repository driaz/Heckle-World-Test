"""Usage: python3 scripts/compare2.py <run2-iter-name>
Writes shots/iter-<name>/compare3.jpg: reference | run 1 final | run 2, same framing."""
import sys, os
from PIL import Image, ImageDraw

it = sys.argv[1]
here = os.path.dirname(os.path.abspath(__file__))
ref = Image.open(os.path.join(here, '..', '..', 'reference', 'blockfield_direction.png')).convert('RGB')
run1 = Image.open(os.path.join(here, '..', 'shots', 'iter-8', 'ref.png')).convert('RGB')
run2 = Image.open(os.path.join(here, '..', 'shots', f'iter-{it}', 'ref.png')).convert('RGB')
s = 0.5
rw, rh = int(ref.width * s), int(ref.height * s)
out = Image.new('RGB', (rw * 3 + 12, rh + 26), 'white')
d = ImageDraw.Draw(out)
for k, (im, label) in enumerate(((ref, 'reference'), (run1, 'run 1 (Three.js + Meshy)'), (run2, 'run 2 (+ Blender bake)'))):
    out.paste(im.resize((rw, rh), Image.LANCZOS), (k * (rw + 6), 26))
    d.text((k * (rw + 6) + 6, 6), label, fill='black')
out.save(os.path.join(here, '..', 'shots', f'iter-{it}', 'compare3.jpg'), quality=88)
