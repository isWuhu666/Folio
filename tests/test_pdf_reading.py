import unittest
from folio.pdf_converter import convert_pdf
from folio.pdf_reading import classify_page
from pdf_fixtures import make_pdf


class PdfReadingTests(unittest.TestCase):
    def test_simple_text_table_and_original_page(self):
        simple=convert_pdf(make_pdf(),mode='reading')
        self.assertIn('<h2',simple['bodyHtml']);self.assertIn('<p>',simple['bodyHtml'])
        self.assertIn('<details',simple['bodyHtml']);self.assertIn('searchable',simple['bodyHtml'])
        table=convert_pdf(make_pdf('table'),mode='reading')
        self.assertIn('<table>',table['bodyHtml']);self.assertIn('3.3 V',table['bodyHtml'])
        self.assertEqual(table['bodyHtml'].split('<details')[0].count('Voltage'),1)

    def test_complex_and_scanned_pages_fall_back(self):
        for kind in ['scan','columns','math','rotated','cropped','superscript']:
            with self.subTest(kind=kind):
                r=convert_pdf(make_pdf(kind),mode='reading')
                self.assertIn('<img',r['bodyHtml'])
                self.assertTrue(any(d['code']=='reading-fallback' for d in r['diagnostics']))


if __name__=='__main__':unittest.main()
