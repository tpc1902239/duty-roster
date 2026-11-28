// ---------- 水源登記 ----------
// 每年一頁「YYYY 水源」：梯次、上半年日期、上半年人員、下半年日期、下半年人員（日期例如「3月5日」，人員是番號，用「.」隔開）。
// 梯次預設 1-1、1-2、2-1…13-2，可以在網頁上新增。
// 排班區存檔時同步那一天：外勤「水源」（列名「水源第1-1梯」）排到的梯次，那半年的日期寫成這一天、人員寫成排到的人；
// 原本記這一天、但這次沒排的梯次清掉。其他天不動。

const WATER_HEAD = ['梯次', '上半年日期', '上半年人員', '下半年日期', '下半年人員'];
const WATER_ITEM = '水源';

function waterName_(y) { return y + ' 水源'; }

function waterDefault_() {
  const out = [];
  for (let i = 1; i <= 13; i++) for (let j = 1; j <= 2; j++) out.push({ batch: i + '-' + j, h1: '', p1: '', h2: '', p2: '' });
  return out;
}

function waterRows_(y) {
  const sh = SpreadsheetApp.getActive().getSheetByName(waterName_(y));
  if (!sh || sh.getLastRow() < 2) return waterDefault_();
  return sh.getRange(2, 1, sh.getLastRow() - 1, WATER_HEAD.length).getDisplayValues()
    .filter(r => str_(r[0])).map(r => ({ batch: str_(r[0]), h1: str_(r[1]), p1: str_(r[2]), h2: str_(r[3]), p2: str_(r[4]) }));
}

function waterWrite_(y, rows) {
  const ss = SpreadsheetApp.getActive(), name = waterName_(y);
  const sh = ss.getSheetByName(name) || ss.insertSheet(name);
  const values = [WATER_HEAD].concat(rows.map(r => [r.batch, r.h1, r.p1, r.h2, r.p2]));
  sh.clear();
  sh.getRange(1, 1, values.length, WATER_HEAD.length).setNumberFormat('@').setValues(values);
  sh.getRange(1, 1, 1, WATER_HEAD.length).setFontWeight('bold').setBackground('#ddebf7');
  sh.setFrozenRows(1);
}

function getWater(token, y) {
  need_(token);
  return { rows: waterRows_(Number(y)), version: version_(waterName_(Number(y))) };
}

function saveWater(token, y, rows, version) {
  const s = need_(token, 'water');
  y = Number(y);
  const seen = {};
  rows = (rows || []).map(r => ({ batch: str_(r.batch), h1: str_(r.h1), p1: str_(r.p1), h2: str_(r.h2), p2: str_(r.p2) })).filter(r => r.batch);
  rows.forEach(r => { if (seen[r.batch]) throw new Error('梯次重複：' + r.batch); seen[r.batch] = true; });
  return guarded_(waterName_(y), version, () => {
    waterWrite_(y, rows);
    log_(s.user, '水源登記', String(y));
    return { count: rows.length };
  });
}

/** 列名「水源第1-1梯」→ 1-1。 */
function waterBatch_(row) {
  if (str_(row.item) !== WATER_ITEM || !(row.cells || []).some(Boolean)) return '';
  const m = str_(row.label).match(/第\s*(.+?)\s*梯/);
  return m ? m[1] : '';
}

/** 排班區存檔後同步這一天的水源梯次。 */
function waterAuto_(date, day) {
  const [y, m, d] = date.split('-').map(Number);
  const label = m + '月' + d + '日', half = m <= 6 ? 'h1' : 'h2', ppl = m <= 6 ? 'p1' : 'p2';
  const got = {};   // 梯次 → 排到的番號
  (day.rows || []).forEach(r => {
    const b = waterBatch_(r); if (!b) return;
    got[b] = got[b] || [];
    r.cells.forEach(v => { v = str_(v); if (v && v !== '全' && got[b].indexOf(v) < 0) got[b].push(v); });
  });
  const sh = SpreadsheetApp.getActive().getSheetByName(waterName_(y));
  if (!sh && !Object.keys(got).length) return 0;
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const rows = waterRows_(y);
    let changed = false;
    rows.forEach(r => {
      if (got[r.batch]) {
        const who = got[r.batch].join('.');
        if (r[half] !== label || r[ppl] !== who) { r[half] = label; r[ppl] = who; changed = true; }
      } else if (r[half] === label) { r[half] = ''; r[ppl] = ''; changed = true; }
    });
    Object.keys(got).filter(b => !rows.some(r => r.batch === b)).forEach(b => {
      const r = { batch: b, h1: '', p1: '', h2: '', p2: '' }; r[half] = label; r[ppl] = got[b].join('.'); rows.push(r); changed = true;
    });
    if (changed) { waterWrite_(y, rows); bump_(waterName_(y)); }
    return Object.keys(got).length;
  } finally {
    lock.releaseLock();
  }
}
