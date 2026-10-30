// 網頁操作：讀 xlsm → 一鍵補空缺 → 顯示結果與檢查 → 複製貼回 Excel
import highsLoader from './vendor/highs.mjs';
import { loadWorkbook, nightWorkers, workersOf, HOURS } from './lib/roster.js';
import { solve, DUTY } from './lib/solver.js';
import { check, ROW_NAMES } from './lib/check.js';

const $ = (id) => document.getElementById(id);
const highsReady = highsLoader({ locateFile: (f) => `vendor/${f}` });
const FIXED_LABELS = ['值班', '一救', '一救', '二救', '二救', '休息1', '休息2', '休息3', '休息4'];

let ctx = null;      // 今天的排班資料
let result = null;   // 目前顯示的 9×24 格子

$('file').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  reset();
  try {
    const wb = XLSX.read(await f.arrayBuffer(), { type: 'array' });
    ctx = buildContext(loadWorkbook(wb));
    showMeta();
    $('solve').disabled = false;
    $('check').disabled = false;
    $('loadMsg').textContent = `已讀取：${f.name}`;
  } catch (err) {
    ctx = null;
    $('loadMsg').innerHTML = `<span class="err">讀取失敗：${escapeHtml(err.message)}</span>`;
  }
});

function buildContext(data) {
  if (!data.today) throw new Error('找不到「排班區」的日期（A2）。請先在 Excel 按「編排勤務日期」。');
  const { day, rows } = data.today;
  const labels = rows.slice(0, 9).map((r) => r.label);
  if (FIXED_LABELS.some((l, i) => labels[i] !== l)) throw new Error('「排班區」第 3～11 列不是值班、一救、二救、休息1～4，格式跟 4.2 版不同。');
  const today = data.roster[day];
  if (!today) throw new Error(`月班表找不到 ${day} 日。`);
  const workers = workersOf(today.status);
  const prev = data.roster[day - 1]?.status || null;
  const night = new Set([...nightWorkers(prev)].filter((p) => workers.includes(p)));
  // 本月已排的 08～12 值班時數（存檔區、今天以前）
  const history = {};
  for (const [d, dayRows] of Object.entries(data.days)) {
    if (Number(d) >= day || !dayRows[0]) continue;
    dayRows[0].cells.slice(0, 4).forEach((p) => { if (p !== null) history[p] = (history[p] || 0) + 1; });
  }
  return {
    day, weekday: today.weekday, status: today.status, workers, night, prevKnown: !!prev,
    instructor: data.training[day], history,
    grid: rows.slice(0, 9).map((r) => r.cells.slice()),
    extra: rows.slice(9),
  };
}

function showMeta() {
  const night = [...ctx.night];
  $('meta').innerHTML = [
    `<span><b>${ctx.day} 日 ${escapeHtml(ctx.weekday)}</b></span>`,
    `<span>上班 ${ctx.workers.length} 人：${ctx.workers.join('、')}</span>`,
    `<span>外勤 ${ctx.extra.length} 列</span>`,
    ctx.prevKnown ? `<span>昨天 B 班／值宿：${night.join('、') || '無'}</span>`
      : '<span class="warn">月初第 1 天讀不到昨天的月班表，請自行確認 B 班、值宿的人 12 時前沒排勤務。</span>',
    ctx.instructor ? `<span>救護訓練教官：${ctx.instructor}</span>` : '',
  ].join('');
}

$('solve').addEventListener('click', async () => {
  if (!ctx) return;
  busy(true, '計算中…');
  try {
    const highs = await highsReady;
    const t0 = performance.now();
    const res = solve(highs, ctx);
    if (!res.grid) {
      $('status').innerHTML = `<span class="err">排不出來（${escapeHtml(res.status)}）。請檢查預排的格子是否互相衝突。</span>`;
      return;
    }
    result = res.grid;
    render(result, ctx.grid);
    $('status').textContent = `完成，用了 ${Math.round(performance.now() - t0)} 毫秒。`;
  } catch (err) {
    $('status').innerHTML = `<span class="err">發生錯誤：${escapeHtml(err.message)}</span>`;
  } finally {
    busy(false);
  }
});

$('check').addEventListener('click', () => {
  if (!ctx) return;
  result = ctx.grid.map((r) => r.slice());
  render(result, ctx.grid);
  $('status').textContent = '已檢查目前排班區的內容（沒有補空缺）。';
});

$('copy').addEventListener('click', async () => {
  if (!result) return;
  const tsv = result.map((row) => row.map((p) => (p === null ? '' : p)).join('\t')).join('\r\n');
  try {
    await navigator.clipboard.writeText(tsv);
    $('status').textContent = '已複製。請到 Excel 排班區點 B3，按 Ctrl+V 貼上。';
  } catch {
    $('status').innerHTML = '<span class="err">瀏覽器不允許自動複製，請改用 Chrome 或 Edge 再試一次。</span>';
  }
});

function render(grid, before) {
  const head = `<tr><th>勤務</th>${HOURS.map((h) => `<th>${h}</th>`).join('')}</tr>`;
  const body = grid.map((row, r) => `<tr${r === 5 ? ' class="sep"' : ''}><td>${ROW_NAMES[r]}</td>${row.map((p, h) => {
    const isNew = before[r][h] === null && p !== null;
    return `<td${isNew ? ' class="new"' : ''}>${p ?? ''}</td>`;
  }).join('')}</tr>`).join('');
  const ext = ctx.extra.map((e, i) => `<tr${i === 0 ? ' class="sep"' : ''}><td title="${escapeHtml(e.label)}">${escapeHtml(e.label.slice(0, 8))}</td>${e.cells.map((p) => `<td class="ext">${p ?? ''}</td>`).join('')}</tr>`).join('');
  $('table').innerHTML = head + body + ext;

  const errs = check(grid, ctx);
  const warn = errs.filter((e) => e.code === 'C19');
  const bad = errs.filter((e) => e.code !== 'C19');
  // 違規只牽涉到預排的格子（不是程式補的），標示出來，方便判斷要改哪裡
  const added = new Set();
  const addedDuty = new Set();
  grid.forEach((row, r) => row.forEach((p, h) => {
    if (before[r][h] !== null || p === null) return;
    added.add(`${p},${h}`);
    if (r <= 4) addedDuty.add(`${p},${h}`);
  }));
  const fromFixed = (e) => {
    if (e.p === undefined) return true;
    const pool = ['C03', 'C07', 'C10'].includes(e.code) ? addedDuty : added;
    return e.h !== undefined ? !pool.has(`${e.p},${e.h}`) : ![...pool].some((k) => k.startsWith(`${e.p},`));
  };
  const items = [
    ...bad.map((e) => `<li class="err">${e.code}：${escapeHtml(e.msg)}${fromFixed(e) ? '（來自預排的格子）' : ''}</li>`),
    ...warn.map((e) => `<li class="warn">${e.code}：${escapeHtml(e.msg)}</li>`),
  ];
  if (!bad.length) items.unshift('<li class="ok">值班、救護、休息都符合限制式。</li>');
  if (grid[DUTY].slice(0, 4).every((p) => p !== null) && new Set(grid[DUTY].slice(0, 4)).size > 1) {
    items.push('<li class="warn">C20：08～12 值班沒有由同一人連續 4 小時（提醒）</li>');
  }
  $('msgs').innerHTML = items.join('');
  $('resultCard').hidden = false;
  $('copy').disabled = false;
}

function busy(on, msg = '') {
  $('solve').disabled = on;
  $('check').disabled = on;
  if (msg) $('status').textContent = msg;
}

function reset() {
  ctx = null;
  result = null;
  $('meta').innerHTML = '';
  $('status').textContent = '';
  $('resultCard').hidden = true;
  ['solve', 'check', 'copy'].forEach((id) => { $(id).disabled = true; });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
