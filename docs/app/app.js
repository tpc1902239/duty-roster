// 智能勤務表：在 Apps Script 網頁裡執行的主程式（由 Index.html 從 GitHub Pages 載入）。
// 後台函式用 window.api('函式名', ...參數) 呼叫，回傳 Promise。
(() => {
  const app = document.getElementById('app');
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const store = {
    get: k => { try { return sessionStorage.getItem(k); } catch (e) { return null; } },
    set: (k, v) => { try { v === null ? sessionStorage.removeItem(k) : sessionStorage.setItem(k, v); } catch (e) { /* 無痕視窗 */ } },
  };
  let me = null;   // {token, user, name, roles}
  const isAdmin = () => me && me.roles.includes('管理員');
  const call = (fn, ...args) => api(fn, me.token, ...args).catch(e => {
    if (/登入已過期/.test(e.message)) { logout(); }
    throw e;
  });

  // ---------- 登入 ----------

  function loginForm(setup) {
    app.innerHTML = `<div class="card narrow">
      <h1>智能勤務表</h1>
      <div class="muted">${setup ? '第一次使用：請建立管理員帳號。' : '請登入。'}</div>
      <label class="f">帳號<input id="u" autocomplete="username"></label>
      ${setup ? '<label class="f">姓名<input id="n"></label>' : ''}
      <label class="f">密碼<input id="p" type="password" autocomplete="${setup ? 'new-password' : 'current-password'}"></label>
      <div class="err" id="e"></div>
      <button id="go">${setup ? '建立並登入' : '登入'}</button></div>`;
    const go = () => {
      const u = app.querySelector('#u').value.trim(), p = app.querySelector('#p').value;
      const req = setup ? api('setupAdmin', u, app.querySelector('#n').value.trim(), p) : api('login', u, p);
      app.querySelector('#e').textContent = '';
      req.then(s => { me = s; store.set('me', JSON.stringify(s)); route('month'); })
         .catch(e => { app.querySelector('#e').textContent = e.message; });
    };
    app.querySelector('#go').onclick = go;
    app.querySelector('#p').onkeydown = e => { if (e.key === 'Enter') go(); };
  }

  function logout() {
    if (me) api('logout', me.token);
    me = null; store.set('me', null);
    loginForm(false);
  }

  // ---------- 外框 ----------

  const PAGES = [
    { id: 'month', name: '月班表', show: () => true },
    { id: 'shiftdefs', name: '固定排班設定', show: () => true },
    { id: 'staff', name: '編制人員', show: () => true },
    { id: 'leave', name: '匯入假表', show: () => has('假表承辦') },
    { id: 'tables', name: '車輛／救護訓練', show: () => has('車輛承辦') || has('救護訓練承辦') },
    { id: 'read', name: '讀取測試', show: () => true },
    { id: 'accounts', name: '帳號管理', show: isAdmin },
    { id: 'log', name: '操作紀錄', show: isAdmin },
    { id: 'password', name: '改密碼', show: () => true },
  ];

  function route(id) {
    app.innerHTML = `<header><span class="brand">智能勤務表</span><nav>${
      PAGES.filter(p => p.show()).map(p => `<a data-p="${p.id}" class="${p.id === id ? 'on' : ''}">${p.name}</a>`).join('')
    }<a data-p="logout">登出</a></nav><span class="who">${esc(me.name)}（${esc(me.roles.join('、'))}）</span></header><main id="main"></main>`;
    app.querySelectorAll('nav a').forEach(a => { a.onclick = () => (a.dataset.p === 'logout' ? logout() : route(a.dataset.p)); });
    ({ month: pageMonth, shiftdefs: pageShiftDefs, staff: pageUnitStaff, leave: pageLeave, tables: pageTables, read: pageRead, accounts: pageAccounts, log: pageLog, password: pagePassword })[id](document.getElementById('main'));
  }

  // ---------- 讀取測試 ----------

  function pageRead(main) {
    main.innerHTML = `<h1>讀取測試</h1><div class="muted">確認資料庫和日曆讀得到。這頁只讀資料。</div>
      <div class="card"><input type="date" id="date"> <button id="go">讀取</button> <span id="msg" class="muted"></span></div><div id="out"></div>`;
    const $ = s => main.querySelector(s);
    $('#date').value = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
    $('#go').onclick = () => {
      $('#msg').textContent = '讀取中…';
      call('loadDay', $('#date').value).then(d => { $('#msg').textContent = ''; $('#out').innerHTML = renderDay(d); })
        .catch(e => { $('#msg').textContent = '錯誤：' + e.message; });
    };
  }

  function renderDay(d) {
    const num = Object.fromEntries(d.month.people.map(p => [p.name, p.num]));
    const ev = d.events.map(e => `<tr class="${e.unknown.length ? 'warn' : ''}">
        <td>${esc(e.kind)}</td><td class="l">${esc(e.duty)}</td>
        <td>${e.start == null ? '' : esc(e.start + '–' + e.end)}</td>
        <td>${e.people.map(n => esc(num[n] + '.' + n)).join('、')}</td>
        <td>${e.unknown.map(esc).join('、')}</td><td class="l muted">${esc(e.title)}</td></tr>`).join('');
    const [yy, mm] = d.date.split('-').map(Number);
    return `
      <div class="card"><h2>${esc(d.date)} 在隊 ${d.here.length} 人</h2>
        <div>${d.here.map(p => esc(p.num + '.' + p.name)).join('　')}</div>
        ${d.away.length ? `<div class="muted">不在隊：${d.away.map(a => esc(a.num + '.' + a.name)).join('、')}</div>` : ''}
      </div>
      <div class="card"><h2>日曆</h2>
        ${d.events.length ? `<div class="scroll"><table><tr><th>類型</th><th>勤務</th><th>時間</th><th>人員</th><th>對不到的人名</th><th>原標題</th></tr>${ev}</table></div>`
                          : '<div class="muted">這天日曆沒有活動。</div>'}
      </div>
      <div class="card">${rosterTable(yy, mm, d.month.people, d.month.days.map(day => ({
        d: Number(day.date.slice(8)), codes: day.codes.map(c => c ?? ''), away: day.codes.map(c => c == null) })),
        { today: Number(d.date.slice(8)) })}</div>`;
  }

  // ---------- 共用：月班表表格 ----------

  const WEEK = '日一二三四五六';
    const has = role => me.roles.includes(role) || isAdmin();
  // 番號依十位數分組上色（個位數＝幹部、1x、2x、3x、4x…），同 4.2 版月班表
  const grp = p => `g${Math.min(Math.floor(p.num / 10), 5)}`;
  const weekdayOf = (y, m, d) => WEEK[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  const ym = v => v.split('-').map(Number);
  const nextMonth = () => { const t = new Date(Date.now() + 8 * 3600e3); t.setUTCDate(1); t.setUTCMonth(t.getUTCMonth() + 1); return t.toISOString().slice(0, 7); };

  /**
   * people:[{num,name}]、days:[{d, weekday, codes, away}]
   * opts.today：粗體的日；opts.mark(d, i) 回傳格子額外的 class；opts.title
   */
  // 固定欄寬，讓月班表和已排次數上下對齊：前兩欄（日、星期／標題）＋每人一欄
  const cols = n => `<colgroup><col style="width:24px"><col style="width:26px">${'<col style="width:24px">'.repeat(n)}</colgroup>`;

  function rosterTable(y, m, people, days, opts = {}) {
    const nums = people.map(p => `<th class="${grp(p)}">${esc(p.num)}</th>`).join('');
    const names = people.map(p => `<th class="${grp(p)} name">${[...p.name].map(esc).join('<br>')}</th>`).join('');
    const body = days.map(day => {
      const w = weekdayOf(y, m, day.d);
      return `<tr class="${day.d === opts.today ? 'today' : ''}"><td>${day.d}</td><td class="${w === '六' || w === '日' ? 'wkend' : ''}">${w}</td>` +
        day.codes.map((c, i) => (day.away[i]
          ? `<td class="off" data-d="${day.d}" data-i="${i}">—</td>`
          : `<td class="${grp(people[i])} ${opts.mark ? opts.mark(day.d, i) : ''} ${opts.shift && opts.shift(c) ? 'shift' : ''}" data-d="${day.d}" data-i="${i}">${esc(c)}</td>`)).join('') + '</tr>';
    }).join('');
    return `<h2>${opts.title || `${y}年${m}月班表`}</h2><div class="scroll${opts.grid ? ' gridwrap' : ''}"><table class="roster${opts.grid ? ' grid' : ''}">${opts.grid ? cols(people.length) : ''}
      <tr><th rowspan="2">日</th><th rowspan="2">星期</th>${nums}</tr><tr>${names}</tr>${body}</table></div>`;
  }

  // ---------- 月班表（檢視、填固定排班） ----------

  // 「已排次數」分組：名稱去掉尾巴的數字（A1、A2 → A；B1 → B），有「宿」的都算宿，同 4.2 版月班表下方
  const group = name => (/宿/.test(name) ? '宿' : (name.replace(/\d+$/, '') || name));
  const GROUP_ORDER = ['宿', 'A', 'B'];

  function pageMonth(main) {
    const edit = has('排班');
    main.classList.add('wide');
    main.innerHTML = `<h1>月班表</h1>
      <div class="muted">${edit ? '用法跟 Excel 一樣：點格子或拖曳選範圍，直接打字、Delete 清除、Ctrl+C／Ctrl+V 複製貼上（可以從 Excel 貼一整塊），方向鍵移動；雙擊格子跳出固定排班選單。黑格不能改。改完按「儲存」。'
        : '只能檢視；可以選取後 Ctrl+C 複製。'}</div>
      <div class="card bar"><input type="month" id="mon"> <button class="plain" id="go">重新整理</button>
        ${edit ? '<button id="save" disabled>儲存</button> <button class="plain" id="undo" disabled>放棄修改</button>' : ''}
        <button class="plain" id="cnt">已排次數</button>
        <span id="msg" class="muted"></span></div>
      <div class="card" id="out" hidden></div><div class="card" id="stats" hidden></div><div id="pick" class="picker" hidden></div>`;
    const $ = s => main.querySelector(s);
    $('#mon').value = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 7);
    let data = null, defs = [], before = {}, baseMonth = 0, pending = {};   // pending['d|姓名'] = code
    let sel = null, dragging = false;   // sel = {d0, i0, d1, i1}：選取範圍（d 是日、i 是第幾個人）
    const key = (d, i) => d + '|' + data.people[i].name;
    const orig = (d, i) => data.days[d - 1].codes[i];
    const codeAt = (d, i) => (key(d, i) in pending ? pending[key(d, i)] : orig(d, i));
    const isAway = (d, i) => data.days[d - 1].away[i];
    const names = () => defs.map(x => x.name);
    const td = (d, i) => $(`#out td[data-d="${d}"][data-i="${i}"]`);
    const nDays = () => data.days.length, nPeople = () => data.people.length;

    const refreshButtons = () => {
      const n = Object.keys(pending).length;
      if (edit) { $('#save').disabled = $('#undo').disabled = !n; $('#save').textContent = n ? `儲存（${n} 格）` : '儲存'; }
      if (!$('#stats').hidden) drawStats();
    };
    // 只改那一格，不重畫整張表（畫面才不會跳回左邊）
    const setCell = (d, i, code) => {
      if (!edit || isAway(d, i)) return false;
      code = String(code ?? '').trim();
      if (code === orig(d, i)) delete pending[key(d, i)]; else pending[key(d, i)] = code;
      const c = td(d, i);
      c.textContent = code;
      c.classList.toggle('changed', key(d, i) in pending);
      c.classList.toggle('shift', names().includes(code));
      return true;
    };
    const draw = () => {
      const [y, m] = ym($('#mon').value);
      const wrap = $('#out .scroll'), left = wrap ? wrap.scrollLeft : 0, top = wrap ? wrap.scrollTop : 0;
      const days = data.days.map(day => Object.assign({}, day, { codes: day.codes.map((c, i) => codeAt(day.d, i)) }));
      $('#out').innerHTML = rosterTable(y, m, data.people, days, {
        grid: true, mark: (d, i) => (key(d, i) in pending ? 'changed' : ''), shift: c => names().includes(c) });
      const w = $('#out .scroll');
      w.tabIndex = 0; w.scrollLeft = left; w.scrollTop = top;
      paintSel(); refreshButtons();
    };

    // ---- 選取 ----
    const range = () => sel && { da: Math.min(sel.d0, sel.d1), db: Math.max(sel.d0, sel.d1), ia: Math.min(sel.i0, sel.i1), ib: Math.max(sel.i0, sel.i1) };
    const paintSel = () => {
      main.querySelectorAll('#out td.sel, #out td.cur').forEach(c => c.classList.remove('sel', 'cur'));
      const r = range(); if (!r) return;
      for (let d = r.da; d <= r.db; d++) for (let i = r.ia; i <= r.ib; i++) td(d, i).classList.add('sel');
      const cur = td(sel.d1, sel.i1); cur.classList.add('cur');
      cur.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    };
    const cellOf = e => { const c = e.target.closest('#out td[data-d]'); return c && { d: Number(c.dataset.d), i: Number(c.dataset.i) }; };
    const eachSel = fn => { const r = range(); for (let d = r.da; d <= r.db; d++) for (let i = r.ia; i <= r.ib; i++) fn(d, i); };

    // ---- 打字編輯 ----
    let editing = null;
    const startEdit = (text) => {
      if (!edit || !sel || isAway(sel.d1, sel.i1)) return;
      const { d1: d, i1: i } = sel, c = td(d, i);
      c.innerHTML = '<input class="cell">';
      const inp = c.firstChild;
      inp.value = text ?? codeAt(d, i);
      inp.focus();
      editing = { d, i, inp };
      const done = (save, move) => {
        if (!editing) return;
        editing = null;
        if (!save || !setCell(d, i, inp.value)) c.textContent = codeAt(d, i);
        if (save) refreshButtons();
        if (move) { sel = { d0: Math.min(d + 1, nDays()), i0: i, d1: Math.min(d + 1, nDays()), i1: i }; }
        paintSel(); $('#out .scroll').focus({ preventScroll: true });
      };
      inp.onkeydown = e => {
        e.stopPropagation();
        if (e.key === 'Enter') { e.preventDefault(); done(true, true); }
        else if (e.key === 'Escape') done(false);
        else if (e.key === 'Tab') { e.preventDefault(); done(true); move(0, e.shiftKey ? -1 : 1, false); }
      };
      inp.onblur = () => done(true);
    };
    const move = (dd, di, extend) => {
      if (!sel) return;
      const d1 = Math.max(1, Math.min(nDays(), sel.d1 + dd)), i1 = Math.max(0, Math.min(nPeople() - 1, sel.i1 + di));
      sel = extend ? Object.assign(sel, { d1, i1 }) : { d0: d1, i0: i1, d1, i1 };
      paintSel();
    };

    // ---- 固定排班選單（雙擊） ----
    const picker = (d, i) => {
      if (!edit || isAway(d, i)) return;
      const used = new Set(data.people.map((p, j) => (j === i ? '' : codeAt(d, j))));   // 同一天別人已經選的
      const pick = $('#pick'), r = td(d, i).getBoundingClientRect();
      pick.innerHTML = `<div class="muted">${d} 日 ${esc(data.people[i].name)}</div>` +
        (defs.length ? names().map(c => `<button class="plain" data-c="${esc(c)}" ${used.has(c) ? 'disabled title="這天已經有人選了"' : ''}>${esc(c)}</button>`).join('')
          : '<div class="muted">還沒有固定排班設定</div>') + '<button class="plain" data-c="">清除</button>';
      pick.style.left = Math.min(r.left + scrollX, innerWidth - 260) + 'px';
      pick.style.top = r.bottom + scrollY + 4 + 'px';
      pick.hidden = false;
      pick.onclick = e2 => {
        const b = e2.target.closest('button'); if (!b || b.disabled) return;
        setCell(d, i, b.dataset.c); refreshButtons(); pick.hidden = true; $('#out .scroll').focus({ preventScroll: true });
      };
    };

    $('#out').addEventListener('mousedown', e => {
      if (e.target.closest('input')) return;
      const c = cellOf(e); if (!c) return;
      e.preventDefault();
      $('#out .scroll').focus({ preventScroll: true });
      sel = e.shiftKey && sel ? Object.assign(sel, { d1: c.d, i1: c.i }) : { d0: c.d, i0: c.i, d1: c.d, i1: c.i };
      dragging = true; paintSel();
    });
    $('#out').addEventListener('mouseover', e => {
      if (!dragging) return;
      const c = cellOf(e); if (!c) return;
      Object.assign(sel, { d1: c.d, i1: c.i }); paintSel();
    });
    const up = () => { dragging = false; };
    $('#out').addEventListener('dblclick', e => { const c = cellOf(e); if (c) picker(c.d, c.i); });
    $('#out').addEventListener('keydown', e => {
      if (!sel || editing) return;
      const k = e.key, ctrl = e.ctrlKey || e.metaKey;
      const arrows = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
      if (arrows[k]) { e.preventDefault(); move(...arrows[k], e.shiftKey); }
      else if (k === 'Tab') { e.preventDefault(); move(0, e.shiftKey ? -1 : 1, false); }
      else if (k === 'Enter') { e.preventDefault(); move(e.shiftKey ? -1 : 1, 0, false); }
      else if (k === 'F2') { e.preventDefault(); startEdit(); }
      else if ((k === 'Delete' || k === 'Backspace') && edit) { e.preventDefault(); eachSel((d, i) => setCell(d, i, '')); refreshButtons(); }
      else if (k === 'Escape') { $('#pick').hidden = true; }
      else if (k.length === 1 && !ctrl && !e.altKey && edit) { e.preventDefault(); startEdit(k); }
    });
    // 中文輸入法打字時 keydown 拿不到字，用 compositionstart 先開輸入框
    $('#out').addEventListener('compositionstart', () => { if (!editing && sel && edit) startEdit(''); });
    const onCopy = e => {
      if (!main.isConnected) return document.removeEventListener('copy', onCopy);
      if (!sel || editing || !main.querySelector('#out .scroll:focus')) return;
      const r = range(), rows = [];
      for (let d = r.da; d <= r.db; d++) { const row = []; for (let i = r.ia; i <= r.ib; i++) row.push(isAway(d, i) ? '' : codeAt(d, i)); rows.push(row.join('\t')); }
      e.clipboardData.setData('text/plain', rows.join('\n'));
      e.preventDefault();
      $('#msg').textContent = `已複製 ${(r.db - r.da + 1) * (r.ib - r.ia + 1)} 格。`;
    };
    const onPaste = e => {
      if (!main.isConnected) return document.removeEventListener('paste', onPaste);
      if (!edit || !sel || editing || !main.querySelector('#out .scroll:focus')) return;
      e.preventDefault();
      const text = e.clipboardData.getData('text/plain').replace(/\r/g, '').replace(/\n$/, '');
      const block = text.split('\n').map(r => r.split('\t'));
      const r = range();
      let n = 0, skip = 0;
      if (block.length === 1 && block[0].length === 1) {   // 一格貼到整個選取範圍
        eachSel((d, i) => { setCell(d, i, block[0][0]) ? n++ : skip++; });
      } else {
        block.forEach((row, a) => row.forEach((v, b) => {
          const d = r.da + a, i = r.ia + b;
          if (d > nDays() || i >= nPeople()) return;
          setCell(d, i, v) ? n++ : skip++;
        }));
        sel = { d0: r.da, i0: r.ia, d1: Math.min(nDays(), r.da + block.length - 1), i1: Math.min(nPeople() - 1, r.ia + Math.max(...block.map(x => x.length)) - 1) };
        paintSel();
      }
      refreshButtons();
      $('#msg').textContent = `已貼上 ${n} 格` + (skip ? `，黑格 ${skip} 格沒有改。` : '。');
    };
    const close = e => {   // 換頁後這頁的元素就不在了，順便拿掉監聽
      if (!main.isConnected) { document.removeEventListener('click', close); document.removeEventListener('mouseup', up); return; }
      if (!e.target.closest('#pick, #out td')) $('#pick').hidden = true;
    };
    document.addEventListener('copy', onCopy);
    document.addEventListener('paste', onPaste);
    document.addEventListener('click', close);
    document.addEventListener('mouseup', up);

    // ---- 已排次數：當月（含還沒儲存的修改）＋全年累計，欄位跟月班表一樣 ----
    const drawStats = () => {
      const groups = [...new Set(GROUP_ORDER.concat(names().map(group)))];
      const now = data.people.map(() => ({}));
      data.days.forEach(day => data.people.forEach((p, i) => {
        const c = codeAt(day.d, i);
        if (names().includes(c)) now[i][group(c)] = (now[i][group(c)] || 0) + 1;
      }));
      const total = data.people.map((p, i) => {
        const t = Object.assign({}, now[i]);
        Object.entries(before[p.name] || {}).forEach(([c, n]) => { t[group(c)] = (t[group(c)] || 0) + n; });
        return t;
      });
      const rows = (label, arr, cls) => groups.map((g, k) => `<tr class="${k ? '' : cls}">${k ? '' : `<th rowspan="${groups.length}" class="lbl">${label}</th>`}<th>${esc(g)}</th>` +
        data.people.map((p, i) => `<td class="${grp(p)}">${arr[i][g] || ''}</td>`).join('') + '</tr>').join('');
      const [y] = ym($('#mon').value);
      const wrap = $('#stats .scroll'), left = wrap ? wrap.scrollLeft : 0;
      $('#stats').innerHTML = `<h2>已排次數</h2>
        <div class="muted">全年累計${baseMonth ? `：以累計基準（${y}年1～${baseMonth}月，4.2 版匯入）為準，加減之後或之前各月` : `：${y}年1月起（還沒匯入累計基準）`}，含這個月還沒儲存的修改。</div>
        <div class="scroll"><table class="roster grid stats">${cols(data.people.length)}
        <tr><th colspan="2" class="lbl"></th>${data.people.map(p => `<th class="${grp(p)}">${esc(p.num)}</th>`).join('')}</tr>
        ${rows('當月', now, 'top')}${rows('全年<br>累計', total, 'top')}</table></div>` +
        (edit ? `<p class="muted">匯入累計基準：上傳 4.2 版的月班表檔（例如 10 月），讀它的「累計」宿／A／B 列。
          <label>截至 <input type="number" id="bm" min="1" max="12" value="10" style="width:60px"> 月</label>
          <input type="file" id="bf" accept=".xlsm,.xlsx"></p>` : '');
      $('#stats .scroll').scrollLeft = left;
      if (edit) $('#bf').onchange = () => importBase($('#bf').files[0], Number($('#bm').value));
    };
    const importBase = (file, bm) => {
      if (!file) return;
      const [y, m] = ym($('#mon').value);
      $('#msg').textContent = '讀取中…';
      readBook(file).then(wb => {
        const rows = parseBase(wb);
        if (!confirm(`讀到 ${rows.length} 人的累計（宿／A／B），存成 ${y} 年 1～${bm} 月的累計基準？`)) { $('#msg').textContent = ''; return; }
        return call('saveBase', y, bm, rows).then(r => load(`已存累計基準 ${r.count} 人。`));
      }).catch(e => { $('#msg').textContent = '錯誤：' + e.message; });
    };

    const load = (done = '') => {
      const [y, m] = ym($('#mon').value);
      $('#msg').textContent = '讀取中…'; pending = {}; sel = null;
      Promise.all([call('getMonth', y, m), call('getShiftDefs'), call('getShiftCounts', y, m)]).then(([d, sd, sc]) => {
        data = d; defs = sd.defs; before = sc.before; baseMonth = sc.baseMonth || 0;
        if (!d.exists) { $('#out').hidden = $('#stats').hidden = true; $('#msg').textContent = `${y} 年 ${m} 月還沒有月班表，請先匯入假表。`; return; }
        $('#msg').textContent = done; $('#out').hidden = false; draw();
      }).catch(e => { $('#msg').textContent = '錯誤：' + e.message; });
    };
    $('#go').onclick = () => {
      if (Object.keys(pending).length && !confirm('還有沒儲存的修改，重新整理會放棄，確定嗎？')) return;
      load();
    };
    $('#mon').onchange = () => load();
    $('#cnt').onclick = () => {
      if (!data || !data.exists) return;
      $('#stats').hidden = !$('#stats').hidden;
      if (!$('#stats').hidden) { drawStats(); $('#stats').scrollIntoView({ behavior: 'smooth' }); }
    };
    if (edit) {
      $('#undo').onclick = () => { pending = {}; draw(); };
      $('#save').onclick = () => {
        const [y, m] = ym($('#mon').value);
        const changes = Object.entries(pending).map(([k, code]) => { const [d, name] = k.split('|'); return { d: Number(d), name, code }; });
        $('#msg').textContent = '儲存中…';
        call('saveShifts', y, m, changes, data.version)
          .then(r => load(`已儲存 ${r.saved} 格。`))
          .catch(e => { $('#msg').textContent = '錯誤：' + e.message; });
      };
    }
    load();
  }

  /** 從 4.2 版月班表讀「累計」區的宿／A／B 列：A 欄「累計」那列是宿，往下 B 欄是 A、B 的列。 */
  function parseBase(wb) {
    const name = wb.SheetNames.find(n => /月班表/.test(n)) || wb.SheetNames[0];
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: '' });
    const head = rows.findIndex(r => r.slice(2).filter(v => Number(v) > 0).length >= 5);
    if (head < 0) throw new Error('找不到番號列');
    const start = rows.findIndex(r => String(r[0]).trim() === '累計');
    if (start < 0) throw new Error('找不到 A 欄是「累計」的列');
    const find = label => { for (let r = start; r < Math.min(rows.length, start + 10); r++) if (String(rows[r][1]).trim() === label) return rows[r]; return null; };
    const lines = { '宿': find('宿'), A: find('A'), B: find('B') };
    if (!lines['宿'] || !lines.A || !lines.B) throw new Error('「累計」區找不到宿、A、B 三列');
    const out = [];
    for (let c = 2; c < rows[head].length; c++) {
      const nm = String(rows[head + 1][c] || '').replace(/\s+/g, '');
      if (!(Number(rows[head][c]) > 0) || !nm) continue;
      out.push({ name: nm, '宿': Number(lines['宿'][c]) || 0, A: Number(lines.A[c]) || 0, B: Number(lines.B[c]) || 0 });
    }
    return out;
  }

  // ---------- 編制人員 ----------

  const STAFF_STATUS = ['在隊', '不在隊', '算人力', '不計人力'];

  function pageUnitStaff(main) {
    const edit = isAdmin();
    main.innerHTML = `<h1>編制人員</h1>
      <div class="muted">分隊編制的人員和番號（取代 4.2 版的「番名」）。「限排時間」「限排勤務」是給自動填空用的限制：有勾時間的人只排那些時段，有選勤務的人只排那種勤務；都空白＝不限。</div>
      <div class="card"><div class="scroll" id="list"></div>
        ${edit ? '<p><button class="plain" id="add">＋ 新增</button> <button class="plain" id="fill">從月班表帶入</button> <button id="save">儲存</button> <span id="msg" class="muted"></span></p>'
          : '<p class="muted">只有管理員可以修改。</p>'}</div>`;
    const $ = s => main.querySelector(s);
    let staff = [], version = 0;
    const dis = edit ? '' : 'disabled';
    const draw = () => {
      $('#list').innerHTML = `<table class="defs"><tr><th>姓名</th><th>番號</th><th>在勤狀況</th><th colspan="${HOURS.length}">限排時間</th><th>限排勤務</th>${edit ? '<th></th>' : ''}</tr>
        <tr><th></th><th></th><th></th>${HOURS.map(h => `<th>${h}</th>`).join('')}<th></th>${edit ? '<th></th>' : ''}</tr>` +
        staff.map((p, k) => `<tr data-k="${k}">
          <td><input class="nm" value="${esc(p.name)}" size="5" ${dis}></td>
          <td><input class="no" value="${esc(p.num)}" size="3" inputmode="numeric" ${dis}></td>
          <td><select class="st" ${dis}>${STAFF_STATUS.map(x => `<option ${x === p.status ? 'selected' : ''}>${x}</option>`).join('')}</select></td>
          ${HOURS.map(h => `<td><input type="checkbox" data-h="${h}" ${p.hours.includes(h) ? 'checked' : ''} ${dis}></td>`).join('')}
          <td><select class="kd" ${dis}><option value="">不限</option>${KINDS.map(x => `<option ${x === p.kind ? 'selected' : ''}>${x}</option>`).join('')}</select></td>
          ${edit ? '<td><button class="plain del">刪除</button></td>' : ''}</tr>`).join('') + '</table>' +
        (staff.length ? '' : '<div class="muted">還沒有資料。可以按「從月班表帶入」。</div>');
    };
    const read = () => {
      main.querySelectorAll('tr[data-k]').forEach(tr => {
        const p = staff[Number(tr.dataset.k)];
        p.name = tr.querySelector('.nm').value.trim();
        p.num = tr.querySelector('.no').value.trim();
        p.status = tr.querySelector('.st').value;
        p.kind = tr.querySelector('.kd').value;
        p.hours = [...tr.querySelectorAll('input[data-h]:checked')].map(x => x.dataset.h);
      });
    };
    const load = (done = '') => call('getUnitStaff').then(r => {
      staff = r.staff; version = r.version; draw();
      if ($('#msg')) $('#msg').textContent = done;
    });
    if (edit) {
      $('#add').onclick = () => { read(); staff.push({ name: '', num: '', status: '在隊', hours: [], kind: '' }); draw(); main.querySelector('tr[data-k]:last-child .nm').focus(); };
      $('#fill').onclick = () => {
        read();
        const [y, m] = ym(new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 7));
        call('getMonth', y, m).then(mo => {
          if (!mo.exists) throw new Error(`${y} 年 ${m} 月還沒有月班表`);
          const have = new Set(staff.map(p => p.name));
          const add = mo.people.filter(p => !have.has(p.name));
          add.forEach(p => staff.push({ name: p.name, num: p.num, status: '在隊', hours: [], kind: '' }));
          draw(); $('#msg').textContent = `從 ${m} 月月班表帶入 ${add.length} 人，按「儲存」才會存。`;
        }).catch(e => { $('#msg').textContent = '錯誤：' + e.message; });
      };
      $('#list').onclick = e => {
        const b = e.target.closest('.del'); if (!b) return;
        read(); staff.splice(Number(b.closest('tr').dataset.k), 1); draw();
      };
      $('#save').onclick = () => {
        read(); $('#msg').textContent = '儲存中…';
        call('saveUnitStaff', staff, version).then(r => load(`已儲存 ${r.count} 人。`))
          .catch(e => { $('#msg').textContent = '錯誤：' + e.message; });
      };
    }
    load();
  }

  // ---------- 固定排班設定 ----------

  const HOURS = ['08', '09', '10', '11', '12', '13', '14', '15', '16', '17', '18', '19', '20', '21', '22', '23', '00', '01', '02', '03', '04', '05', '06', '07'];
  const KINDS = ['值班', '救護'];

  function pageShiftDefs(main) {
    const edit = has('排班');
    main.innerHTML = `<h1>固定排班設定</h1>
      <div class="muted">月班表點格子時，只會出現這裡設定的名稱。時間從早上 08 到隔天 07，勾選這個班要上的小時。</div>
      <div class="card"><div class="scroll" id="list"></div>
        ${edit ? '<p><button class="plain" id="add">＋ 新增</button> <button id="save">儲存</button> <span id="msg" class="muted"></span></p>' : ''}</div>`;
    const $ = s => main.querySelector(s);
    let defs = [], version = 0;
    const draw = () => {
      $('#list').innerHTML = `<table class="defs"><tr><th>名稱</th>${HOURS.map(h => `<th>${h}</th>`).join('')}<th>勤務別</th>${edit ? '<th></th>' : ''}</tr>` +
        defs.map((d, k) => `<tr data-k="${k}">
          <td><input class="nm" value="${esc(d.name)}" size="5" ${edit ? '' : 'disabled'}></td>
          ${HOURS.map(h => `<td><input type="checkbox" data-h="${h}" ${d.hours.includes(h) ? 'checked' : ''} ${edit ? '' : 'disabled'}></td>`).join('')}
          <td><select class="kd" ${edit ? '' : 'disabled'}>${KINDS.map(x => `<option ${x === d.kind ? 'selected' : ''}>${x}</option>`).join('')}</select></td>
          ${edit ? '<td><button class="plain del">刪除</button></td>' : ''}</tr>`).join('') + '</table>' +
        (defs.length ? '' : '<div class="muted">還沒有設定。</div>');
    };
    const read = () => {   // 畫面上的值讀回 defs
      main.querySelectorAll('tr[data-k]').forEach(tr => {
        const d = defs[Number(tr.dataset.k)];
        d.name = tr.querySelector('.nm').value.trim();
        d.kind = tr.querySelector('.kd').value;
        d.hours = [...tr.querySelectorAll('input[data-h]:checked')].map(x => x.dataset.h);
      });
    };
    const load = (done = '') => call('getShiftDefs').then(r => {
      defs = r.defs; version = r.version; draw();
      if ($('#msg')) $('#msg').textContent = done;
    });
    if (edit) {
      $('#add').onclick = () => { read(); defs.push({ name: '', hours: [], kind: KINDS[0] }); draw(); main.querySelector('tr[data-k]:last-child .nm').focus(); };
      $('#list').onclick = e => {
        const b = e.target.closest('.del'); if (!b) return;
        read(); defs.splice(Number(b.closest('tr').dataset.k), 1); draw();
      };
      $('#save').onclick = () => {
        read(); $('#msg').textContent = '儲存中…';
        call('saveShiftDefs', defs, version).then(r => load(`已儲存 ${r.count} 個。`))
          .catch(e => { $('#msg').textContent = '錯誤：' + e.message; });
      };
    }
    load();
  }

  // ---------- 讀 Excel ----------

  const loadXLSX = () => (window.XLSX ? Promise.resolve() : new Promise((ok, no) => {
    const s = document.createElement('script');
    s.src = new URL('../vendor/xlsx.full.min.js', window.APP_URL).href;
    s.onload = ok; s.onerror = () => no(new Error('Excel 讀取元件載入失敗，請重新整理'));
    document.head.appendChild(s);
  }));

  const readBook = file => loadXLSX().then(() => file.arrayBuffer())
    .then(buf => XLSX.read(buf, { type: 'array', bookFiles: true }));

  const xml = (wb, path) => {
    const f = wb.files && (wb.files[path] || wb.files['/' + path]);
    if (!f) return null;
    const text = typeof f.content === 'string' ? f.content : new TextDecoder().decode(f.content);
    return new DOMParser().parseFromString(text, 'application/xml');
  };
  const byTag = (node, tag) => [...node.getElementsByTagName(tag)];

  /** 找出某張工作表裡底色是黑色的格子（SheetJS 免費版不讀底色，所以直接讀 xlsx 裡的 XML）。 */
  function blackCells(wb, sheetName) {
    const out = new Set();
    const book = xml(wb, 'xl/workbook.xml'), rels = xml(wb, 'xl/_rels/workbook.xml.rels'), styles = xml(wb, 'xl/styles.xml');
    if (!book || !rels || !styles) return out;   // 舊版 .xls 讀不到底色
    const sh = byTag(book, 'sheet').find(s => s.getAttribute('name') === sheetName);
    const rid = sh && (sh.getAttribute('r:id') || sh.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id'));
    const rel = byTag(rels, 'Relationship').find(r => r.getAttribute('Id') === rid);
    if (!rel) return out;
    const target = rel.getAttribute('Target').replace(/^\/?xl\//, '').replace(/^\//, '');
    const sheet = xml(wb, 'xl/' + target);
    if (!sheet) return out;
    const dark = c => {
      if (!c) return false;
      const rgb = c.getAttribute('rgb'), theme = c.getAttribute('theme'), idx = c.getAttribute('indexed');
      const tint = Number(c.getAttribute('tint') || 0);
      if (rgb) { const h = rgb.slice(-6); return [0, 2, 4].every(k => parseInt(h.substr(k, 2), 16) < 64); }
      if (theme === '1') return tint < 0.3;      // 佈景主題「文字 1」= 黑
      return idx === '8' || idx === '64';
    };
    const fills = byTag(byTag(styles, 'fills')[0] || styles, 'fill').map(f => {
      const p = byTag(f, 'patternFill')[0];
      return !!p && p.getAttribute('patternType') === 'solid' && dark(byTag(p, 'fgColor')[0]);
    });
    const xfs = byTag(byTag(styles, 'cellXfs')[0] || styles, 'xf').map(x => fills[Number(x.getAttribute('fillId') || 0)]);
    byTag(sheet, 'c').forEach(c => { if (xfs[Number(c.getAttribute('s') || 0)]) out.add(c.getAttribute('r')); });
    return out;
  }

  /** 從假表（4.2 版月班表格式）讀出 {people, days, sheet}。 */
  function parseLeave(wb) {
    const name = wb.SheetNames.find(n => /月班表|假表/.test(n)) || wb.SheetNames[0];
    const ws = wb.Sheets[name];
    const range = XLSX.utils.decode_range(ws['!ref']);
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });
    const isNum = v => v !== '' && !isNaN(Number(v)) && Number(v) > 0;
    const head = rows.findIndex(r => r.slice(2).filter(isNum).length >= 5);
    if (head < 0) throw new Error(`「${name}」找不到番號列（C 欄起一排數字）`);
    const people = [];
    for (let c = 2; c < rows[head].length && isNum(rows[head][c]); c++) {
      people.push({ num: Number(rows[head][c]), name: String(rows[head + 1][c] || '').replace(/\s+/g, ''), c });
    }
    const black = blackCells(wb, name);
    const days = [];
    for (let r = head + 2; r < rows.length; r++) {
      const d = Number(rows[r][0]);
      if (!d || d > 31 || String(rows[r][1]).trim() === '') continue;
      days.push({
        d, weekday: String(rows[r][1]).trim(),
        codes: people.map(p => String(rows[r][p.c] ?? '').trim()),
        away: people.map(p => black.has(XLSX.utils.encode_cell({ r: r + range.s.r, c: p.c + range.s.c }))),
      });
    }
    if (people.some(p => !p.name)) throw new Error('番號下一列要是姓名，有些番號沒有姓名');
    return { sheet: name, people: people.map(({ num, name }) => ({ num, name })), days };
  }

  // ---------- 匯入假表 ----------

  function pageLeave(main) {
    main.innerHTML = `<h1>匯入假表</h1>
      <div class="muted">上傳假表 Excel（格式同 4.2 版月班表：第 1 列番號、第 2 列姓名、A 欄日、B 欄星期）。黑色格子＝那天不在隊。<br>
      這個月已經有月班表時，已填的固定排班（A1、B1、宿…）在假表空白的格子會保留。</div>
      <div class="card"><label>月份 <input type="month" id="mon"></label>
        <input type="file" id="file" accept=".xlsx,.xlsm"> <span id="msg" class="muted"></span></div>
      <div class="card" id="out" hidden></div>`;
    const $ = s => main.querySelector(s);
    $('#mon').value = nextMonth();
    let parsed = null;
    $('#file').onchange = () => {
      const f = $('#file').files[0]; if (!f) return;
      $('#msg').textContent = '讀取中…'; $('#out').hidden = true;
      readBook(f).then(wb => {
        parsed = parseLeave(wb);
        const [y, m] = ym($('#mon').value);
        const want = new Date(Date.UTC(y, m, 0)).getUTCDate();
        const blacks = parsed.days.reduce((n, d) => n + d.away.filter(Boolean).length, 0);
        const warn = parsed.days.length !== want ? `<div class="err">注意：假表有 ${parsed.days.length} 天，但 ${m} 月有 ${want} 天，請確認月份。</div>` : '';
        $('#msg').textContent = '';
        $('#out').hidden = false;
        $('#out').innerHTML = `<div>工作表「${esc(parsed.sheet)}」：${parsed.people.length} 人、${parsed.days.length} 天、黑色格子 ${blacks} 格。</div>${warn}
          <p><button id="ok">確認匯入 ${y} 年 ${m} 月</button></p>` + rosterTable(y, m, parsed.people, parsed.days, { title: '預覽' });
        $('#ok').onclick = () => {
          $('#ok').disabled = true; $('#msg').textContent = '匯入中…';
          call('getMonth', y, m)
            .then(cur => call('importLeave', y, m, { people: parsed.people, days: parsed.days }, cur.version))
            .then(r => { $('#msg').textContent = `已匯入 ${y} 年 ${m} 月，保留固定排班 ${r.kept} 格。`; $('#out').hidden = true; })
            .catch(e => { $('#msg').textContent = '錯誤：' + e.message; $('#ok').disabled = false; });
        };
      }).catch(e => { $('#msg').textContent = '錯誤：' + e.message; });
    };
  }

  // ---------- 車輛、救護訓練 ----------

  function pageTables(main) {
    const kinds = [['車輛', '車輛承辦'], ['救護訓練', '救護訓練承辦']].filter(([, r]) => has(r)).map(([k]) => k);
    main.innerHTML = `<h1>車輛／救護訓練</h1>
      <div class="muted">上傳 Excel（格式同 4.2 版的「車輛」「救護訓練」工作表），整張取代這個月的資料。</div>
      <div class="card"><select id="kind">${kinds.map(k => `<option>${k}</option>`).join('')}</select>
        <input type="month" id="mon"> <input type="file" id="file" accept=".xlsx,.xlsm"> <span id="msg" class="muted"></span></div>
      <div class="card" id="out"></div>`;
    const $ = s => main.querySelector(s);
    $('#mon').value = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 7);
    let cur = null;
    const table = rows => rows.length ? `<div class="scroll"><table>${rows.map((r, i) =>
      `<tr>${r.map(v => (i ? `<td class="l">${esc(v)}</td>` : `<th>${esc(v)}</th>`)).join('')}</tr>`).join('')}</table></div>` : '<div class="muted">沒有資料。</div>';
    const load = () => {
      const [y, m] = ym($('#mon').value);
      $('#file').value = '';
      call('getTable', y, m, $('#kind').value).then(t => {
        cur = t;
        $('#out').innerHTML = `<h2>目前的 ${y} 年 ${m} 月${esc($('#kind').value)}</h2>` + (t.exists ? table(t.rows) : '<div class="muted">還沒有資料。</div>');
      }).catch(e => { $('#msg').textContent = '錯誤：' + e.message; });
    };
    $('#kind').onchange = $('#mon').onchange = load;
    $('#file').onchange = () => {
      const f = $('#file').files[0]; if (!f) return;
      const kind = $('#kind').value, [y, m] = ym($('#mon').value);
      readBook(f).then(wb => {
        const name = wb.SheetNames.find(n => n.includes(kind)) || wb.SheetNames[0];
        const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: false, defval: '' })
          .map(r => r.map(v => String(v).trim())).filter(r => r.some(v => v));
        $('#out').innerHTML = `<h2>預覽：工作表「${esc(name)}」，${Math.max(rows.length - 1, 0)} 列</h2>
          <p><button id="ok">儲存為 ${y} 年 ${m} 月${esc(kind)}</button></p>` + table(rows);
        $('#ok').onclick = () => {
          $('#ok').disabled = true; $('#msg').textContent = '儲存中…';
          call('saveTable', y, m, kind, rows, cur.version)
            .then(() => { $('#msg').textContent = '已儲存。'; load(); })
            .catch(e => { $('#msg').textContent = '錯誤：' + e.message; $('#ok').disabled = false; });
        };
      }).catch(e => { $('#msg').textContent = '錯誤：' + e.message; });
    };
    load();
  }

  // ---------- 帳號管理 ----------

  function pageAccounts(main) {
    main.innerHTML = '<h1>帳號管理</h1><div id="list" class="muted">讀取中…</div><div id="edit"></div>';
    const show = data => {
      main.querySelector('#list').innerHTML = `<div class="card"><button id="add">新增帳號</button>
        <div class="scroll" style="margin-top:10px"><table><tr><th>帳號</th><th>姓名</th><th>角色</th><th>狀態</th><th></th></tr>${
          data.accounts.map((a, i) => `<tr><td>${esc(a.user)}</td><td>${esc(a.name)}</td><td class="l">${esc(a.roles.join('、'))}</td>
            <td>${a.active ? '啟用' : '停用'}</td><td><button class="plain" data-i="${i}">修改</button></td></tr>`).join('')
        }</table></div></div>`;
      main.querySelector('#add').onclick = () => edit(data, null);
      main.querySelectorAll('[data-i]').forEach(b => { b.onclick = () => edit(data, data.accounts[b.dataset.i]); });
    };
    const edit = (data, a) => {
      const box = main.querySelector('#edit');
      box.innerHTML = `<div class="card" style="max-width:460px"><h2>${a ? '修改帳號' : '新增帳號'}</h2>
        <label class="f">帳號（英文或數字）<input id="u" value="${esc(a ? a.user : '')}" ${a ? 'disabled' : ''}></label>
        <label class="f">姓名<input id="n" value="${esc(a ? a.name : '')}"></label>
        <div class="chips">角色：${data.roles.map(r => `<label><input type="checkbox" value="${esc(r)}" ${a && a.roles.includes(r) ? 'checked' : ''}> ${esc(r)}</label>`).join('')}</div>
        <label class="chips"><input type="checkbox" id="act" ${!a || a.active ? 'checked' : ''}> 啟用</label>
        <label class="f">${a ? '重設密碼（不改就留空）' : '密碼（至少 8 個字）'}<input id="p" type="password" autocomplete="new-password"></label>
        <div class="err" id="e"></div><button id="save">儲存</button> <button class="plain" id="cancel">取消</button></div>`;
      const $ = s => box.querySelector(s);
      $('#cancel').onclick = () => { box.innerHTML = ''; };
      $('#save').onclick = () => {
        call('saveAccount', {
          user: $('#u').value.trim(), name: $('#n').value.trim(), password: $('#p').value, active: $('#act').checked,
          roles: [...box.querySelectorAll('.chips input[value]:checked')].map(x => x.value),
        }).then(d => { box.innerHTML = ''; show(d); }).catch(e => { $('#e').textContent = e.message; });
      };
    };
    call('listAccounts').then(show).catch(e => { main.querySelector('#list').textContent = '錯誤：' + e.message; });
  }

  // ---------- 操作紀錄 ----------

  function pageLog(main) {
    main.innerHTML = '<h1>操作紀錄</h1><div class="muted">最近 100 筆。</div><div id="out" class="muted">讀取中…</div>';
    call('recentLog', 100).then(rows => {
      main.querySelector('#out').innerHTML = `<div class="card scroll"><table><tr><th>時間</th><th>帳號</th><th>動作</th><th>內容</th></tr>${
        rows.map(r => `<tr><td>${esc(r.time)}</td><td>${esc(r.user)}</td><td>${esc(r.action)}</td><td class="l">${esc(r.detail)}</td></tr>`).join('')
      }</table></div>`;
    }).catch(e => { main.querySelector('#out').textContent = '錯誤：' + e.message; });
  }

  // ---------- 改密碼 ----------

  function pagePassword(main) {
    main.innerHTML = `<div class="card narrow" style="margin-top:0"><h1>改密碼</h1>
      <label class="f">原密碼<input id="o" type="password" autocomplete="current-password"></label>
      <label class="f">新密碼（至少 8 個字）<input id="n" type="password" autocomplete="new-password"></label>
      <div class="err" id="e"></div><button id="go">變更</button></div>`;
    const $ = s => main.querySelector(s);
    $('#go').onclick = () => call('changePassword', $('#o').value, $('#n').value)
      .then(() => { $('#e').textContent = '已變更。'; $('#o').value = $('#n').value = ''; })
      .catch(e => { $('#e').textContent = e.message; });
  }

  // ---------- 開始 ----------

  try { me = JSON.parse(store.get('me')); } catch (e) { me = null; }
  if (me && me.token) route('month');
  else api('needsSetup').then(loginForm).catch(e => { app.textContent = '錯誤：' + e.message; });
})();
