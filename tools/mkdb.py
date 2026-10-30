"""把 4.2 版 xlsm 轉成「勤務表資料庫」匯入用 xlsx（v2：每月一頁月班表、存檔、車輛、救護訓練，格式同 4.2 版）。

用法：CALENDAR_ID=日曆ID python3 mkdb.py 輸出.xlsx 9月.xlsm 10月.xlsm ...
產出檔含同仁姓名，不要放進 repository。
"""
import os, sys, copy, warnings, openpyxl
from openpyxl.styles import Font, PatternFill
warnings.filterwarnings('ignore')
CALENDAR_ID = os.environ.get('CALENDAR_ID', '')


def s(v):
    if v is None: return ''
    if isinstance(v, float) and v.is_integer(): v = int(v)
    return str(v).strip()


def role(n):
    if n == 1: return '分隊長'
    if 2 <= n <= 9: return '小隊長'
    if n in (51, 52): return '實務生'
    if n == 53: return '實習生'
    return '隊員'


def copy_block(src, dst, rows, cols):
    """照原樣複製值與格式（底色、字型、框線、對齊）。"""
    for r_out, r in enumerate(rows, 1):
        for c_out, c in enumerate(cols, 1):
            a, b = src.cell(r, c), dst.cell(r_out, c_out)
            b.value = a.value
            if a.has_style:
                b.fill, b.font, b.border, b.alignment = (copy.copy(a.fill), copy.copy(a.font),
                                                       copy.copy(a.border), copy.copy(a.alignment))
                b.number_format = a.number_format
    for c_out, c in enumerate(cols, 1):
        letter = openpyxl.utils.get_column_letter(c)
        w = src.column_dimensions[letter].width
        if w: dst.column_dimensions[openpyxl.utils.get_column_letter(c_out)].width = w


out = openpyxl.Workbook()
people = {}   # 姓名 -> 番號
months = []
for path in sys.argv[2:]:
    wb = openpyxl.load_workbook(path)          # 保留格式
    vals = openpyxl.load_workbook(path, data_only=True)
    m, mv = wb['月班表'], vals['月班表']
    year, month = int(s(mv.cell(1, 1).value)) + 1911, int(s(mv.cell(2, 1).value))
    tag = f'{year}-{month:02d}'
    last_col = 2
    while s(mv.cell(1, last_col + 1).value):
        last_col += 1
        people.setdefault(s(mv.cell(2, last_col).value), int(s(mv.cell(1, last_col).value)))
    last_row = 2
    while s(mv.cell(last_row + 1, 1).value).isdigit() and s(mv.cell(last_row + 1, 2).value) and last_row < 33:
        last_row += 1
    # 用公式算的格子（星期、標題）改成值
    ws = out.create_sheet(f'{tag} 月班表')
    copy_block(m, ws, range(1, last_row + 1), range(1, last_col + 1))
    for r in range(1, last_row + 1):
        for c in range(1, last_col + 1):
            ws.cell(r, c).value = mv.cell(r, c).value
    ws.cell(1, 1).value, ws.cell(2, 1).value = year, month
    ws.freeze_panes = 'C3'
    # 存檔：照存檔區原樣
    a, av = wb['存檔區'], vals['存檔區']
    ws = out.create_sheet(f'{tag} 存檔')
    copy_block(a, ws, range(1, a.max_row + 1), range(1, 31))
    for r in range(1, a.max_row + 1):
        for c in range(1, 31):
            ws.cell(r, c).value = av.cell(r, c).value
    # 車輛、救護訓練：照原樣（4.2 版格式）
    for src_name in ('車輛', '救護訓練'):
        src, sv = wb[src_name], vals[src_name]
        ws = out.create_sheet(f'{tag} {src_name}')
        copy_block(src, ws, range(1, src.max_row + 1), range(1, src.max_column + 1))
        for r in range(1, src.max_row + 1):
            for c in range(1, src.max_column + 1):
                ws.cell(r, c).value = sv.cell(r, c).value
        if src_name == '救護訓練' and not s(ws.cell(1, 5).value):
            ws.cell(1, 5).value = '教官番號'
    months.append(tag)

out.remove(out.active)
bold = Font(bold=True); head = PatternFill('solid', fgColor='DDEBF7')


def table(title, header, rows, at):
    ws = out.create_sheet(title, at)
    ws.append(header)
    for cell in ws[1]: cell.font = bold; cell.fill = head
    for row in rows: ws.append(list(row))
    ws.freeze_panes = 'A2'
    for i, h in enumerate(header):
        ws.column_dimensions[openpyxl.utils.get_column_letter(i + 1)].width = max(10, len(h) * 2 + 4)


table('人員', ['姓名', '番號', '別名', '身分', '勤務方式', '狀態', '備註'],
      [(n, num, n[1:], role(num), '一般', '在隊', '') for n, num in sorted(people.items(), key=lambda x: x[1])], 0)
TYPES = [('水源', 'B', 'A', 'F', '梯次'), ('駕訓', 'C', 'B', 'L', ''), ('大隊送公文', 'C', 'A', 'P', ''),
         ('消防查察', 'A', 'A', 'P', ''), ('瓦斯路邊攔查', 'A', 'A', 'N', ''), ('訓練', 'C', 'C', 'L', '內容'),
         ('其他勤務', 'C', 'A', 'P', '內容'), ('宣導', 'A', 'A', 'G', '內容'), ('開會', 'C', 'A', 'P', '內容'),
         ('住警器安裝', 'C', 'A', 'G', ''), ('第二位值班', 'D', 'D', 'D', ''), ('第三位91', 'D', 'E', 'E', ''),
         ('第三位92', 'D', 'F', 'E', '')]
table('勤務類別', ['名稱', 'Z碼', 'AA碼', 'AB碼', '需輸入', '計入服勤時數', '計入連續服勤'],
      [(n, z, a, b, x, 'Y', 'N' if z == 'C' else 'Y') for n, z, a, b, x in TYPES], 1)
table('設定', ['項目', '值', '說明'], [
    ('備勤最低人數', 3, 'C23 兩車三人'), ('駕訓時備勤減少', 2, 'C23 車輛與 2 人外出'),
    ('小隊長每日上限時數', 4, 'C22 值班、救護、共同勤務合計'), ('每人休息時數', 2, 'C14'),
    ('連續服勤上限', 8, 'C03'), ('分隊長不排班', 'Y', 'C21'),
    ('日曆ID', CALENDAR_ID, '分隊日曆的 ID（日曆設定 → 整合日曆）')], 2)
out.save(sys.argv[1])
print(len(people), 'people;', ', '.join(months))
