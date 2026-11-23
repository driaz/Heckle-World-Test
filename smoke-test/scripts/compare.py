"""Usage: python3 scripts/compare.py <iter-number>
Writes shots/iter-N/compare.jpg (reference on top, render below) and overlay.jpg (50/50 blend)."""
import sys, os
from PIL import Image

it = sys.argv[1]
here = os.path.dirname(os.path.abspath(__file__))
ref = Image.open(os.path.join(here, '..', '..', 'reference', 'blockfield_direction.png')).convert('RGB')
shot = Image.open(os.path.join(here, '..', 'shots', f'iter-{it}', 'ref.png')).convert('RGB').resize(ref.size)
w, h = ref.size
s = 0.6
rw, rh = int(w * s), int(h * s)
side = Image.new('RGB', (rw, rh * 2 + 6), 'white')
side.paste(ref.resize((rw, rh)), (0, 0))
side.paste(shot.resize((rw, rh)), (0, rh + 6))
side.save(os.path.join(here, '..', 'shots', f'iter-{it}', 'compare.jpg'), quality=88)
Image.blend(ref, shot, 0.5).resize((rw, rh)).save(os.path.join(here, '..', 'shots', f'iter-{it}', 'overlay.jpg'), quality=85)
