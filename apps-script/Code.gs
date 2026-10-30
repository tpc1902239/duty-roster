/**
 * 智能勤務表：資料庫與日曆的後台（Google Apps Script）。
 * 放在勤務表專用的系統 Google 帳號裡、綁定「勤務表資料庫」試算表；分隊日曆以唯讀方式分享給它。
 */

// 分隊日曆的 ID（日曆設定 →「整合日曆」→ 日曆 ID）。分隊帳號把日曆分享給系統帳號（查看所有活動詳細資料）。
// 留空就用系統帳號自己的預設日曆（測試用）。
const CALENDAR_ID = '';

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('智能勤務表（資料庫測試）')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

// ---------- 讀試算表 ----------
// 分頁：人員、勤務類別、設定，以及每月一頁「YYYY-MM 月班表」「YYYY-MM 存檔」（格式同 4.2 版）。

const cache_ = {};
function sheet_(name) {
  const sh = SpreadsheetApp.getActive().getSheetByName(name);
  if (!sh) throw new Error('找不到分頁：' + name);
  return sh;
}

/** 表格式分頁（第 1 列是標題）讀成物件陣列。 */
function rows_(name) {
  if (cache_[name]) return cache_[name];
  const values = sheet_(name).getDataRange().getValues();
  const header = values.shift();
  return cache_[name] = values
    .filter(r => r.some(v => v !== ''))
    .map(r => Object.fromEntries(header.map((h, i) => [h, r[i]])));
}

const pad_ = n => String(n).padStart(2, '0');
const str_ = v => String(v === null || v === undefined ? '' : v).trim();

/** 黑色（或接近黑色）底色 = 那天不在隊。 */
function isBlack_(hex) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || '');
  return !!m && [m[1], m[2], m[3]].every(x => parseInt(x, 16) < 64);
}

/** 人員分頁：姓名 -> {alias, role, mode, status}。 */
function staff_() {
  return Object.fromEntries(rows_('人員').map(p => [str_(p['姓名']), {
    alias: str_(p['別名']).split(/[、,，\s]+/).filter(Boolean),
    role: str_(p['身分']) || '隊員', mode: str_(p['勤務方式']) || '一般', status: str_(p['狀態']) || '在隊',
  }]));
}

/**
 * 讀某月的月班表分頁（4.2 版格式：第 1 列番號、第 2 列姓名、A 欄日、B 欄星期、C 欄起代號）。
 * 回傳 {people:[{num,name,col}], days:{日:{weekday, codes:[], away:[]}}}。
 */
function month_(year, month) {
  const key = 'm' + year + month;
  if (cache_[key]) return cache_[key];
  const sh = sheet_(year + '-' + pad_(month) + ' 月班表');
  const range = sh.getDataRange();
  const v = range.getValues(), bg = range.getBackgrounds();
  const people = [];
  for (let c = 2; c < v[0].length; c++) {
    const num = Number(v[0][c]), name = str_(v[1][c]).replace(/\s+/g, '');
    if (num && name) people.push({ num, name, col: c });   // 「可填假人數」等沒有番號的欄自動略過
  }
  const days = {};
  for (let r = 2; r < v.length; r++) {
    const d = Number(v[r][0]);
    if (!d || d > 31 || !str_(v[r][1])) continue;   // 沒有星期的列（例如 11/31）略過
    days[d] = { weekday: str_(v[r][1]),
                codes: people.map(p => str_(v[r][p.col])),
                away: people.map(p => isBlack_(bg[r][p.col])) };
  }
  return cache_[key] = { people, days };
}

/** 某一天的名單：在隊的人（含當天代號）與不在隊的人。 */
function dayRoster(date) {
  const [y, m, d] = date.split('-').map(Number);
  const mo = month_(y, m), day = mo.days[d];
  if (!day) throw new Error(date + ' 在月班表找不到這一天');
  const staff = staff_();
  const here = [], away = [];
  mo.people.forEach((p, i) => {
    const info = staff[p.name] || { alias: [], role: '隊員', mode: '一般', status: '在隊' };
    const row = Object.assign({ num: p.num, name: p.name, code: day.codes[i] }, info);
    (day.away[i] || info.status === '調離' ? away : here).push(row);
  });
  return { weekday: day.weekday, here, away };
}

function peopleOn(date) { return dayRoster(date).here; }
function awayOn(date) { return dayRoster(date).away; }

/** 一個月的月班表，給測試頁顯示；不在隊的格子是 null。 */
function monthRoster(year, month) {
  const mo = month_(year, month);
  return {
    people: mo.people.map(p => ({ num: p.num, name: p.name })),
    days: Object.keys(mo.days).map(Number).sort((a, b) => a - b).map(d => ({
      date: year + '-' + pad_(month) + '-' + pad_(d),
      codes: mo.days[d].codes.map((c, i) => (mo.days[d].away[i] ? null : c)),
    })),
  };
}

// ---------- 讀日曆 ----------

function calendar_() {
  if (!CALENDAR_ID) return CalendarApp.getDefaultCalendar();
  const cal = CalendarApp.getCalendarById(CALENDAR_ID);
  if (!cal) throw new Error('讀不到日曆，請確認分隊日曆已分享給這個帳號：' + CALENDAR_ID);
  return cal;
}

/**
 * 解析標題「事項（起-迄）-人名、人名」。
 * 回傳 {title, duty, start, end, names, rest}；看不懂時間就回傳 start=null。
 */
function parseTitle(title) {
  const m = String(title).match(/^(.*?)[（(]\s*(\d{1,2})\s*[-~～－–]\s*(\d{1,2})\s*[）)](.*)$/);
  if (!m) return { title, duty: String(title).trim(), start: null, end: null, names: [], rest: false };
  const duty = m[1].trim();
  const names = m[4].replace(/^[\s\-－–]+/, '').split(/[、,，\s]+/).filter(Boolean);
  return { title, duty, start: Number(m[2]), end: Number(m[3]), names, rest: /休息/.test(duty) };
}

/** 某一天的日曆勤務，並把人名對應到人員。 */
function calendarOn(date) {
  const people = peopleOn(date);
  const find = name => people.find(p => p.name === name || p.alias.includes(name) || String(p.num) === name);
  const start = new Date(date + 'T00:00:00+08:00');
  const end = new Date(start.getTime() + 24 * 3600 * 1000);
  return calendar_().getEvents(start, end).map(ev => {
    const t = parseTitle(ev.getTitle());
    // 「小華休息時間（18-20）」這種人名寫在前面的舊寫法
    if (t.rest && !t.names.length) {
      const p = people.find(p => [p.name, ...p.alias].some(n => n && t.duty.includes(n)));
      if (p) t.names = [p.alias[0] || p.name];
    }
    const matched = t.names.map(n => ({ name: n, person: find(n) || null }));
    return Object.assign(t, {
      allDay: ev.isAllDayEvent(),
      people: matched.filter(x => x.person).map(x => x.person.name),
      unknown: matched.filter(x => !x.person).map(x => x.name),
      kind: ev.isAllDayEvent() || t.start === null ? '備註' : t.rest ? '休息' : t.names.length ? '指定人' : '待排',
    });
  });
}

/** 測試頁一次取回：當月月班表、當天在隊／不在隊、當天日曆。 */
function loadDay(date) {
  const [y, m] = date.split('-').map(Number);
  return { date, month: monthRoster(y, m), here: peopleOn(date), away: awayOn(date), events: calendarOn(date) };
}
