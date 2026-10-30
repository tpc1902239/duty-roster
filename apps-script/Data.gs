/**
 * 資料維護：月班表（匯入假表、改 A／B／宿）、車輛、救護訓練。
 * 每個分頁有一個版本號，存檔時版本不同就拒絕（別人在你打開之後改過），避免互相蓋掉。
 */

const SHIFT_CODES = ['A1', 'A2', 'A3', 'A4', 'B1', 'B2', 'B3', '宿'];
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
 * 匯入假表。已經填好的 A／B／宿，假表那格空白就保留；其他格子以假表為準。
 * grid：{people:[{num,name}], days:[{d,weekday,codes,away}]}
 */
function importLeave(token, y, m, grid, version) {
  const s = need_(token, '假表承辦');
  const name = sheetName_(y, m, '月班表');
  return guarded_(name, version, () => {
    let kept = 0;
    if (SpreadsheetApp.getActive().getSheetByName(name)) {
      const old = month_(y, m);
      const col = Object.fromEntries(old.people.map((p, i) => [p.name, i]));
      grid.days.forEach(day => {
        const prev = old.days[day.d];
        if (!prev) return;
        grid.people.forEach((p, i) => {
          const c = prev.codes[col[p.name]];
          if (!str_(day.codes[i]) && !day.away[i] && SHIFT_CODES.includes(c)) { day.codes[i] = c; kept++; }
        });
      });
    }
    writeMonth_(y, m, grid);
    log_(s.user, '匯入假表', name + '：' + grid.people.length + ' 人、' + grid.days.length + ' 天，保留 A／B／宿 ' + kept + ' 格');
    return { kept };
  });
}

/** 改 A／B／宿：changes = [{name, d, code}]，code 只能是 A／B／宿或空白，而且不能蓋掉假別。 */
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
      if (cur === null || day.away[i]) bad.push(c.d + ' 日 ' + c.name + '（不在隊）');
      else if (c.code && !SHIFT_CODES.includes(c.code)) bad.push(c.d + ' 日 ' + c.name + '：' + c.code + ' 不是 A／B／宿');
      else if (cur && !SHIFT_CODES.includes(cur)) bad.push(c.d + ' 日 ' + c.name + '：原本是「' + cur + '」');
    });
    if (bad.length) throw new Error('以下格子不能改：' + bad.join('、'));
    changes.forEach(c => sh.getRange(rowOf[c.d], mo.people[col[c.name]].col + 1).setValue(c.code || ''));
    delete cache_['m' + y + m];
    log_(s.user, '修改 A／B／宿', name + '：' + changes.map(c => c.d + '日' + c.name + '→' + (c.code || '空白')).join('、'));
    return { saved: changes.length };
  });
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
