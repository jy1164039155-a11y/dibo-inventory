"""Run from the Android project root; never reads inventory records or bundles keys."""
import hashlib
import json
from pathlib import Path
import re
import shutil
import sys

mode, tag, repository = sys.argv[1:]
match = re.fullmatch(r'v(\d+)\.(\d+)\.(\d+)', tag)
if not match or not re.fullmatch(r'[\w.-]+/[\w.-]+', repository):
    raise SystemExit('Expected tag vMAJOR.MINOR.PATCH and owner/repository')
major, minor, patch = map(int, match.groups())
if minor >= 100 or patch >= 100 or major > 200000:
    raise SystemExit('Version segments exceed the versionCode encoding limits')
code = major * 10000 + minor * 100 + patch
if mode == 'prepare':
    Path('release.env').write_text(f'VERSION_NAME={tag[1:]}\nVERSION_CODE={code}\n', encoding='utf-8')
elif mode == 'package':
    out = Path('dist')
    out.mkdir(exist_ok=True)
    apk = out / 'dibo-inventory.apk'
    shutil.copyfile('app/build/outputs/apk/release/app-release.apk', apk)
    digest = hashlib.sha256(apk.read_bytes()).hexdigest()
    manifest = {
        'applicationId': 'cn.hunanmuseum.inventory', 'versionCode': code,
        'versionName': tag[1:], 'apkUrl': f'https://github.com/{repository}/releases/download/{tag}/dibo-inventory.apk',
        'sha256': digest, 'notes': '请先导出清查包备份，再确认覆盖安装；不要卸载旧版。',
    }
    (out / 'version.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')
    (out / 'SHA256SUMS.txt').write_text(f'{digest}  dibo-inventory.apk\n', encoding='utf-8')
else:
    raise SystemExit('Mode must be prepare or package')
