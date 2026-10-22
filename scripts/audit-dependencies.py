"""Query public PyPI advisory metadata; never sends user documents or source."""
from datetime import datetime, timezone
from importlib.metadata import version
import json
from pathlib import Path
import sys
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parent.parent


def main():
    queries = []
    lines = []
    for requirements in ('requirements.txt', 'requirements-desktop.txt', 'requirements-build.txt'):
        lines.extend((ROOT / requirements).read_text(encoding='utf-8-sig').splitlines())
    for line in lines:
        if '==' not in line or line.startswith('#'):
            continue
        name, pinned = line.strip().split('==')
        installed = version(name)
        if installed != pinned:
            raise RuntimeError(f'{name}: installed {installed}, expected {pinned}; install requirements first')
        queries.append({'package': {'name': name, 'ecosystem': 'PyPI'}, 'version': installed})
    request = Request('https://api.osv.dev/v1/querybatch',
                      data=json.dumps({'queries': queries}).encode(),
                      headers={'Content-Type': 'application/json'})
    with urlopen(request, timeout=45) as response:
        result = json.load(response)
    if len(result.get('results', [])) != len(queries):
        raise RuntimeError('Incomplete advisory response; audit not passed')
    report = {'checkedAt': datetime.now(timezone.utc).isoformat(), 'source': 'https://api.osv.dev/v1/querybatch',
              'packages': [{**query, 'advisories': data.get('vulns', [])}
                           for query, data in zip(queries, result['results'])]}
    output = ROOT / 'artifacts' / 'python-dependency-audit-final.json'
    output.parent.mkdir(exist_ok=True)
    output.write_text(json.dumps(report, indent=2), encoding='utf-8')
    count = sum(len(package['advisories']) for package in report['packages'])
    print(f'Checked {len(queries)} installed packages; {count} advisory matches. Report: {output}')
    return 1 if count else 0


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except Exception as error:
        print(f'Audit could not complete: {error}', file=sys.stderr)
        raise SystemExit(2)
