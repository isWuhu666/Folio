import unittest
from folio.pdf_converter import convert_pdf, ConversionError
from pdf_fixtures import make_pdf

class PdfPageSelectionTests(unittest.TestCase):
    def test_selected_pages_keep_original_numbers_and_progress(self):
        progress=[]
        result=convert_pdf(make_pdf(pages=82),dpi=96,pages='2-3,82',progress=progress.append)
        self.assertEqual([p['number'] for p in result['pages']],[2,3,82])
        self.assertEqual(result['pageCount'],3)
        self.assertEqual(result['sourcePageCount'],82)
        self.assertEqual([p['completed'] for p in progress],[0,1,2,3])
        self.assertEqual(progress[-1]['total'],3)
    def test_invalid_or_excessive_selection(self):
        for pages in ['0','3-1','1,,2','1-999999999','4','1-81']:
            with self.subTest(pages=pages),self.assertRaises(ConversionError):
                convert_pdf(make_pdf(pages=3 if pages != '1-81' else 81),dpi=96,pages=pages)
