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
      req.then(s => { me = s; store.set('me', JSON.stringify(s)); route('read'); })
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
    ({ read: pageRead, accounts: pageAccounts, log: pageLog, password: pagePassword })[id](document.getElementById('main'));
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
    // 番號依十位數分組上色（個位數＝幹部、1x、2x、3x、4x…），同 4.2 版月班表
    const grp = p => `g${Math.min(Math.floor(p.num / 10), 5)}`;
    const WEEK = '日一二三四五六';
    const weekday = date => WEEK[new Date(date + 'T00:00:00Z').getUTCDay()];
    const nums = d.month.people.map(p => `<th class="${grp(p)}">${esc(p.num)}</th>`).join('');
    const names = d.month.people.map(p => `<th class="${grp(p)} name">${[...p.name].map(esc).join('<br>')}</th>`).join('');
    const body = d.month.days.map(day => {
      const w = weekday(day.date);
      return `<tr class="${day.date === d.date ? 'today' : ''}"><td>${Number(day.date.slice(8))}</td><td class="${w === '六' || w === '日' ? 'wkend' : ''}">${w}</td>` +
        day.codes.map((c, i) => (c == null ? '<td class="off">—</td>' : `<td class="${grp(d.month.people[i])}">${esc(c)}</td>`)).join('') + '</tr>';
    }).join('');
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
      <div class="card"><h2>${yy} 年 ${mm} 月 月班表</h2><div class="scroll"><table class="roster">
        <tr><th rowspan="2">日</th><th rowspan="2">星期</th>${nums}</tr><tr>${names}</tr>${body}</table></div></div>`;
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
  if (me && me.token) route('read');
  else api('needsSetup').then(loginForm).catch(e => { app.textContent = '錯誤：' + e.message; });
})();
