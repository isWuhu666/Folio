import base64
from html import escape
from io import BytesIO
import re
from bisect import bisect_left, bisect_right
from statistics import median
from .pdf_geometry import standard_page_box


def _inside(x,y,box):
    return box[0]<=x<=box[2] and box[1]<=y<=box[3]


def classify_page(page):
    reasons=[]
    if page.rotation:reasons.append('旋转页面')
    if not standard_page_box(page):reasons.append('裁切或页面坐标变换')
    if len(page.chars)<20:reasons.append('扫描页或缺少可提取的文字')
    if any(re.search(r'symbol|cmmi|cmsy|cmex|math',c.get('fontname',''),re.I) for c in page.chars):
        reasons.append('数学符号或专用公式字体')
    if any(c.get('text','') in '∫∑∏√∂∇∞' for c in page.chars):reasons.append('复杂数学符号')
    if page.curves or any(abs(l['x1']-l['x0'])>1 and abs(l['bottom']-l['top'])>1 for l in page.lines):
        reasons.append('无法可靠重建的矢量图形')
    tables=page.find_tables();boxes=[t.bbox for t in tables]
    if any(any(cell is None for cell in row) for t in tables for row in t.extract()):
        reasons.append('合并单元格或不完整表格')
    words=page.extract_words();rows={}
    for w in words:
        if any(_inside((w['x0']+w['x1'])/2,(w['top']+w['bottom'])/2,b) for b in boxes):continue
        rows.setdefault(round(w['top']/4),[]).append(w)
    separated=0
    for row in rows.values():
        row.sort(key=lambda w:w['x0'])
        if any(b['x0']-a['x1']>page.width*.16 for a,b in zip(row,row[1:])):separated+=1
    if separated>=3:reasons.append('多栏或分离的阅读顺序')
    # A raised/lowered small glyph is normally in a DIFFERENT top-coordinate row.
    # Search horizontal neighbours across vertically overlapping intervals instead.
    ordered=sorted(words,key=lambda w:w['x0']);starts=[w['x0'] for w in ordered]
    for a in ordered:
        ha=a['bottom']-a['top']
        if ha<=0 or a['x1']-a['x0']<=.1:continue
        lo=bisect_left(starts,a['x1']-2);hi=bisect_right(starts,a['x1']+max(8,ha*.65))
        for b in ordered[lo:hi]:
            hb=b['bottom']-b['top']
            nearby=b['bottom']>=a['top']-ha*.25 and b['top']<=a['bottom']+ha*.25
            if b is not a and 0<hb<ha*.78 and nearby and abs(a['bottom']-b['bottom'])>2:
                reasons.append('上下标布局');break
        if '上下标布局' in reasons:break
    return {'safe':not reasons,'reasons':list(dict.fromkeys(reasons))}


def reconstruct_page(page,page_image,page_number):
    classification=classify_page(page)
    if not classification['safe']:
        reason='、'.join(classification['reasons'])
        message=f'第 {page_number} 页因{reason}使用保真页，保留原始公式、图形与阅读顺序。'
        return {'html':f'<p class="page-notice">{escape(message)}</p>'+page_image['html'],
                'diagnostics':[{'code':'reading-fallback','page':page_number,'message':message}],'used_fallback':True}
    tables=page.find_tables();boxes=[t.bbox for t in tables]
    body_size=median(c['size'] for c in page.chars) if page.chars else 12
    blocks=[]
    for table in tables:
        rows=table.extract();head=rows[0];body=rows[1:]
        cells=lambda row,tag:''.join(f'<{tag}>{escape(str(cell or ""))}</{tag}>' for cell in row)
        html=f'<table><thead><tr>{cells(head,"th")}</tr></thead><tbody>'+''.join(f'<tr>{cells(row,"td")}</tr>' for row in body)+'</tbody></table>'
        blocks.append((table.bbox[1],html))
    paragraphs=[];current=[];previous=None
    def flush():
        if current:
            paragraphs.append((current[0]['top'],'<p>'+escape(' '.join(l['text'] for l in current))+'</p>'));current.clear()
    for line in page.extract_text_lines():
        if any(_inside((line['x0']+line['x1'])/2,(line['top']+line['bottom'])/2,b) for b in boxes):continue
        size=median(c['size'] for c in line['chars'])
        if size>body_size*1.25:
            flush();paragraphs.append((line['top'],f'<h2>{escape(line["text"])}</h2>'));previous=None;continue
        if previous and (line['top']-previous['bottom']>body_size*.9 or abs(line['x0']-previous['x0'])>body_size*2):flush()
        current.append(line);previous=line
    flush();blocks.extend(paragraphs)
    im=page_image['_image']
    for i,img in enumerate(page.images,1):
        x0=max(0,img['x0']);y0=max(0,img['top']);x1=min(page.width,img['x1']);y1=min(page.height,img['bottom'])
        if x1<=x0 or y1<=y0:continue
        crop=im.crop((round(x0*im.width/page.width),round(y0*im.height/page.height),round(x1*im.width/page.width),round(y1*im.height/page.height)))
        try:stream=BytesIO();crop.save(stream,format='PNG')
        finally:crop.close()
        url='data:image/png;base64,'+base64.b64encode(stream.getvalue()).decode('ascii')
        blocks.append((y0,f'<figure><img src="{url}" alt="第 {page_number} 页插图 {i}"></figure>'))
    blocks.sort(key=lambda b:b[0])
    html=''.join(b[1] for b in blocks)
    html+=f'<details class="original-page"><summary>查看第 {page_number} 页原文</summary>{page_image["html"]}</details>'
    return {'html':html,'diagnostics':[],'used_fallback':False}
