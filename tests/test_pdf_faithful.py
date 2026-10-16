import base64
from io import BytesIO
import re
import unittest
from pathlib import Path
from PIL import Image
from folio.pdf_converter import convert_pdf, ConversionError
from pdf_fixtures import make_pdf


class PdfFaithfulTests(unittest.TestCase):
    def test_dpi_dimensions_and_searchable_text(self):
        for dpi, dimensions in [(96,(480,640)),(144,(720,960)),(192,(960,1280))]:
            r=convert_pdf(make_pdf(),dpi=dpi)
            image=re.search(r'data:image/png;base64,([^" ]+)',r['bodyHtml']).group(1)
            self.assertEqual(Image.open(BytesIO(base64.b64decode(image))).size,dimensions)
            self.assertIn('searchable',r['bodyHtml'])
            self.assertEqual(r['pageCount'],1)

    def test_scan_rotation_and_mixed_dimensions(self):
        scan=convert_pdf(make_pdf('scan'))
        self.assertIn('<img',scan['bodyHtml'])
        rotated=convert_pdf(make_pdf('rotated'))
        self.assertEqual((rotated['pages'][0]['width'],rotated['pages'][0]['height']),(480,360))
        self.assertTrue(any(d['code']=='text-layer-skipped' for d in rotated['diagnostics']))
        mixed=convert_pdf(make_pdf('mixed',2))
        self.assertEqual([(p['width'],p['height']) for p in mixed['pages']],[(360,480),(480,360)])

    def test_limits_and_invalid_input(self):
        for data,kwargs in [(b'not a PDF',{}),(b'%PDF broken',{}),(make_pdf(),{'dpi':72}),(make_pdf(),{'mode':'invalid'}),(make_pdf(pages=81),{})]:
            with self.subTest(kwargs=kwargs),self.assertRaises(ConversionError):convert_pdf(data,**kwargs)

    def test_encrypted_pdf_has_actionable_error(self):
        encrypted=Path(__file__).parent/'fixtures'/'encrypted.pdf'
        with self.assertRaisesRegex(ConversionError,'加密'):
            convert_pdf(encrypted.read_bytes())


if __name__=='__main__':unittest.main()
