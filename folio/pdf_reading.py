import base64
from html import escape
from io import BytesIO
import re
from statistics import median


def _inside(x,y,box):
    return box[0]<=x<=box[2] and box[1]<=y<=box[3]


def classify_page(page):
    reasons=[]
    if page.rotation:reasons.append('旋转页面')
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
    # Adjacent small glyphs raised above a main baseline are unsafe to flatten.
    for row in rows.values():
        row.sort(key=lambda w:w['x0'])
        for a,b in zip(row,row[1:]):
            ha,hb=a['bottom']-a['top'],b['bottom']-b['top']
            if 0<=b['x0']-a['x1']<8 and min(ha,hb)<max(ha,hb)*.72 and abs(a['bottom']-b['bottom'])>3:
                reasons.append('上下标布局');break
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
