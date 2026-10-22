from html.parser import HTMLParser
from io import BytesIO
import unittest

import pdfplumber

from folio.pdf_converter import convert_pdf
from pdf_direction_fixtures import directional_pdf


class TextContent(HTMLParser):
    def __init__(self, html):
        super().__init__()
        self.text = []
        self.feed(html)

    def handle_data(self, data):
        self.text.append(data)


class PdfDirectionTests(unittest.TestCase):
    def test_sideways_text_falls_back_without_corrupt_body_or_selection(self):
        data = directional_pdf()
        with pdfplumber.open(BytesIO(data)) as source:
            self.assertEqual(source.pages[0].rotation, 0)
            self.assertEqual(''.join(c['text'] for c in source.pages[0].chars[-9:]), 'Side note')
        for mode in ('reading', 'faithful'):
            with self.subTest(mode=mode):
                result = convert_pdf(data, mode=mode, dpi=96)
                html = result['bodyHtml']
                diagnostics = {d['code']: d['message'] for d in result['diagnostics']}
                self.assertIn('text-layer-skipped', diagnostics)
                self.assertIn('文字方向', diagnostics['text-layer-skipped'])
                self.assertNotIn('class="pdf-text-layer"', html)
                self.assertNotIn('eton', ''.join(TextContent(html).text))
                if mode == 'reading':
                    self.assertIn('reading-fallback', diagnostics)
                    self.assertIn('文字方向', diagnostics['reading-fallback'])
                    self.assertNotIn('<details', html)
                    self.assertNotIn('First plain line.', html)

    def test_even_one_rotated_or_reversed_glyph_disables_horizontal_output(self):
        for matrix in ('0 1 -1 0', '-1 0 0 -1', '0 -1 1 0', '.866 .5 -.5 .866',
                       '.999848 .017452 -.017452 .999848', '1 0 0 -1'):
            with self.subTest(matrix=matrix):
                result = convert_pdf(directional_pdf(matrix, 'X'), mode='reading', dpi=96)
                self.assertEqual({d['code'] for d in result['diagnostics']},
                                 {'reading-fallback', 'text-layer-skipped'})
                self.assertNotIn('class="pdf-text-layer"', result['bodyHtml'])

    def test_normal_scaling_slant_and_roundoff_preserve_searchable_reading(self):
        for matrix in ('1 0 0 1', '1 0 .25 1', '1.2 0 0 .8',
                       '1 .0000001 -.0000001 1'):
            with self.subTest(matrix=matrix):
                result = convert_pdf(directional_pdf(matrix), mode='reading', dpi=96)
                self.assertEqual(result['diagnostics'], [])
                body, original = result['bodyHtml'].split('<details', 1)
                self.assertIn('Side note', body)
                self.assertIn('class="pdf-text-layer"', original)


if __name__ == '__main__':
    unittest.main()
