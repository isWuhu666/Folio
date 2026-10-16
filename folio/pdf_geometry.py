import math


def standard_page_box(page,rendered_size=None):
    """Only enable coordinate-dependent output for a known shared coordinate space."""
    media=tuple(float(v) for v in page.mediabox)
    crop=tuple(float(v) for v in page.cropbox)
    if not all(math.isfinite(v) for v in (*media,*crop)):return False
    if any(abs(a-b)>.01 for a,b in zip(media,crop)):return False
    if abs(media[0])>.01 or abs(media[1])>.01:return False
    if float(page.page_obj.attrs.get('UserUnit',1))!=1:return False
    if rendered_size and (abs(page.width-rendered_size[0])>.01 or abs(page.height-rendered_size[1])>.01):return False
    return True
