"""Check the records-regression.cjs export, including legacy and edited records."""
import csv
import io
from pathlib import Path
import zipfile

source = Path('apk-build/verification/records/records.zip')
with zipfile.ZipFile(source) as archive:
    assert archive.testzip() is None
    def rows(name):
        return list(csv.DictReader(io.StringIO(archive.read(name).decode('utf-8-sig'))))
    groups = rows('场景记录目录.csv')
    items = rows('清查表.csv')
    legacy = rows('箱目录.csv')
    assert len(groups) == len(legacy) == 5
    assert len(items) == 7
    by_id = {group['场景记录号']: group for group in groups}
    for item in items:
        group = by_id[item['场景记录号']]
        assert item['箱号'] == item['场景记录号']
        assert item['展厅'] == group['展厅']
        assert item['楼层'] == group['楼层']
        for key in ['照片文件', '扫描文件']:
            for name in item[key].split(';'):
                if name:
                    assert name in archive.namelist()
    edited = next(item for item in items if item['清查号'] == 'A-OLD-001-01')
    assert edited['名称'] == '已核对旧标本'
    assert edited['录入时间'] == '2026-10-01 11:00:00'
    assert edited['体积(mm³)'] == '256'
    assert by_id['D-OLD-001']['展厅'] == '地球厅'
    assert any(group['楼层'] == '三楼' and group['位置'] == '东侧机房' for group in groups)
    html = archive.read('清查表.xls').decode('utf-8')
    assert '生命演化厅' in html and '三楼' in html and '场景记录号' in html
    assert '原图/old.jpg' not in archive.namelist()
    assert '扫描文件/old.json' not in archive.namelist()
print('PASS: edited records, 3 scenes, legacy directory, hall/floor links and attachments')
