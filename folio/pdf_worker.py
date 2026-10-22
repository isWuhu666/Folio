import json
import sys
from .pdf_converter import convert_pdf, ConversionError


def report_progress(event):
    sys.stderr.write(json.dumps(event,separators=(',',':'))+'\n')
    sys.stderr.flush()


def main():
    try:
        from .worker_limits import apply_worker_limits
        apply_worker_limits()
        from .limits import MAX_PDF_BYTES
        data=sys.stdin.buffer.read(MAX_PDF_BYTES+1)
        result=convert_pdf(data,sys.argv[1],int(sys.argv[2]),pages=sys.argv[3] if len(sys.argv)>3 else None,progress=report_progress)
        result={'result':result}
    except ConversionError as exc:result={'error':str(exc),'status':exc.status}
    except MemoryError:result={'error':'PDF 解析超过 1.5 GiB 内存上限，请降低分辨率或拆分文件。','status':413}
    except Exception:result={'error':'PDF 工作进程未能完成转换。','status':500}
    sys.stdout.buffer.write(json.dumps(result,ensure_ascii=False).encode('utf-8'))


if __name__=='__main__':main()
