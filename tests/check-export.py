"""Validate the export made by app-regression.cjs; uses synthetic records only."""
import base64
import csv
import io
import json
from pathlib import Path
import re
import sys
import zipfile

source=Path(sys.argv[1] if len(sys.argv)>1 else 'apk-build/verification/full/all-functions.zip')
with zipfile.ZipFile(source) as z:
    assert z.testzip() is None
    names=z.namelist()
    records=list(csv.DictReader(io.StringIO(z.read('清查表.csv').decode('utf-8-sig'))))
    boxes=list(csv.DictReader(io.StringIO(z.read('箱目录.csv').decode('utf-8-sig'))))
    assert len(records)==3 and len(boxes)==3
    assert len({r['清查号'] for r in records})==3
    assert {r['场景'] for r in records}=={'仓库开箱','馆内展柜','设备设施'}
    assert all(r['箱号'] in {b['箱号'] for b in boxes} for r in records)
    item=next(r for r in records if r['分类']=='equipment')
    assert item['数量']=='2' and item['账面价值(元)']=='1200.5'
    assert item['名称'].startswith("'=HYPERLINK")
    image_record=next(r for r in records if r['照片文件'])
    assert image_record['照片文件'] in names
    assert image_record['清查号'] in image_record['照片文件']
    assert image_record['扫描文件'] in names
    assert image_record['体积(mm³)']==''
    embedded=re.search(r'data:image/jpeg;base64,([^"\s]+)',z.read('清查表.xls').decode()).group(1)
    assert base64.b64decode(embedded)==z.read(image_record['照片文件'])
    assert len(base64.b64decode(embedded))<5*1024*1024
    assert all(b['登记人']=='测试员' for b in boxes)
    result={'zipIntegrity':True,'threeScenes':True,'boxMetadata':True,'quantityAndValue':True,'csvFormulaEscaped':True,'photoIdentity':True,'scanAttachment':True,'noFabricatedVolume':True}
    (source.parent/'export-checks.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
print('PASS: export integrity, 3 scenes, box metadata, quantity/value, photo identity, scan attachment, CSV escaping')
