// ---------- 駕訓登記 ----------
// 每月一頁「YYYY-MM 駕訓」：姓名、番號、應訓時數、日期1～日期4。
// 應訓幾小時就用幾格，每格一個日期（例如「11月3日」）；排班區存檔時自動填進下一個空格，手動打的不會被蓋掉。
// 幹部（番號個位數）不用駕訓，不列。

const DRILL_HEAD = ['姓名', '番號', '應訓時數', '日期1', '日期2', '日期3', '日期4'];
const DRILL_MAX = 4;
const DRILL_ITEM = '駕訓';

function drillRead_(y, m) {
  const sh = SpreadsheetApp.getActive().getSheetByName(sheetName_(y, m, '駕訓'));
  if (!sh || sh.getLastRow() < 2) return null;
  return sh.getRange(2, 1, sh.getLastRow() - 1, DRILL_HEAD.length).getDisplayValues()
    .filter(r => str_(r[0]))
    .map(r => ({ name: str_(r[0]), num: str_(r[1]), need: Math.min(DRILL_MAX, Math.max(1, Number(r[2]) || 1)), dates: r.slice(3, 3 + DRILL_MAX).map(str_) }));
}

function drillWrite_(y, m, rows) {
  const ss = SpreadsheetApp.getActive(), name = sheetName_(y, m, '駕訓');
  const sh = ss.getSheetByName(name) || ss.insertSheet(name);
  const values = [DRILL_HEAD].concat(rows.map(r => [r.name, String(r.num), String(r.need)].concat(
    Array.from({ length: DRILL_MAX }, (_, k) => (k < r.need ? str_(r.dates[k]) : '')))));
  sh.clear();
  sh.getRange(1, 1, values.length, DRILL_HEAD.length).setNumberFormat('@').setValues(values);
  sh.getRange(1, 1, 1, DRILL_HEAD.length).setFontWeight('bold').setBackground('#ddebf7');
  sh.setFrozenRows(1);
}

/** 這個月的名單：已存的照存的；編制人員新增的人補上（應訓時數沿用上個月，沒有就 1）。 */
function drillRows_(y, m) {
  const saved = drillRead_(y, m) || [];
  const prevYm = m === 1 ? [y - 1, 12] : [y, m - 1];
  const prev = Object.fromEntries((drillRead_(prevYm[0], prevYm[1]) || []).map(r => [r.name, r.need]));
  const have = Object.fromEntries(saved.map(r => [r.name, r]));
  const staff = unitStaff_().filter(p => Number(p.num) >= 10 && p.status !== '不在隊');
  const out = staff.map(p => have[p.name]
    ? Object.assign(have[p.name], { num: String(p.num) })
    : { name: p.name, num: String(p.num), need: prev[p.name] || 1, dates: Array(DRILL_MAX).fill('') });
  // 編制人員已經拿掉、但這個月有登記的人留著
  saved.filter(r => !out.some(o => o.name === r.name) && r.dates.some(Boolean)).forEach(r => out.push(r));
  return out.sort((a, b) => Number(a.num) - Number(b.num));
}

function getDrill(token, y, m) {
  need_(token);
  return { rows: drillRows_(y, m), version: version_(sheetName_(y, m, '駕訓')) };
}

function saveDrill(token, y, m, rows, version) {
  const s = need_(token, '排班');
  rows.forEach(r => {
    r.name = str_(r.name);
    r.need = Math.min(DRILL_MAX, Math.max(1, Number(r.need) || 1));
    r.dates = (r.dates || []).map(str_);
  });
  return guarded_(sheetName_(y, m, '駕訓'), version, () => {
    drillWrite_(y, m, rows.filter(r => r.name));
    log_(s.user, '駕訓登記', y + '-' + pad_(m));
    return { count: rows.length };
  });
}

/**
 * 從一天的排班列找出駕訓學員：{番號: 時數}。
 * 同一小時的駕訓兩人一組（照列的順序），第一人是教官、第二人是學員；
 * 同兩人連續兩小時以上＝輪流當教官（第一小時記第二人、第二小時記第一人…）；
 * 其中一人是幹部（番號個位數）時，全部時數都記給隊員。
 */
function drillTrainees_(rows) {
  const drill = rows.filter(r => str_(r.item) === DRILL_ITEM);
  const out = {}, add = n => { out[n] = (out[n] || 0) + 1; };
  const pairsAt = h => {
    const who = drill.map(r => str_(r.cells[h])).filter(Boolean), ps = [];
    for (let k = 0; k + 1 < who.length; k += 2) ps.push(who[k] + '|' + who[k + 1]);
    return ps;
  };
  const runs = {};   // 一組人 → 現在連續到第幾小時
  for (let h = 0; h < HOURS.length; h++) {
    const now = pairsAt(h), next = {};
    now.forEach(p => {
      const k = (runs[p] || 0);
      next[p] = k + 1;
      const [a, b] = p.split('|');
      const cadreA = Number(a) < 10, cadreB = Number(b) < 10;
      if (cadreA && cadreB) return;
      if (cadreA) return add(b);
      if (cadreB) return add(a);
      add(k % 2 === 0 ? b : a);
    });
    Object.keys(runs).forEach(p => { if (!(p in next)) delete runs[p]; });
    Object.assign(runs, next);
  }
  return out;
}

/** 排班區存檔後：學員的駕訓日期補進「YYYY-MM 駕訓」的空格（已經有這天的就不重複）。 */
function drillAuto_(date, day) {
  const [y, m, d] = date.split('-').map(Number);
  const got = drillTrainees_(day.rows || []);
  if (!Object.keys(got).length) return;
  const who = Object.fromEntries((day.people || []).map(p => [str_(p.num), str_(p.name)]));
  const label = m + '月' + d + '日';
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const rows = drillRows_(y, m);
    let changed = false;
    Object.keys(got).forEach(num => {
      const r = rows.find(x => x.name === who[num]) || rows.find(x => x.num === num);
      if (!r) return;
      let missing = got[num] - r.dates.slice(0, r.need).filter(x => x === label).length;
      for (let k = 0; k < r.need && missing > 0; k++) if (!r.dates[k]) { r.dates[k] = label; missing--; changed = true; }
    });
    if (changed) { drillWrite_(y, m, rows); bump_(sheetName_(y, m, '駕訓')); }
  } finally {
    lock.releaseLock();
  }
}
