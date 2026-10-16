import base64
from html import escape
from io import BytesIO
import math

import pdfplumber
import pypdfium2 as pdfium

from .limits import MAX_PDF_BYTES, MAX_PAGES


class ConversionError(ValueError):
    def __init__(self,message,status=400):
        super().__init__(message)
        self.status=status


def render_faithful_page(pdfium_page,plumber_page,dpi,page_number):
    width,height=pdfium_page.get_size()
    if width*height*(dpi/72)**2>20_000_000:
        raise ConversionError('单页尺寸过大，请降低分辨率或裁切页面。',413)
    bitmap=pdfium_page.render(scale=dpi/72)
    try:image=bitmap.to_pil().copy()
    finally:bitmap.close()
    stream=BytesIO();image.save(stream,format='PNG')
    data_url='data:image/png;base64,'+base64.b64encode(stream.getvalue()).decode('ascii')
    diagnostics=[];spans=[]
    if plumber_page.rotation:
        diagnostics.append({'code':'text-layer-skipped','page':page_number,'message':f'第 {page_number} 页有旋转，保留原页外观并关闭定位不可靠的文字层。'})
    elif plumber_page.chars:
        for word in plumber_page.extract_words(extra_attrs=['size']):
            x,y=float(word['x0']),float(word['top']);size=float(word['size'])
            if not all(math.isfinite(v) for v in (x,y,size)) or size<=0:continue
            spans.append(f'<span style="left:{100*x/width:.4f}%;top:{100*y/height:.4f}%;font-size:{100*size/width:.4f}cqw">{escape(word["text"])}</span>')
    layer=f'<div class="pdf-text-layer" aria-label="可选择的页面文字">{"".join(spans)}</div>' if spans else ''
    html=f'<div class="pdf-page" style="width:{width:g}px;aspect-ratio:{width:g}/{height:g}"><img src="{data_url}" alt="第 {page_number} 页原文" loading="lazy">{layer}</div>'
    return {'html':html,'width':width,'height':height,'diagnostics':diagnostics,'_image':image}


def convert_pdf(data,mode='faithful',dpi=144):
    if mode not in ('faithful','reading'):raise ConversionError('请选择保真或阅读模式。')
    if dpi not in (96,144,192):raise ConversionError('分辨率仅支持 96、144 或 192 DPI。')
    if len(data)>MAX_PDF_BYTES:raise ConversionError('PDF 超过 40 MiB，请拆分文档。',413)
    if not data.startswith(b'%PDF-'):raise ConversionError('文件不是有效的 PDF。')
    try:document=pdfium.PdfDocument(data)
    except pdfium.PdfiumError as exc:
        if 'password' in str(exc).lower():raise ConversionError('PDF 已加密，请先提供已解密的副本。') from None
        raise ConversionError('PDF 损坏或无法解析，请重新导出后再试。') from None
    try:
        count=len(document)
        if not count:raise ConversionError('PDF 没有可转换的页面。')
        if count>MAX_PAGES:raise ConversionError('PDF 超过 80 页，请拆分文档。',413)
        pages=[];parts=[];diagnostics=[];pixels=0
        with pdfplumber.open(BytesIO(data)) as source:
            title=str((source.metadata or {}).get('Title') or 'PDF 文档')[:200]
            for n in range(count):
                page=document[n]
                try:
                    w,h=page.get_size();pixels+=w*h*(dpi/72)**2
                    if pixels>160_000_000:raise ConversionError('渲染总量过大，请降低分辨率或拆分文档。',413)
                    result=render_faithful_page(page,source.pages[n],dpi,n+1)
                    try:
                        diagnostics.extend(result['diagnostics'])
                        if mode=='reading':
                            from .pdf_reading import reconstruct_page
                            reading=reconstruct_page(source.pages[n],result,n+1)
                            body=reading['html'];diagnostics.extend(reading['diagnostics'])
                        else:body=result['html']
                        parts.append(f'<section class="pdf-reading-page"><div class="pdf-page-label">PAGE {n+1:02d} / {count:02d}</div>{body}</section>')
                        pages.append({'number':n+1,'width':result['width'],'height':result['height']})
                    finally:result['_image'].close()
                    source.pages[n].close()
                finally:page.close()
        return {'title':title,'mode':mode,'pageCount':count,'bodyHtml':''.join(parts),'diagnostics':diagnostics,'pages':pages}
    except ConversionError:raise
    except Exception as exc:
        raise ConversionError('PDF 转换失败，可能含有不支持的内容或已损坏。请尝试重新导出文件。') from exc
    finally:document.close()
