import json
import sys
from .pdf_converter import convert_pdf, ConversionError


def main():
    try:
        from .limits import MAX_PDF_BYTES
        data=sys.stdin.buffer.read(MAX_PDF_BYTES+1)
        result=convert_pdf(data,sys.argv[1],int(sys.argv[2]))
        result={'result':result}
    except ConversionError as exc:result={'error':str(exc),'status':exc.status}
    except Exception:result={'error':'PDF 工作进程未能完成转换。','status':500}
    sys.stdout.buffer.write(json.dumps(result,ensure_ascii=False).encode('utf-8'))


if __name__=='__main__':main()
