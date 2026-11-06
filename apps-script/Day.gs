/**
 * 排班區（輸入）：讀取當天、外勤項目設定、存檔。
 * 輸出勤務表、任務編組另外寫（輸出模組），這裡只負責把一天排好存起來。
 */

// ---------- 外勤項目設定 ----------

/** 勤務表上放哪一列（同 4.2 版 Z 欄：A 防災宣導、B 水源調查、C 其他臨時勤務、D 併入值班／91／92）。 */
const ITEM_PLACES = ['防災宣導', '水源調查', '其他臨時勤務', '值班', '一救', '二救'];
/** 文字寫到勤務表哪一欄（同 4.2 版 AA 欄：A 備註、B／C 搶救演練及訓練）。 */
const ITEM_TEXT = ['備註', '搶救演練及訓練', ''];
const ITEM_HEAD = ['名稱', '列名格式', '勤務表列', '文字欄', '大隊代碼', '勤務類別'];

/** 還沒有「外勤項目」分頁時用的預設值，照 4.2 版表單 4 的選項。列名格式的 {} 會換成排班時輸入的內容。 */
const ITEM_DEFAULTS = [
  ['水源', '水源第{}梯', '水源調查', '備註', 'F', '水源'],
  ['駕訓', '', '其他臨時勤務', '搶救演練及訓練', 'L', '駕訓'],
  ['大隊送公文', '', '其他臨時勤務', '備註', 'P', '公文'],
  ['消防查察', '', '防災宣導', '備註', 'P', '查察'],
  ['瓦斯路邊攔查', '', '防災宣導', '備註', 'N', '查察'],
  ['訓練', '{}', '其他臨時勤務', '搶救演練及訓練', 'L', '訓練'],
  ['宣導', '{}', '防災宣導', '備註', 'G', '宣導'],
  ['開會', '{}', '其他臨時勤務', '備註', 'P', '開會'],
  ['住警器安裝', '', '其他臨時勤務', '備註', 'G', '宣導'],
  ['其他勤務', '{}', '其他臨時勤務', '備註', 'P', '其他'],
  ['第二位值班', '', '值班', '', 'D', '值班'],
  ['第三位91', '', '一救', '', 'E', '救護'],
  ['第三位92', '', '二救', '', 'E', '救護'],
];

function items_() {
  const toItem = r => ({ name: str_(r[0]), label: str_(r[1]), place: str_(r[2]), text: str_(r[3]), code: str_(r[4]), category: str_(r[5]) });
  if (!SpreadsheetApp.getActive().getSheetByName('外勤項目')) return ITEM_DEFAULTS.map(toItem);
  return rows_('外勤項目').map(r => toItem(ITEM_HEAD.map(h => r[h]))).filter(x => x.name);
}

function getItems(token) {
  need_(token);
  return { items: items_(), version: version_('外勤項目'), places: ITEM_PLACES, texts: ITEM_TEXT };
}

function saveItems(token, items, version) {
  const s = need_(token, '排班');
  const seen = {};
  items.forEach(x => {
    ['name', 'label', 'place', 'text', 'code', 'category'].forEach(k => { x[k] = str_(x[k]); });
    if (!x.name) throw new Error('名稱不能空白');
    if (seen[x.name]) throw new Error('名稱重複：' + x.name);
    seen[x.name] = true;
    if (ITEM_PLACES.indexOf(x.place) < 0) throw new Error(x.name + '：勤務表列要選' + ITEM_PLACES.join('、'));
    if (ITEM_TEXT.indexOf(x.text) < 0) throw new Error(x.name + '：文字欄不對');
  });
  return guarded_('外勤項目', version, () => {
    const ss = SpreadsheetApp.getActive();
    const sh = ss.getSheetByName('外勤項目') || ss.insertSheet('外勤項目');
    const values = [ITEM_HEAD].concat(items.map(x => [x.name, x.label, x.place, x.text, x.code, x.category]));
    sh.clear();
    sh.getRange(1, 1, values.length, ITEM_HEAD.length).setNumberFormat('@').setValues(values);
    sh.getRange(1, 1, 1, ITEM_HEAD.length).setFontWeight('bold').setBackground('#ddebf7');
    sh.setFrozenRows(1);
    delete cache_['外勤項目'];
    log_(s.user, '外勤項目設定', items.map(x => x.name).join('、'));
    return { count: items.length };
  });
}

// ---------- 讀取當天 ----------

/** 設定分頁的數字，沒填用預設。 */
function settingNum_(name, dflt) {
  const v = Number(setting_(name));
  return setting_(name) !== '' && !isNaN(v) ? v : dflt;
}

/** 月班表上這些代碼也算在隊（空白和固定排班名稱本來就算）。設定分頁「在隊代碼」可以改，預設「外」（外宿）。 */
function onCodes_() {
  const v = setting_('在隊代碼');
  return (v === '' ? '外' : v).split(/[,，、\s]+/).filter(Boolean);
}

const dateStr_ = dt => Utilities.formatDate(dt, 'Asia/Taipei', 'yyyy-MM-dd');
function addDays_(date, n) {
  const dt = new Date(date + 'T12:00:00+08:00');
  return dateStr_(new Date(dt.getTime() + n * 86400000));
}

/**
 * 讀取排班區要的一切：當天在隊的人（含班別）、固定排班、外勤項目、行事曆、昨天深夜勤、已經存過的這一天。
 */
function getDay(token, date) {
  need_(token);
  const [y, m, d] = date.split('-').map(Number);
  const roster = dayRoster_(date);
  const names = shiftNames_(), on = onCodes_();
  const unit = Object.fromEntries(unitStaff_().map(u => [u.name, u]));
  const people = [], off = [];
  roster.here.forEach(p => {
    const u = unit[p.name] || {};
    const row = { num: p.num, name: p.name, code: p.code, role: p.role, status: u.status || '在隊', limitHours: u.hours || [], limitKind: u.kind || '' };
    (p.code === '' || names.indexOf(p.code) >= 0 || on.indexOf(p.code) >= 0 ? people : off).push(row);
  });
  let events = [], calendarError = '';
  try { events = calendarOn_(date); } catch (e) { calendarError = e.message; }
  const saved = readDay_(y, m, d);
  return {
    date, weekday: roster.weekday, people,
    off: (runs => off.map(p => ({ num: p.num, name: p.name, code: p.code, role: p.role, run: runs[p.name] })))(leaveRuns_(date, off.map(p => p.name), names, on)),
    away: roster.away.map(p => ({ num: p.num, name: p.name, role: p.role })),
    defs: shiftDefs_(), items: items_(), colors: colors_(), events, calendarError,
    night: lastNight_(date),
    saved, version: version_(sheetName_(y, m, '存檔')),
    // 勤務表標題的「N 人」：編制人員裡在隊／算人力的人數；沒有編制人員就用月班表人數
    headcount: Object.keys(unit).length ? Object.keys(unit).filter(k => ['在隊', '算人力'].indexOf(unit[k].status) >= 0).length : roster.here.length + roster.away.length,
    settings: {
      minStandby: settingNum_('備勤最低人數', 3), drillLess: settingNum_('駕訓時備勤減少', 2), maxRun: settingNum_('連續服勤上限', 8),
      leaderMax: settingNum_('小隊長每日上限時數', 4), restHours: settingNum_('每人休息時數', 2), restMax: settingNum_('休息上限', 4),
    },
  };
}

/**
 * 昨天深夜勤（00–08 有排值班或救護）的人：[{num, name, hours}]。
 * 昨天有存檔就看存檔；沒有就看昨天月班表的固定排班。
 */
function lastNight_(date) {
  const prev = addDays_(date, -1);
  const [y, m, d] = prev.split('-').map(Number);
  const late = HOURS.slice(16);   // 00..07
  const out = {};
  const finish = o => nightList_(o, prev);
  const add = (num, name, h) => { const k = String(num); (out[k] = out[k] || { num, name, hours: [] }).hours.push(h); };
  try {
    const saved = readDay_(y, m, d);
    if (saved) {
      const who = Object.fromEntries(saved.people.map(p => [String(p.num), p.name]));
      saved.rows.filter(r => ['值班', '一救', '二救'].indexOf(r.type) >= 0 || r.place === '值班' || r.place === '一救' || r.place === '二救')
        .forEach(r => late.forEach(h => { const v = r.cells[HOURS.indexOf(h)]; if (v) add(v, who[v] || '', h); }));
      return finish(out);
    }
    const defs = Object.fromEntries(shiftDefs_().filter(x => x.kind !== '休息').map(x => [x.name, x]));
    dayRoster_(prev).here.forEach(p => {
      const def = defs[p.code];
      if (def) def.hours.filter(h => late.indexOf(h) >= 0).forEach(h => add(p.num, p.name, h));
    });
  } catch (e) { /* 上個月還沒有資料 */ }
  return finish(out);
}

/** 昨天深夜勤：補上姓名、時數排好。 */
function nightList_(out, prev) {
  let who = {};
  try { const r = dayRoster_(prev); who = Object.fromEntries(r.here.concat(r.away).map(p => [String(p.num), p.name])); } catch (e) { /* 沒有月班表 */ }
  const late = HOURS.slice(16);
  return Object.keys(out).map(k => {
    const x = out[k];
    x.name = x.name || who[k] || '';
    x.hours = late.filter(h => x.hours.indexOf(h) >= 0);
    return x;
  });
}

// ---------- 存檔 ----------
// 「YYYY-MM 存檔」分頁，每天一塊（同 4.2 版存檔區）：
//   第 1 列：A 日、B–Y 08…07、Z 起是欄名（類型、勤務表列、文字欄、大隊代碼、勤務類別、項目、行事曆）
//   接著每一列是排班區的一列：A 列名、B–Y 番號、Z 起是這列的屬性
//   最後兩列：「在隊」（B 欄＝番號=姓名=班別、…，留下當天番號對姓名的對照）、「備註」（B 欄）

const SAVE_HEAD = ['類型', '勤務表列', '文字欄', '大隊代碼', '勤務類別', '項目', '行事曆'];
const SAVE_W = 1 + HOURS.length + SAVE_HEAD.length;

/** 讀整張存檔分頁，切成 {日: [列, …]}。 */
function saveBlocks_(y, m) {
  const sh = SpreadsheetApp.getActive().getSheetByName(sheetName_(y, m, '存檔'));
  if (!sh || sh.getLastRow() < 1) return {};
  const values = sh.getRange(1, 1, sh.getLastRow(), SAVE_W).getDisplayValues();
  const blocks = {};
  let cur = null;
  values.forEach(r => {
    if (/^\d+$/.test(r[0])) { cur = r[1] === '08' ? (blocks[Number(r[0])] = [r]) : null; return; }   // 只有日期、沒有內容的列＝那天還沒排
    if (cur) cur.push(r);
  });
  return blocks;
}

function readDay_(y, m, d) {
  const block = saveBlocks_(y, m)[d];
  if (!block) return null;
  const out = { rows: [], people: [], memo: '', car: null, sub: null, savedBy: '', savedAt: '' };
  block.slice(1).forEach(r => {
    if (r[0] === '在隊' && r[1 + HOURS.length] === '') {
      out.people = r[1].split('、').filter(Boolean).map(x => { const [num, name, code] = x.split('='); return { num, name, code: code || '' }; });
    } else if (r[0] === '備註' && r[1 + HOURS.length] === '') {
      out.memo = r[1];
    } else if ((r[0] === '車輛保養' || r[0] === '二替') && r[1 + HOURS.length] === '') {
      out[r[0] === '車輛保養' ? 'car' : 'sub'] = r[1].split('.').filter(Boolean);
    } else if (r[0] === '存檔' && r[1 + HOURS.length] === '') {
      out.savedBy = r[1]; out.savedAt = r[2];
    } else if (r[0] !== '') {
      const a = r.slice(1 + HOURS.length);
      const row = { label: r[0], cells: r.slice(1, 1 + HOURS.length), type: a[0], place: a[1], text: a[2], code: a[3], category: a[4], item: a[5], ev: a[6] };
      out.rows.push(row.type && SAVE_TYPES.indexOf(row.type) >= 0 ? row : legacyRow_(row, a));
    }
  });
  return out;
}

const SAVE_TYPES = ['值班', '一救', '二救', '休息', '外勤'];

/** 4.2 版存檔區搬過來的列：Z 欄放哪一列（A/B/C/D）、AA 欄文字位置（A/B/C 或 D/E/F）、AB 欄大隊代碼。 */
function legacyRow_(row, a) {
  const label = row.label;
  if (['值班', '一救', '二救'].indexOf(label) >= 0) return { label, cells: row.cells, type: label };
  if (/^休息/.test(label)) return { label, cells: row.cells, type: '休息' };
  const z = a[0], aa = a[1];
  const place = { A: '防災宣導', B: '水源調查', C: '其他臨時勤務' }[z] || { D: '值班', E: '一救', F: '二救' }[aa] || '其他臨時勤務';
  const text = z === 'D' ? '' : aa === 'A' ? '備註' : (aa === 'B' || aa === 'C') ? '搶救演練及訓練' : '';
  return { label, cells: row.cells, type: '外勤', place, text, code: a[2] || '', category: aa === 'C' && z !== 'D' ? '訓練' : '', item: '' };
}

/**
 * 存一天。day = {rows:[{label, cells[24], type, place, text, code, category, item}], people:[{num,name,code}], memo}。
 * 同一天已經存過就整塊換掉（異動）。
 */
function saveDay(token, date, day, version) {
  const s = need_(token, '排班');
  const [y, m, d] = date.split('-').map(Number);
  const name = sheetName_(y, m, '存檔');
  if (!day.rows || !day.rows.length) throw new Error('沒有資料可以存');
  return guarded_(name, version, () => {
    const blocks = saveBlocks_(y, m);
    const existed = !!blocks[d];
    const pad = r => r.concat(Array(SAVE_W - r.length).fill('')).slice(0, SAVE_W);
    const rows = [pad([String(d)].concat(HOURS, SAVE_HEAD))];
    day.rows.forEach(r => rows.push(pad([str_(r.label)].concat(
      HOURS.map((h, i) => str_(r.cells[i])),
      [r.type, r.place, r.text, r.code, r.category, r.item, r.ev].map(str_)))));
    rows.push(pad(['在隊', day.people.map(p => [p.num, p.name, p.code].map(str_).join('=')).join('、')]));
    rows.push(pad(['備註', str_(day.memo)]));
    rows.push(pad(['車輛保養', (day.car || []).map(str_).filter(Boolean).join('.')]));
    rows.push(pad(['二替', (day.sub || []).map(str_).filter(Boolean).join('.')]));
    rows.push(pad(['存檔', s.name || s.user, Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd HH:mm')]));
    blocks[d] = rows;
    const all = [];
    Object.keys(blocks).map(Number).sort((a, b) => a - b).forEach(k => blocks[k].forEach(r => all.push(pad(r))));
    const ss = SpreadsheetApp.getActive();
    const sh = ss.getSheetByName(name) || ss.insertSheet(name);
    sh.clear();
    sh.getRange(1, 1, all.length, SAVE_W).setNumberFormat('@').setValues(all);
    all.forEach((r, i) => { if (r[1] === '08' && /^\d+$/.test(r[0])) sh.getRange(i + 1, 1, 1, SAVE_W).setFontWeight('bold').setBackground('#ddebf7'); });
    log_(s.user, existed ? '異動勤務表' : '存檔勤務表', date + '：' + day.rows.length + ' 列');
    return { existed };
  });
}

// ---------- 排班區顏色 ----------
// 「排班區顏色」分頁：項目、底色。項目是「列:值班」這種（列名那格的顏色）或「班:A1」這種（固定班在自己時段的格子顏色）。

const COLOR_DEFAULTS = {
  '列:時間': '', '列:備勤人員': '#92d050', '列:值班': '#00b0f0', '列:一救': '#ffff00', '列:二救': '#f4b183', '列:休息': '#f8cbad', '列:外勤': '',
  '班:宿': '#00b0f0', '班:A1': '#ffff00', '班:A2': '#ffc000', '班:B1': '#dae3f3', '班:B2': '#c6e0b4',
};

function colors_() {
  if (!SpreadsheetApp.getActive().getSheetByName('排班區顏色')) return Object.assign({}, COLOR_DEFAULTS);
  const out = {};
  rows_('排班區顏色').forEach(r => { const k = str_(r['項目']); if (k) out[k] = str_(r['底色']); });
  return out;
}

function getColors(token) {
  need_(token);
  return { colors: colors_(), version: version_('排班區顏色'), defs: shiftDefs_().map(d => d.name) };
}

function saveColors(token, colors, version) {
  const s = need_(token, '排班');
  Object.keys(colors).forEach(k => {
    if (!/^(列|班):/.test(k)) throw new Error('不明的項目：' + k);
    if (colors[k] && !/^#[0-9a-f]{6}$/i.test(colors[k])) throw new Error(k + '：顏色格式不對');
  });
  return guarded_('排班區顏色', version, () => {
    const ss = SpreadsheetApp.getActive();
    const sh = ss.getSheetByName('排班區顏色') || ss.insertSheet('排班區顏色');
    const values = [['項目', '底色']].concat(Object.keys(colors).map(k => [k, colors[k] || '']));
    sh.clear();
    sh.getRange(1, 1, values.length, 2).setNumberFormat('@').setValues(values);
    sh.getRange(1, 1, 1, 2).setFontWeight('bold').setBackground('#ddebf7');
    delete cache_['排班區顏色'];
    log_(s.user, '排班區顏色', Object.keys(colors).length + ' 項');
    return { count: Object.keys(colors).length };
  });
}

// ---------- 召回：連續放假天數（可以跨月） ----------

/**
 * 每個人含今天在內、連續不在隊（月班表是假別代號）幾天：{姓名: 天數}。
 * 班別代號、在隊代碼（外）、空白都算在隊；前後月份沒有月班表就停在那裡。
 */
function leaveRuns_(date, names, work, on) {
  const codeOf = (ds, name) => {
    const [y, m, d] = ds.split('-').map(Number);
    let mo;
    try { mo = month_(y, m); } catch (e) { return null; }
    const day = mo.days[d], i = mo.people.findIndex(p => p.name === name);
    if (!day || i < 0 || day.away[i]) return null;
    return str_(day.codes[i]);
  };
  const isOff = c => c !== null && c !== '' && work.indexOf(c) < 0 && on.indexOf(c) < 0;
  const out = {};
  names.forEach(name => {
    let n = 1;
    for (const dir of [-1, 1]) for (let k = 1; k <= 15 && isOff(codeOf(addDays_(date, dir * k), name)); k++) n++;
    out[name] = n;
  });
  return out;
}

// ---------- 勤務表 Excel：範本和存檔放在雲端硬碟「勤務表存檔」資料夾 ----------

const SHEET_FOLDER = '勤務表存檔';
const SHEET_TEMPLATE = '勤務表範本.xlsx';

function sheetFolder_() {
  const it = DriveApp.getFoldersByName(SHEET_FOLDER);
  return it.hasNext() ? it.next() : DriveApp.createFolder(SHEET_FOLDER);
}

/** 勤務表範本（base64）。還沒放範本就回傳 null。 */
function getSheetTemplate(token) {
  need_(token);
  const it = sheetFolder_().getFilesByName(SHEET_TEMPLATE);
  if (!it.hasNext()) return { data: null, folder: SHEET_FOLDER, name: SHEET_TEMPLATE };
  return { data: Utilities.base64Encode(it.next().getBlob().getBytes()), name: SHEET_TEMPLATE };
}

/** 把填好的勤務表存進「勤務表存檔／YYYY-MM／YYYY-MM-DD 勤務表.xlsx」，同一天重存會取代舊檔。 */
function saveSheetFile(token, date, data) {
  const s = need_(token, '排班');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('日期格式不對');
  const root = sheetFolder_(), ym = date.slice(0, 7);
  const it = root.getFoldersByName(ym), folder = it.hasNext() ? it.next() : root.createFolder(ym);
  const name = date + ' 勤務表.xlsx';
  const old = folder.getFilesByName(name);
  while (old.hasNext()) old.next().setTrashed(true);
  const file = folder.createFile(Utilities.newBlob(Utilities.base64Decode(data), MimeType.MICROSOFT_EXCEL, name));
  log_(s.user, '輸出勤務表', date);
  return { url: file.getUrl(), path: SHEET_FOLDER + '/' + ym + '/' + name };
}
