"""Inspect only the dedicated Folio emulator. No production debugging bridge."""
import argparse
import json
from pathlib import Path
import re
import subprocess
import xml.etree.ElementTree as ET

ROOT=Path(__file__).resolve().parent.parent
ADB=ROOT.parent/'.tools/android-sdk/platform-tools/adb.exe'
SERIAL='emulator-5560'

def adb(*args):
    result=subprocess.run([str(ADB),'-s',SERIAL,*args],stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=30)
    if result.returncode:raise RuntimeError(result.stderr.decode('utf-8','replace'))
    return result.stdout

def nodes():
    adb('shell','uiautomator','dump','/data/local/tmp/folio-ui.xml')
    value=adb('exec-out','cat','/data/local/tmp/folio-ui.xml')
    (ROOT/'artifacts/android-ui.xml').write_bytes(value)
    return list(ET.fromstring(value).iter('node'))

def main():
    parser=argparse.ArgumentParser();parser.add_argument('action',choices=['inspect','tap','screenshot']);parser.add_argument('value',nargs='?',default='android-runtime.png');args=parser.parse_args()
    if adb('emu','avd','name').decode('utf-8','replace').splitlines()[0].strip()!='FolioSmoke':
        raise RuntimeError('Refusing to operate on a device other than the dedicated FolioSmoke AVD')
    if args.action=='inspect':
        print(json.dumps([{k:n.get(k) for k in ('text','content-desc','class','resource-id','bounds','clickable')} for n in nodes() if n.get('text') or n.get('content-desc')],ensure_ascii=True))
    elif args.action=='tap':
        targets=[n for n in nodes() if args.value in (n.get('text',''),n.get('content-desc',''))]
        if not targets:targets=[n for n in nodes() if args.value in (n.get('text','')+' '+n.get('content-desc',''))]
        visible=[]
        for target in targets:
            coords=list(map(int,re.findall(r'\d+',target.get('bounds',''))))
            if len(coords)==4 and coords[2]>coords[0] and coords[3]>coords[1]:visible.append((target,coords))
        if not visible:raise RuntimeError('UI target missing or offscreen: '+args.value)
        target,coords=visible[0];x=(coords[0]+coords[2])//2;y=(coords[1]+coords[3])//2;adb('shell','input','tap',str(x),str(y));print('Tapped '+json.dumps(args.value,ensure_ascii=True))
    else:
        output=(ROOT/'artifacts'/Path(args.value).name);output.write_bytes(adb('exec-out','screencap','-p'));print(str(output))

if __name__=='__main__':main()
