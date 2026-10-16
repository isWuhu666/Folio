"""Small PDF fixtures generated locally without external documents."""
from io import BytesIO
from PIL import Image, ImageDraw


def make_pdf(kind='simple', pages=1):
    objects = [b'', b'', b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
               b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>',
               b'<< /Type /Font /Subtype /Type1 /BaseFont /Symbol >>']
    page_ids = []
    for n in range(pages):
        width, height = (480, 360) if kind == 'mixed' and n % 2 else (360, 480)
        image_ref = ''
        if kind == 'scan':
            im = Image.new('RGB', (360, 480), 'white')
            ImageDraw.Draw(im).text((30, 30), 'Scanned document 123', fill='black')
            stream = BytesIO(); im.save(stream, format='JPEG'); raw = stream.getvalue()
            objects.append(b'<< /Type /XObject /Subtype /Image /Width 360 /Height 480 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + str(len(raw)).encode() + b' >>\nstream\n' + raw + b'\nendstream')
            image_ref = f'/XObject << /Im1 {len(objects)} 0 R >>'
            content = b'q 360 0 0 480 0 0 cm /Im1 Do Q'
        else:
            content = b'BT /F2 24 Tf 30 430 Td (Engineering notes) Tj ET\nBT /F1 12 Tf 30 390 Td (A clear paragraph with searchable text.) Tj 0 -20 Td (Second line of the same document.) Tj ET\n'
            if kind == 'table':
                content += b'30 250 m 330 250 l 330 340 l 30 340 l h S 30 310 m 330 310 l S 30 280 m 330 280 l S 180 250 m 180 340 l S\n'
                for x,y,text in [(40,320,'Name'),(190,320,'Value'),(40,290,'Voltage'),(190,290,'3.3 V'),(40,260,'Current'),(190,260,'10 mA')]:
                    content += f'BT /F1 12 Tf {x} {y} Td ({text}) Tj ET\n'.encode()
            if kind == 'math':
                content += b'BT /F3 22 Tf 40 300 Td (S) Tj ET BT /F1 10 Tf 55 315 Td (2) Tj ET\n'
            if kind == 'columns':
                for y in range(330, 130, -20):
                    content += f'BT /F1 10 Tf 30 {y} Td (Left column) Tj ET BT /F1 10 Tf 210 {y} Td (Right column) Tj ET\n'.encode()
        objects.append(b'<< /Length ' + str(len(content)).encode() + b' >>\nstream\n' + content + b'\nendstream')
        stream_id = len(objects)
        rotation = '/Rotate 90' if kind == 'rotated' else ''
        objects.append(f'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {width} {height}] {rotation} /Resources << /Font << /F1 3 0 R /F2 4 0 R /F3 5 0 R >> {image_ref} >> /Contents {stream_id} 0 R >>'.encode())
        page_ids.append(len(objects))
    objects[0] = b'<< /Type /Catalog /Pages 2 0 R >>'
    objects[1] = f'<< /Type /Pages /Kids [{" ".join(f"{i} 0 R" for i in page_ids)}] /Count {pages} >>'.encode()
    out = bytearray(b'%PDF-1.4\n%\xe2\xe3\xcf\xd3\n'); offsets=[0]
    for i,obj in enumerate(objects,1):
        offsets.append(len(out)); out.extend(f'{i} 0 obj\n'.encode()+obj+b'\nendobj\n')
    xref=len(out);out.extend(f'xref\n0 {len(objects)+1}\n0000000000 65535 f \n'.encode())
    for offset in offsets[1:]:out.extend(f'{offset:010} 00000 n \n'.encode())
    out.extend(f'trailer\n<< /Size {len(objects)+1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF'.encode())
    return bytes(out)
