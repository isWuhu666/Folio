"""Regenerate the small PDF parser examples. No external document is used."""
from pathlib import Path
import sys

ROOT=Path(__file__).resolve().parent.parent
sys.path.insert(0,str(ROOT/'tests'))
from pdf_fixtures import make_pdf

for kind in ['simple','table','scan','columns','rotated','math']:
    (ROOT/'examples'/f'{kind}.pdf').write_bytes(make_pdf(kind))
print('Generated six local PDF examples in examples/.')
