// 讀取 4.2 版 xlsm（用 SheetJS 解析後的 workbook）：月班表、存檔區、救護訓練、排班區
// 與 prototype/data.py 相同的邏輯。

export const HOURS = ['08', '09', '10', '11', '12', '13', '14', '15', '16', '17', '18', '19',
  '20', '21', '22', '23', '00', '01', '02', '03', '04', '05', '06', '07'];
export const ON_DUTY = new Set(['', 'A1', 'A2', 'A3', 'A4', 'B1', 'B2', 'B3', '離', '宿', '外', '長', 'M']);

function cellText(ws, r, c) {
  // r、c 從 1 開始，和 Excel 一樣
  const cell = ws[XLSXref(r, c)];
  if (!cell || cell.v === undefined || cell.v === null) return '';
  let v = cell.v;
  if (typeof v === 'number' && Number.isInteger(v)) return String(v);
  return String(v).trim();
}

function XLSXref(r, c) {
  let s = '';
  let n = c;
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s + r;
}

function maxRow(ws) {
  const ref = ws['!ref'];
  if (!ref) return 0;
  const m = ref.split(':').pop().match(/\d+/);
  return m ? Number(m[0]) : 0;
}

const isDigits = (s) => /^\d+$/.test(s);

function readRows(ws, start, end) {
  // 從 start 列讀到 end 列（不含），每列：名稱、24 小時格子、AA 欄旗標
  const rows = [];
  for (let r = start; r < end; r++) {
    const label = cellText(ws, r, 1);
    if (!label) continue;
    const cells = [];
    for (let h = 0; h < 24; h++) {
      const t = cellText(ws, r, 2 + h);
      cells.push(isDigits(t) ? Number(t) : null);
    }
    rows.push({ label, cells, flag: cellText(ws, r, 27) });
  }
  return rows;
}

export function loadWorkbook(wb) {
  const m = wb.Sheets['月班表'];
  const people = [];
  for (let c = 3; cellText(m, 1, c); c++) people.push(Number(cellText(m, 1, c)));
  const roster = {};
  for (let r = 3; r < 34; r++) {
    const d = cellText(m, r, 1);
    if (!isDigits(d) || !cellText(m, r, 2)) continue;
    const status = {};
    people.forEach((p, i) => { status[p] = cellText(m, r, 3 + i); });
    roster[Number(d)] = { weekday: cellText(m, r, 2), status };
  }

  // 存檔區：每天一段，第一列 B 欄是 "08"
  const days = {};
  const ws = wb.Sheets['存檔區'];
  const last = maxRow(ws);
  const heads = [];
  for (let r = 1; r <= last; r++) if (cellText(ws, r, 2) === '08' && isDigits(cellText(ws, r, 1))) heads.push(r);
  heads.forEach((r, i) => {
    days[Number(cellText(ws, r, 1))] = readRows(ws, r + 1, i + 1 < heads.length ? heads[i + 1] : last + 1);
  });

  const training = {};
  const t = wb.Sheets['救護訓練'];
  if (t) {
    for (let r = 2; r <= maxRow(t); r++) {
      const d = cellText(t, r, 1);
      const who = cellText(t, r, 5);
      if (isDigits(d) && isDigits(who)) training[Number(d)] = Number(who);
    }
  }

  // 排班區：今天要排的那一天（A2 是日期，第 3～11 列固定、第 12 列以後是外勤）
  let today = null;
  const s = wb.Sheets['排班區'];
  if (s && isDigits(cellText(s, 2, 1))) {
    const rows = readRows(s, 3, maxRow(s) + 1);
    today = { day: Number(cellText(s, 2, 1)), rows };
  }
  return { people, roster, days, training, today };
}

export function nightWorkers(prevStatus) {
  // 前一天是 B 班或值宿的人（C10：隔天 12 時前不排勤務）
  const s = new Set();
  if (!prevStatus) return s;
  for (const [p, v] of Object.entries(prevStatus)) if (['B1', 'B2', 'B3', '宿'].includes(v)) s.add(Number(p));
  return s;
}

export function workersOf(status) {
  return Object.entries(status).filter(([, v]) => ON_DUTY.has(v)).map(([p]) => Number(p));
}
