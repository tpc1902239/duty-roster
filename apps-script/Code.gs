/**
 * 智能勤務表：資料庫與日曆的後台（Google Apps Script）。
 * 放在分隊 Google 帳號裡、綁定「勤務表資料庫」試算表。
 */

// 放勤務的日曆名稱；留空就用帳號的預設日曆。
const CALENDAR_NAME = '';
const TZ = 'Asia/Taipei';

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('智能勤務表（資料庫測試）')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

// ---------- 讀試算表 ----------

const cache_ = {};
function rows_(name) {
  if (cache_[name]) return cache_[name];
  const sh = SpreadsheetApp.getActive().getSheetByName(name);
  if (!sh) throw new Error('找不到分頁：' + name);
  const values = sh.getDataRange().getValues();
  const header = values.shift();
  return cache_[name] = values
    .filter(r => r.some(v => v !== ''))
    .map(r => Object.fromEntries(header.map((h, i) => [h, r[i]])));
}

function ymd_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, TZ, 'yyyy-MM-dd');
  return String(v || '').trim();
}

function inRange_(date, from, to) {
  const a = ymd_(from), b = ymd_(to);
  return (!a || a <= date) && (!b || date <= b);
}

/** 某一天在隊的人：{id, num, name, alias, role, counted, mode}，依番號排序。 */
function peopleOn(date) {
  const nums = rows_('番號期間');
  const away = rows_('異動紀錄').filter(r => inRange_(date, r['起日'], r['迄日']));
  const awayIds = new Set(away.map(r => r['人員ID']));
  return rows_('人員')
    .map(p => {
      const n = nums.find(r => r['人員ID'] === p['人員ID'] && inRange_(date, r['起日'], r['迄日']));
      return {
        id: p['人員ID'], num: n ? Number(n['番號']) : null, name: p['姓名'],
        alias: String(p['別名'] || '').split(/[、,，\s]+/).filter(Boolean),
        role: p['身分'], counted: p['計入人力'] === 'Y', mode: p['勤務方式'] || '一般',
      };
    })
    .filter(p => p.num !== null && !awayIds.has(p.id))
    .sort((a, b) => a.num - b.num);
}

/** 不在隊的人與原因（給勤務表「扣除人力」用）。 */
function awayOn(date) {
  const names = Object.fromEntries(rows_('人員').map(p => [p['人員ID'], p['姓名']]));
  return rows_('異動紀錄')
    .filter(r => inRange_(date, r['起日'], r['迄日']))
    .map(r => ({ id: r['人員ID'], name: names[r['人員ID']] || r['人員ID'], status: r['狀態'],
                 from: ymd_(r['起日']), to: ymd_(r['迄日']), note: r['備註'] }));
}

/** 一個月的月班表：人員欄依當月在隊名單產生，不在隊的日子標 null。 */
function monthRoster(year, month) {
  const pad = n => String(n).padStart(2, '0');
  const prefix = year + '-' + pad(month) + '-';
  const last = new Date(year, month, 0).getDate();
  const dates = Array.from({ length: last }, (_, i) => prefix + pad(i + 1));
  const codes = {};
  rows_('月班表').forEach(r => {
    const d = ymd_(r['日期']);
    if (d.startsWith(prefix)) (codes[d] = codes[d] || {})[r['人員ID']] = String(r['代號'] || '');
  });
  const people = {};
  const days = dates.map(d => {
    const here = peopleOn(d);
    here.forEach(p => { people[p.id] = people[p.id] || p; });
    const ids = new Set(here.map(p => p.id));
    return { date: d, here: [...ids], codes: codes[d] || {} };
  });
  return {
    people: Object.values(people).sort((a, b) => a.num - b.num),
    days: days.map(d => ({ date: d.date,
      codes: Object.fromEntries(Object.keys(people).map(id => [id, d.here.includes(id) ? (d.codes[id] || '') : null])) })),
  };
}

// ---------- 讀日曆 ----------

function calendar_() {
  if (!CALENDAR_NAME) return CalendarApp.getDefaultCalendar();
  const cal = CalendarApp.getCalendarsByName(CALENDAR_NAME)[0];
  if (!cal) throw new Error('找不到日曆：' + CALENDAR_NAME);
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
      people: matched.filter(x => x.person).map(x => x.person.id),
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
