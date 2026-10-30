/**
 * 資料維護：月班表（匯入假表、填固定排班）、車輛、救護訓練。
 * 每個分頁有一個版本號，存檔時版本不同就拒絕（別人在你打開之後改過），避免互相蓋掉。
 */

const SHIFT_CODES = ['A1', 'A2', 'A3', 'A4', 'B1', 'B2', 'B3', '宿'];   // 還沒有「固定排班」分頁時用
const DUTY_KINDS = ['值班', '救護'];
const HOURS = ['08', '09', '10', '11', '12', '13', '14', '15', '16', '17', '18', '19', '20', '21', '22', '23', '00', '01', '02', '03', '04', '05', '06', '07'];
const GROUP_BG = ['#c9daf0', '#ffffff', '#dcebd5', '#ffffff', '#dcebd5', '#f3e6f5'];
const TABLES = { '車輛': '車輛承辦', '救護訓練': '救護訓練承辦' };

function sheetName_(y, m, kind) { return y + '-' + pad_(m) + ' ' + kind; }

function version_(name) {
  return Number(PropertiesService.getScriptProperties().getProperty('ver:' + name) || 0);
}

function bump_(name) {
  const v = version_(name) + 1;
  PropertiesService.getScriptProperties().setProperty('ver:' + name, String(v));
  return v;
}

/** 拿鎖並檢查版本；fn 執行完版本 +1。 */
function guarded_(name, version, fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    if (Number(version) !== version_(name)) throw new Error('資料在你打開之後被別人改過了，請重新載入再修改。');
    const out = fn();
    return Object.assign({ version: bump_(name) }, out);
  } finally {
    lock.releaseLock();
  }
}

// ---------- 固定排班設定 ----------

/** 「固定排班」分頁：名稱（A1…）、時間（08,09,…）、勤務別（值班／救護）。 */
function shiftDefs_() {
  if (!SpreadsheetApp.getActive().getSheetByName('固定排班')) return [];
  return rows_('固定排班').map(r => ({
    name: str_(r['名稱']), kind: str_(r['勤務別']),
    hours: str_(r['時間']).split(/[,，、\s]+/).filter(h => h).map(h => pad_(Number(h))),
  })).filter(d => d.name);
}

/** 月班表上算「固定排班」的代碼：設定裡的名稱；還沒設定就用 A1～B3、宿。 */
function shiftNames_() {
  const defs = shiftDefs_();
  return defs.length ? defs.map(d => d.name) : SHIFT_CODES;
}

function getShiftDefs(token) {
  need_(token);
  return { defs: shiftDefs_(), version: version_('固定排班') };
}

function saveShiftDefs(token, defs, version) {
  const s = need_(token, '排班');
  const seen = {};
  defs.forEach(d => {
    d.name = str_(d.name);
    if (!d.name) throw new Error('名稱不能空白');
    if (seen[d.name]) throw new Error('名稱重複：' + d.name);
    seen[d.name] = true;
    if (DUTY_KINDS.indexOf(d.kind) < 0) throw new Error(d.name + '：勤務別要選' + DUTY_KINDS.join('或'));
    if (!d.hours.length || d.hours.some(h => HOURS.indexOf(h) < 0)) throw new Error(d.name + '：請勾選時間');
  });
  return guarded_('固定排班', version, () => {
    const ss = SpreadsheetApp.getActive();
    const sh = ss.getSheetByName('固定排班') || ss.insertSheet('固定排班');
    const values = [['名稱', '時間', '勤務別']].concat(defs.map(d =>
      [d.name, HOURS.filter(h => d.hours.indexOf(h) >= 0).join(','), d.kind]));
    sh.clear();
    sh.getRange(1, 1, values.length, 3).setNumberFormat('@').setValues(values);
    sh.getRange(1, 1, 1, 3).setFontWeight('bold').setBackground('#ddebf7');
    sh.setFrozenRows(1);
    delete cache_['固定排班'];
    log_(s.user, '固定排班設定', defs.map(d => d.name).join('、'));
    return { count: defs.length };
  });
}

// ---------- 編制人員 ----------

const STAFF_STATUS = ['在隊', '不在隊', '算人力', '不計人力'];
const STAFF_HEAD = ['姓名', '番號', '在勤狀況', '限排時間', '限排勤務'];

/** 「編制人員」分頁：姓名、番號、在勤狀況、限排時間（空白＝不限）、限排勤務（空白＝不限）。 */
function unitStaff_() {
  if (!SpreadsheetApp.getActive().getSheetByName('編制人員')) return [];
  return rows_('編制人員').map(r => ({
    name: str_(r['姓名']).replace(/\s+/g, ''), num: Number(r['番號']) || '', status: str_(r['在勤狀況']) || '在隊',
    hours: str_(r['限排時間']).split(/[,，、\s]+/).filter(h => h).map(h => pad_(Number(h))),
    kind: str_(r['限排勤務']),
  })).filter(p => p.name);
}

function getUnitStaff(token) {
  need_(token);
  return { staff: unitStaff_(), version: version_('編制人員') };
}

function saveUnitStaff(token, staff, version) {
  const s = need_(token, '管理員');
  const seen = {};
  staff.forEach(p => {
    p.name = str_(p.name).replace(/\s+/g, '');
    if (!p.name) throw new Error('姓名不能空白');
    if (seen[p.name]) throw new Error('姓名重複：' + p.name);
    seen[p.name] = true;
    if (!(Number(p.num) > 0)) throw new Error(p.name + '：番號要是數字');
    if (STAFF_STATUS.indexOf(p.status) < 0) throw new Error(p.name + '：在勤狀況要選' + STAFF_STATUS.join('、'));
    if (p.kind && DUTY_KINDS.indexOf(p.kind) < 0) throw new Error(p.name + '：限排勤務只能是' + DUTY_KINDS.join('或') + '或空白');
    if (p.hours.some(h => HOURS.indexOf(h) < 0)) throw new Error(p.name + '：時間不對');
  });
  return guarded_('編制人員', version, () => {
    const ss = SpreadsheetApp.getActive();
    const sh = ss.getSheetByName('編制人員') || ss.insertSheet('編制人員');
    const values = [STAFF_HEAD].concat(staff.map(p =>
      [p.name, Number(p.num), p.status, HOURS.filter(h => p.hours.indexOf(h) >= 0).join(','), p.kind || '']));
    sh.clear();
    sh.getRange(1, 1, values.length, STAFF_HEAD.length).setNumberFormat('@').setValues(values);
    sh.getRange(1, 1, 1, STAFF_HEAD.length).setFontWeight('bold').setBackground('#ddebf7');
    sh.setFrozenRows(1);
    delete cache_['編制人員'];
    log_(s.user, '編制人員', staff.length + ' 人');
    return { count: staff.length };
  });
}

// ---------- 累計基準 ----------
// 系統上線前的全年累計（例如 4.2 版 10 月月班表的「累計」宿／A／B 列），之後每月往上加。

function base_(y) {
  if (!SpreadsheetApp.getActive().getSheetByName('累計基準')) return null;
  const rows = rows_('累計基準').filter(r => Number(r['年']) === Number(y));
  if (!rows.length) return null;
  const counts = {};
  rows.forEach(r => {
    const c = counts[str_(r['姓名'])] = {};
    ['宿', 'A', 'B'].forEach(g => { if (Number(r[g])) c[g] = Number(r[g]); });
  });
  return { month: Number(rows[0]['截至月']), counts };
}

/** rows = [{name, 宿, A, B}]，代表 y 年 1 月到 m 月（含）的累計。 */
function saveBase(token, y, m, rows) {
  const s = need_(token, '排班');
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const ss = SpreadsheetApp.getActive();
    const sh = ss.getSheetByName('累計基準') || ss.insertSheet('累計基準');
    const keep = sh.getLastRow() > 1 ? sh.getDataRange().getValues().slice(1).filter(r => Number(r[0]) !== Number(y)) : [];
    const values = [['年', '截至月', '姓名', '宿', 'A', 'B']].concat(keep,
      rows.map(r => [y, m, str_(r.name), Number(r['宿']) || 0, Number(r.A) || 0, Number(r.B) || 0]));
    sh.clear();
    sh.getRange(1, 1, values.length, 6).setValues(values);
    sh.getRange(1, 1, 1, 6).setFontWeight('bold').setBackground('#ddebf7');
    sh.setFrozenRows(1);
    delete cache_['累計基準'];
    log_(s.user, '匯入累計基準', y + ' 年截至 ' + m + ' 月，' + rows.length + ' 人');
    return { count: rows.length };
  } finally {
    lock.releaseLock();
  }
}

// ---------- 月班表 ----------

/** 讀月班表給網頁：{exists, people:[{num,name}], days:[{d,weekday,codes,away}], version}。 */
function getMonth(token, y, m) {
  need_(token);
  const name = sheetName_(y, m, '月班表');
  if (!SpreadsheetApp.getActive().getSheetByName(name)) return { exists: false, people: [], days: [], version: version_(name) };
  const mo = month_(y, m);
  return {
    exists: true, version: version_(name),
    people: mo.people.map(p => ({ num: p.num, name: p.name })),
    days: Object.keys(mo.days).map(Number).sort((a, b) => a - b)
      .map(d => ({ d, weekday: mo.days[d].weekday, codes: mo.days[d].codes, away: mo.days[d].away })),
  };
}

/** 整張月班表寫回分頁（格式同 4.2 版）。 */
function writeMonth_(y, m, grid) {
  const ss = SpreadsheetApp.getActive();
  const name = sheetName_(y, m, '月班表');
  const sh = ss.getSheetByName(name) || ss.insertSheet(name);
  const n = grid.people.length;
  const values = [[y, '番號'].concat(grid.people.map(p => p.num)), [m, ''].concat(grid.people.map(p => p.name))];
  const bg = [['#ffffff', '#ffffff'].concat(grid.people.map(p => GROUP_BG[Math.min(Math.floor(p.num / 10), 5)]))];
  bg.push(bg[0].slice());
  grid.days.forEach(day => {
    values.push([day.d, day.weekday].concat(day.codes));
    bg.push(['#ffffff', '#ffffff'].concat(day.away.map((a, i) => (a ? '#000000' : bg[0][i + 2]))));
  });
  sh.clear();
  sh.getRange(1, 1, values.length, n + 2).setValues(values).setBackgrounds(bg)
    .setHorizontalAlignment('center').setVerticalAlignment('middle');
  sh.getRange(2, 3, 1, n).setWrap(true);
  sh.setFrozenRows(2);
  sh.setFrozenColumns(2);
  delete cache_['m' + y + m];
}

/**
 * 匯入假表。已經填好的固定排班（A1、宿…），假表那格空白就保留；其他格子以假表為準。
 * grid：{people:[{num,name}], days:[{d,weekday,codes,away}]}
 */
function importLeave(token, y, m, grid, version) {
  const s = need_(token, '假表承辦');
  const name = sheetName_(y, m, '月班表');
  return guarded_(name, version, () => {
    let kept = 0;
    const names = shiftNames_();
    if (SpreadsheetApp.getActive().getSheetByName(name)) {
      const old = month_(y, m);
      const col = Object.fromEntries(old.people.map((p, i) => [p.name, i]));
      grid.days.forEach(day => {
        const prev = old.days[day.d];
        if (!prev) return;
        grid.people.forEach((p, i) => {
          const c = prev.codes[col[p.name]];
          if (!str_(day.codes[i]) && !day.away[i] && names.indexOf(c) >= 0) { day.codes[i] = c; kept++; }
        });
      });
    }
    writeMonth_(y, m, grid);
    log_(s.user, '匯入假表', name + '：' + grid.people.length + ' 人、' + grid.days.length + ' 天，保留固定排班 ' + kept + ' 格');
    return { kept };
  });
}

/** 排班的人改月班表格子：changes = [{name, d, code}]。黑格（不在隊）不能改。 */
function saveShifts(token, y, m, changes, version) {
  const s = need_(token, '排班');
  const name = sheetName_(y, m, '月班表');
  return guarded_(name, version, () => {
    const mo = month_(y, m);
    const col = Object.fromEntries(mo.people.map((p, i) => [p.name, i]));
    const sh = sheet_(name);
    const rowOf = {};
    sh.getRange(1, 1, sh.getLastRow(), 1).getValues().forEach((r, i) => { if (i >= 2 && Number(r[0])) rowOf[Number(r[0])] = i + 1; });
    const bad = [];
    changes.forEach(c => {
      const i = col[c.name], day = mo.days[c.d];
      const cur = day && i !== undefined ? day.codes[i] : null;
      c.code = str_(c.code);
      if (cur === null || day.away[i]) bad.push(c.d + ' 日 ' + c.name + '（不在隊）');
      else if (c.code.length > 10) bad.push(c.d + ' 日 ' + c.name + '：太長');
    });
    if (bad.length) throw new Error('以下格子不能改：' + bad.join('、'));
    changes.forEach(c => sh.getRange(rowOf[c.d], mo.people[col[c.name]].col + 1).setValue(c.code || ''));
    delete cache_['m' + y + m];
    log_(s.user, '修改月班表', name + '：' + changes.map(c => c.d + '日' + c.name + '→' + (c.code || '空白')).join('、'));
    return { saved: changes.length };
  });
}

/**
 * 全年累計（不含這個月，這個月由網頁自己算）：有「累計基準」就從基準往上加，否則從 1 月算起。
 * 回傳 {before: {姓名: {名稱或分組: 次數}}, baseMonth}；基準只有分組（宿／A／B）。
 */
function getShiftCounts(token, y, m) {
  need_(token);
  const names = shiftNames_(), before = {};
  const base = base_(y);
  let from = 1;
  if (base && base.month < m) {
    from = base.month + 1;
    Object.keys(base.counts).forEach(n => { before[n] = Object.assign({}, base.counts[n]); });
  }
  for (let k = from; k < m; k++) {
    if (!SpreadsheetApp.getActive().getSheetByName(sheetName_(y, k, '月班表'))) continue;
    const mo = month_(y, k);
    Object.keys(mo.days).forEach(d => mo.days[d].codes.forEach((c, i) => {
      if (names.indexOf(c) < 0) return;
      const who = before[mo.people[i].name] = before[mo.people[i].name] || {};
      who[c] = (who[c] || 0) + 1;
    }));
  }
  return { before, baseMonth: base && base.month < m ? base.month : 0 };
}

// ---------- 車輛、救護訓練 ----------

function getTable(token, y, m, kind) {
  need_(token);
  if (!TABLES[kind]) throw new Error('不明的表：' + kind);
  const name = sheetName_(y, m, kind);
  const sh = SpreadsheetApp.getActive().getSheetByName(name);
  const rows = sh ? sh.getDataRange().getDisplayValues().filter(r => r.some(v => v !== '')) : [];
  return { exists: !!sh, rows, version: version_(name) };
}

function saveTable(token, y, m, kind, rows, version) {
  if (!TABLES[kind]) throw new Error('不明的表：' + kind);
  const s = need_(token, TABLES[kind]);
  const name = sheetName_(y, m, kind);
  return guarded_(name, version, () => {
    const ss = SpreadsheetApp.getActive();
    const sh = ss.getSheetByName(name) || ss.insertSheet(name);
    const width = Math.max.apply(null, rows.map(r => r.length));
    const values = rows.map(r => r.concat(Array(width - r.length).fill('')));
    sh.clear();
    if (values.length) {
      sh.getRange(1, 1, values.length, width).setNumberFormat('@').setValues(values);
      sh.getRange(1, 1, 1, width).setFontWeight('bold').setBackground('#ddebf7');
      sh.setFrozenRows(1);
    }
    log_(s.user, '匯入' + kind, name + '：' + Math.max(values.length - 1, 0) + ' 列');
    return { rows: values.length };
  });
}
