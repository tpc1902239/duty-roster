// ---------- 停休登記（超勤時數計算） ----------
// 照「超勤公式版」輪休表的「超勤時數計算」工作表：
//   服勤總時數 = 月班表各代號天數 × 時數（空白＝上班 22、◎ 8、超 12…，見「超勤時數」分頁）
//   加班時數   = 服勤總時數 − 公務員上班時數（每月手動輸入）
//   剩餘超勤   = 加班時數 − 滿超勤（每人；預設值在「滿超勤」分頁，每月匯入假表時確認）
//   超勤結算   = 剩餘超勤 − 這個月停休／補休的加總（停休打負數、補休打正數）
// 每月一頁「YYYY-MM 停休」：
//   第 1 列：公務員上班時數、值、警示上限、值
//   第 2 列：番號；第 3 列：姓名（最後一欄「備註」）；第 4 列：滿超勤（最後一欄記誰、何時確認）
//   第 5 列起：日、星期、每人的停休／補休時數、備註

const OT_RULES_SHEET = '超勤時數';
const OT_RULES_DEFAULT = [
  ['(空白)', 22, '上班；A／B／宿等固定班也算上班'],
  ['◎', 8, '休假'], ['超', 12, '超休'], ['補', 12, '補休'], ['長', 12, '長休息'], ['公', 8, '公假'], ['離', 12, '離隊'],
  ['○', 0, '輪休'], ['●', 0, '外宿'],
];
const OT_FULL_SHEET = '滿超勤';
const OT_BLANK = '(空白)';

function otRules_() {
  const sh = SpreadsheetApp.getActive().getSheetByName(OT_RULES_SHEET);
  if (!sh || sh.getLastRow() < 2) return OT_RULES_DEFAULT.map(r => ({ code: r[0], hours: r[1], note: r[2] }));
  return sh.getRange(2, 1, sh.getLastRow() - 1, 3).getValues()
    .filter(r => str_(r[0]))
    .map(r => ({ code: str_(r[0]), hours: Number(r[1]) || 0, note: str_(r[2]) }));
}

function otDefaults_() {
  const sh = SpreadsheetApp.getActive().getSheetByName(OT_FULL_SHEET);
  if (!sh || sh.getLastRow() < 2) return {};
  const out = {};
  sh.getRange(2, 1, sh.getLastRow() - 1, 3).getValues().forEach(r => {
    const n = str_(r[0]).replace(/\s+/g, '');
    if (n) out[n] = str_(r[2]) === '' ? '' : Number(r[2]);
  });
  return out;
}

/** 讀「YYYY-MM 停休」；沒有這頁回傳 null。 */
function otRead_(y, m) {
  const sh = SpreadsheetApp.getActive().getSheetByName(sheetName_(y, m, '停休'));
  if (!sh || sh.getLastRow() < 4) return null;
  const v = sh.getDataRange().getValues();
  const width = v[2].length;
  let noteCol = width - 1;
  while (noteCol > 2 && str_(v[2][noteCol]) !== '備註') noteCol--;
  if (str_(v[2][noteCol]) !== '備註') noteCol = width;
  const cols = [];
  for (let c = 2; c < noteCol; c++) {
    const name = str_(v[2][c]).replace(/\s+/g, '');
    if (name) cols.push({ c, name, num: str_(v[1][c]) });
  }
  const full = {}, entries = {}, notes = {};
  cols.forEach(p => { full[p.name] = str_(v[3][p.c]) === '' ? '' : Number(v[3][p.c]); });
  for (let r = 4; r < v.length; r++) {
    const d = Number(v[r][0]);
    if (!d || d > 31) continue;
    cols.forEach(p => {
      const x = v[r][p.c];
      if (str_(x) !== '' && !isNaN(Number(x))) (entries[d] = entries[d] || {})[p.name] = Number(x);
    });
    if (noteCol < width && str_(v[r][noteCol])) notes[d] = str_(v[r][noteCol]);
  }
  return {
    official: str_(v[0][1]) === '' ? '' : Number(v[0][1]),
    limit: str_(v[0][3]) === '' ? '' : Number(v[0][3]),
    people: cols.map(p => ({ name: p.name, num: p.num })),
    full, fullNote: noteCol < width ? str_(v[3][noteCol]) : '',
    entries, notes,
  };
}

/** 寫整頁「YYYY-MM 停休」。people 照當月月班表順序，加上已經有登記但月班表沒有的人。 */
function otWrite_(y, m, ot) {
  const ss = SpreadsheetApp.getActive();
  const name = sheetName_(y, m, '停休');
  const sh = ss.getSheetByName(name) || ss.insertSheet(name);
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const n = ot.people.length;
  const W = Math.max(n + 3, 4);
  const row = a => a.concat(Array(W - a.length).fill(''));
  const values = [
    row(['公務員上班時數', ot.official, '警示上限', ot.limit]),
    row(['番號', ''].concat(ot.people.map(p => p.num))),
    ['姓名', ''].concat(ot.people.map(p => p.name), ['備註']),
    ['滿超勤', ''].concat(ot.people.map(p => (ot.full[p.name] === undefined ? '' : ot.full[p.name])), [ot.fullNote || '']),
  ];
  for (let d = 1; d <= days; d++) {
    const e = ot.entries[d] || {};
    values.push([d, '日一二三四五六'[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]]
      .concat(ot.people.map(p => (e[p.name] === undefined ? '' : e[p.name])), [ot.notes[d] || '']));
  }
  sh.clear();
  sh.getRange(1, 1, values.length, W).setValues(values);
  sh.getRange(1, 1, 4, W).setFontWeight('bold').setBackground('#ddebf7');
  sh.setFrozenRows(4);
  sh.setFrozenColumns(2);
}

/** 這個月的停休表（沒有就用預設值組一份，不寫入）。 */
function otCurrent_(y, m) {
  const saved = otRead_(y, m);
  const mo = month_(y, m);
  const defaults = otDefaults_();
  const people = mo.people.map(p => ({ name: p.name, num: String(p.num) }));
  if (saved) saved.people.forEach(p => {
    const has = Object.keys(saved.entries).some(d => saved.entries[d][p.name] !== undefined);
    if (has && !people.some(q => q.name === p.name)) people.push(p);
  });
  const full = {};
  people.forEach(p => {
    full[p.name] = saved && saved.full[p.name] !== undefined && saved.fullNote ? saved.full[p.name]
      : defaults[p.name] !== undefined ? defaults[p.name] : '';
  });
  let limit = saved ? saved.limit : '';
  if (limit === '') {
    const prev = m === 1 ? otRead_(y - 1, 12) : otRead_(y, m - 1);
    limit = prev && prev.limit !== '' ? prev.limit : 12;
  }
  return {
    people, full, limit,
    official: saved ? saved.official : '',
    fullNote: saved ? saved.fullNote : '',
    entries: saved ? saved.entries : {},
    notes: saved ? saved.notes : {},
    saved: !!saved,
  };
}

/** 停休頁：月班表、固定排班（算上班的）、時數換算、這個月的停休表。 */
function getOvertime(token, y, m) {
  need_(token);
  if (!SpreadsheetApp.getActive().getSheetByName(sheetName_(y, m, '月班表'))) return { exists: false };
  const mo = month_(y, m);
  const ot = otCurrent_(y, m);
  let weekdays = 0;
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  for (let d = 1; d <= days; d++) { const w = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); if (w > 0 && w < 6) weekdays++; }
  return {
    exists: true,
    version: version_(sheetName_(y, m, '停休')),
    month: {
      people: mo.people.map(p => ({ num: p.num, name: p.name })),
      days: Object.keys(mo.days).map(Number).sort((a, b) => a - b)
        .map(d => ({ d, codes: mo.days[d].codes, away: mo.days[d].away })),
    },
    workNames: shiftDefs_().length ? shiftDefs_().filter(d => d.kind !== '休息').map(d => d.name) : SHIFT_CODES,
    rules: otRules_(),
    suggest: weekdays * 8,
    ot,
  };
}

/** 存停休／補休、公務員上班時數、警示上限。滿超勤不在這裡改。 */
function saveOvertime(token, y, m, data, version) {
  const s = need_(token, 'overtime');
  const num = v => (str_(v) === '' ? '' : Number(v));
  return guarded_(sheetName_(y, m, '停休'), version, () => {
    const ot = otCurrent_(y, m);
    ot.official = num(data.official);
    ot.limit = num(data.limit);
    ot.entries = {};
    Object.keys(data.entries || {}).forEach(d => {
      Object.keys(data.entries[d]).forEach(n => {
        const x = Number(data.entries[d][n]);
        if (str_(data.entries[d][n]) === '' || isNaN(x)) return;
        (ot.entries[d] = ot.entries[d] || {})[n] = x;
        if (!ot.people.some(p => p.name === n)) ot.people.push({ name: n, num: '' });
      });
    });
    ot.notes = {};
    Object.keys(data.notes || {}).forEach(d => { if (str_(data.notes[d])) ot.notes[d] = str_(data.notes[d]); });
    otWrite_(y, m, ot);
    log_(s.user, '停休登記', y + '-' + pad_(m));
    return { ok: true };
  });
}

/**
 * 匯入假表頁確認滿超勤：full = {姓名: 時數或空白}。
 * setDefault 為真時同時更新「滿超勤」預設值（新來的人加進去，其他人保留）。
 */
function saveFull(token, y, m, full, setDefault, version) {
  const s = need_(token, 'leave');
  return guarded_(sheetName_(y, m, '停休'), version, () => {
    const ot = otCurrent_(y, m);
    Object.keys(full).forEach(n => {
      ot.full[n] = str_(full[n]) === '' ? '' : Number(full[n]);
      if (!ot.people.some(p => p.name === n)) ot.people.push({ name: n, num: '' });
    });
    ot.fullNote = '滿超勤已確認：' + s.name + ' ' + Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd HH:mm');
    otWrite_(y, m, ot);
    if (setDefault) {
      const ss = SpreadsheetApp.getActive();
      const sh = ss.getSheetByName(OT_FULL_SHEET) || ss.insertSheet(OT_FULL_SHEET);
      const defaults = otDefaults_();
      const order = [];
      if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues()
        .forEach(r => { const n = str_(r[0]).replace(/\s+/g, ''); if (n) order.push({ name: n, num: str_(r[1]) }); });
      ot.people.forEach(p => {
        const o = order.find(x => x.name === p.name);
        if (o) { if (p.num) o.num = p.num; } else order.push({ name: p.name, num: p.num });
        if (full[p.name] !== undefined) defaults[p.name] = ot.full[p.name];
      });
      order.sort((a, b) => (Number(a.num) || 999) - (Number(b.num) || 999));
      const values = [['姓名', '番號', '滿超勤']].concat(order.map(o => [o.name, o.num, defaults[o.name] === undefined ? '' : defaults[o.name]]));
      sh.clear();
      sh.getRange(1, 1, values.length, 3).setValues(values);
      sh.getRange(1, 1, 1, 3).setFontWeight('bold').setBackground('#ddebf7');
      sh.setFrozenRows(1);
    }
    log_(s.user, '確認滿超勤', y + '-' + pad_(m) + (setDefault ? '（同時更新預設值）' : ''));
    return { note: ot.fullNote };
  });
}

/** 改時數換算表：rules = [{code, hours, note}]。 */
function saveOtRules(token, rules) {
  const s = need_(token, 'overtime');
  const seen = {};
  rules.forEach(r => {
    r.code = str_(r.code);
    if (!r.code) throw new Error('代碼不能空白');
    if (seen[r.code]) throw new Error('代碼重複：' + r.code);
    seen[r.code] = true;
    if (isNaN(Number(r.hours))) throw new Error(r.code + '：時數要是數字');
  });
  if (!seen[OT_BLANK]) throw new Error('要保留「' + OT_BLANK + '」（上班）這一列');
  const ss = SpreadsheetApp.getActive();
  const sh = ss.getSheetByName(OT_RULES_SHEET) || ss.insertSheet(OT_RULES_SHEET);
  const values = [['代碼', '時數', '說明']].concat(rules.map(r => [r.code, Number(r.hours), str_(r.note)]));
  sh.clear();
  sh.getRange(1, 1, values.length, 3).setValues(values);
  sh.getRange(1, 1, 1, 3).setFontWeight('bold').setBackground('#ddebf7');
  sh.setFrozenRows(1);
  log_(s.user, '超勤時數換算', rules.map(r => r.code + '=' + r.hours).join('、'));
  return { rules: otRules_() };
}

/**
 * 排班區存檔時呼叫：把這一天的停休時數（休假的人被排勤務、休息超過的時數，都是負數）寫進「YYYY-MM 停休」。
 * 以勤務表為準：這一天整天換掉（之前手動打的那天也會被蓋掉，瑋哥 2026-11-27 同意）。ot = {姓名: 時數}。
 */
function otDayAuto_(date, ot, s) {
  const [y, m, d] = date.split('-').map(Number);
  if (!SpreadsheetApp.getActive().getSheetByName(sheetName_(y, m, '月班表'))) return 0;
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const cur = otCurrent_(y, m);
    const day = {};
    Object.keys(ot || {}).forEach(n => {
      const x = Number(ot[n]);
      if (!x || isNaN(x)) return;
      day[n] = x;
      if (!cur.people.some(p => p.name === n)) cur.people.push({ name: n, num: '' });
    });
    const before = JSON.stringify(cur.entries[d] || {});
    if (Object.keys(day).length) cur.entries[d] = day; else delete cur.entries[d];
    if (JSON.stringify(cur.entries[d] || {}) === before && cur.saved) return Object.keys(day).length;
    otWrite_(y, m, cur);
    bump_(sheetName_(y, m, '停休'));   // 開著停休登記頁的人存檔時會被擋下、重新讀取，不會蓋掉這次的結果
    log_(s.user, '停休登記（排班區）', date + '：' + (Object.keys(day).map(n => n + ' ' + day[n]).join('、') || '清空'));
    return Object.keys(day).length;
  } finally { lock.releaseLock(); }
}
