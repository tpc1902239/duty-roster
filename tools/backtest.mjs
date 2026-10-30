// 用 node 回測：node tools/backtest.mjs 9月.xlsm 10月.xlsm
// 與 prototype/verify.py 相同：只留月班表帶入的格子和外勤列，其餘交給程式補。
import fs from 'node:fs';
import XLSX from 'xlsx';
import highsLoader from 'highs';
import { loadWorkbook, nightWorkers, workersOf } from '../docs/lib/roster.js';
import { prefill, solve, DUTY } from '../docs/lib/solver.js';
import { check } from '../docs/lib/check.js';

const highs = await highsLoader();
const months = process.argv.slice(2).map((f) => loadWorkbook(XLSX.read(fs.readFileSync(f))));
const tot = { days: 0, clean: 0, fixedOnly: 0, solver: 0, fail: 0, four: 0 };
let maxMs = 0;
months.forEach((mo, mi) => {
  const hist = {};
  for (const d of Object.keys(mo.days).map(Number).sort((a, b) => a - b)) {
    let prev;
    if (mo.roster[d - 1]) prev = mo.roster[d - 1].status;
    else if (mi > 0 && d === 1) { const pr = months[mi - 1].roster; prev = pr[Math.max(...Object.keys(pr).map(Number))].status; }
    else continue;
    const st = mo.roster[d].status;
    const workers = workersOf(st);
    const night = new Set([...nightWorkers(prev)].filter((p) => workers.includes(p)));
    const instructor = mo.training[d];
    const extra = mo.days[d].slice(9);
    const grid = prefill(st);
    const busy = new Set();
    extra.forEach((e) => e.cells.forEach((p, h) => { if (p !== null) busy.add(`${p},${h}`); }));
    for (let r = 0; r < 9; r++) for (let h = 0; h < 24; h++) if (grid[r][h] !== null && busy.has(`${grid[r][h]},${h}`)) grid[r][h] = null;
    const t0 = Date.now();
    const res = solve(highs, { workers, grid, extra, night, instructor, history: hist });
    const ms = Date.now() - t0;
    maxMs = Math.max(maxMs, ms);
    tot.days++;
    if (!res.grid) { tot.fail++; console.log(`M${mi} D${d} 無解 ${res.status}`); continue; }
    const out = res.grid;
    for (let h = 0; h < 4; h++) if (out[DUTY][h] !== null) hist[out[DUTY][h]] = (hist[out[DUTY][h]] || 0) + 1;
    if (new Set(out[DUTY].slice(0, 4)).size === 1) tot.four++;
    const filled = new Set(), filledDuty = new Set();
    for (let r = 0; r < 9; r++) for (let h = 0; h < 24; h++) if (grid[r][h] === null && out[r][h] !== null) {
      filled.add(`${out[r][h]},${h}`);
      if (r <= 4) filledDuty.add(`${out[r][h]},${h}`);
    }
    const errs = check(out, { extra, workers, night, instructor }).filter((e) => e.code !== 'C19');
    const mine = errs.filter((e) => {
      const hs = e.h !== undefined ? [e.h] : ({ C10: [0, 1, 2, 3], C07: [7, 8, 9] }[e.code] || [...Array(24).keys()]);
      const pool = ['C10', 'C07', 'C03'].includes(e.code) ? filledDuty : filled;
      return e.p !== undefined && hs.some((h) => pool.has(`${e.p},${h}`));
    });
    if (!errs.length) tot.clean++;
    else if (!mine.length) tot.fixedOnly++;
    else { tot.solver++; console.log(`M${mi} D${d}`, mine.map((e) => e.msg)); }
  }
  const vals = Object.values(hist);
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  const sd = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length);
  console.log(`M${mi} 08-12值班：${vals.length}人，最多${Math.max(...vals)}小時，最少${Math.min(...vals)}，標準差${sd.toFixed(2)}`);
});
console.log(tot, `最慢 ${maxMs} ms`);
