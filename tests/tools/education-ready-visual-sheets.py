"""Read-only contact sheets of retained QA screenshots; originals are never edited."""
import hashlib
import json
import sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

root = Path.cwd()
output = root / 'output/education-ready/06' / (sys.argv[1] if len(sys.argv) > 1 else 'history-review')
output.mkdir(parents=True, exist_ok=True)
sources = [Path(item) for item in sys.argv[2:]] if len(sys.argv) > 2 else [root / 'output/education-ready', Path('C:/Users/Plotva/.codex/worktrees/education-full-qa-20261003/EventGenix/output')]
files = sorted(p for source in sources for p in source.rglob('*.png') if len(sys.argv) > 2 or '/06/' not in p.as_posix())
font = ImageFont.truetype('C:/Windows/Fonts/arial.ttf', 12)
manifest = []
for start in range(0, len(files), 20):
    sheet = Image.new('RGB', (1600, 1550), '#e2e8f0')
    draw = ImageDraw.Draw(sheet)
    for offset, file in enumerate(files[start:start+20]):
        index = start + offset + 1
        x, y = (offset % 4) * 400, (offset // 4) * 310
        with Image.open(file) as original:
            thumbnail = original.convert('RGB')
            thumbnail.thumbnail((392, 270))
            sheet.paste(thumbnail, (x + 4, y + 4))
            dimensions = original.size
        label = f'{index:03d} {file.name}'
        draw.text((x + 5, y + 277), label[:61], font=font, fill='#0f172a')
        draw.text((x + 5, y + 292), str(file.parent.name)[:61], font=font, fill='#334155')
        manifest.append({'index': index, 'path': file.as_posix(), 'dimensions': dimensions,
                         'sha256': hashlib.sha256(file.read_bytes()).hexdigest(), 'sheet': f'sheet-{start//20+1:02d}.png'})
    sheet.save(output / f'sheet-{start//20+1:02d}.png')
(output / 'manifest.json').write_text(json.dumps({'count': len(files), 'screenshots': manifest}, indent=2), encoding='utf-8')
print(f'Read-only history sheets: {len(files)} screenshots, {(len(files)+19)//20} sheets')
