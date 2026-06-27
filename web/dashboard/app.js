// nagadb console — vanilla JS, talks to the std-lib HTTP API.

const $ = (id) => document.getElementById(id);

// ---- API helpers -----------------------------------------------------------
const api = {
  async list() {
    const r = await fetch('/api/list');
    if (!r.ok) throw new Error('list failed');
    return r.json();
  },
  async stats() {
    const r = await fetch('/api/stats');
    if (!r.ok) throw new Error('stats failed');
    return r.json();
  },
  async get(key) {
    const r = await fetch('/api/get?key=' + encodeURIComponent(key));
    if (!r.ok) throw new Error('get failed');
    return r.json();
  },
  async put(key, value) {
    const r = await fetch('/api/put', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'key=' + encodeURIComponent(key) + '&value=' + encodeURIComponent(value),
    });
    return r.json();
  },
  async del(key) {
    const r = await fetch('/api/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'key=' + encodeURIComponent(key),
    });
    return r.json();
  },
  async flush() {
    const r = await fetch('/api/flush', { method: 'POST' });
    return r.json();
  },
  async compact() {
    const r = await fetch('/api/compact', { method: 'POST' });
    return r.json();
  },
};

function esc(s) {
  return String(s)
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

// ---- Navigation ------------------------------------------------------------
const views = ['overview', 'data', 'query', 'monitoring', 'settings'];
const titles = { overview: 'Overview', data: 'Data', query: 'Query', monitoring: 'Monitoring', settings: 'Settings' };

function showView(name) {
  views.forEach((v) => $('view-' + v).classList.toggle('hidden', v !== name));
  document.querySelectorAll('.nav-item').forEach((b) =>
    b.classList.toggle('active', b.dataset.view === name));
  $('crumbView').textContent = titles[name];
  if (name === 'overview') refreshOverview();
  if (name === 'data') refreshData();
  if (name === 'monitoring') refreshMonitoring();
}

document.querySelectorAll('.nav-item').forEach((btn) =>
  btn.addEventListener('click', () => showView(btn.dataset.view)));

// ---- Connection indicator --------------------------------------------------
async function ping() {
  try {
    await api.stats();
    $('connDot').className = 'dot up';
    $('connText').textContent = 'connected';
    $('statStatus').textContent = '●';
    $('statStatusText').textContent = 'online';
    return true;
  } catch {
    $('connDot').className = 'dot down';
    $('connText').textContent = 'offline';
    $('statStatusText').textContent = 'offline';
    return false;
  }
}

// ---- Overview --------------------------------------------------------------
async function refreshOverview() {
  try {
    const s = await api.stats();
    $('statKeys').textContent = s.entries;
    $('statSstables').textContent = s.sstables;
  } catch {
    $('statKeys').textContent = '–';
    $('statSstables').textContent = '–';
  }
}

$('quickForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = $('quickMsg');
  const key = $('qKey').value.trim();
  const value = $('qValue').value;
  if (!key) { msg.className = 'form-msg err'; msg.textContent = 'Key is required.'; return; }
  await api.put(key, value);
  $('qKey').value = ''; $('qValue').value = ''; $('qKey').focus();
  msg.className = 'form-msg ok'; msg.textContent = 'Saved ' + key;
  refreshOverview();
});

// ---- Data ------------------------------------------------------------------
let dataCache = [];

async function refreshData() {
  try {
    dataCache = await api.list();
  } catch {
    dataCache = [];
  }
  renderData();
}

function renderData() {
  const q = $('search').value.trim().toLowerCase();
  const rows = dataCache.filter(
    (it) => !q || it.key.toLowerCase().includes(q) || it.value.toLowerCase().includes(q));
  const tbody = $('dataRows');
  tbody.innerHTML = '';
  $('dataCount').textContent = rows.length + (rows.length === 1 ? ' row' : ' rows');
  $('dataEmpty').style.display = rows.length ? 'none' : 'block';
  for (const it of rows) {
    const tr = document.createElement('tr');
    tr.innerHTML =
      '<td class="cell-key">' + esc(it.key) + '</td>' +
      '<td class="cell-val">' + esc(it.value) + '</td>' +
      '<td class="cell-actions">' +
        '<button class="btn ghost sm edit" data-key="' + esc(it.key) + '" data-val="' + esc(it.value) + '">Edit</button> ' +
        '<button class="btn del sm" data-key="' + esc(it.key) + '">Delete</button>' +
      '</td>';
    tbody.appendChild(tr);
  }
}

$('search').addEventListener('input', renderData);

$('addRowBtn').addEventListener('click', () => {
  showView('overview');
  $('qKey').focus();
});

$('dataRows').addEventListener('click', async (e) => {
  const del = e.target.closest('.del');
  const edit = e.target.closest('.edit');
  if (del) {
    await api.del(del.dataset.key);
    refreshData();
  } else if (edit) {
    showView('overview');
    $('qKey').value = edit.dataset.key;
    $('qValue').value = edit.dataset.val;
    $('qValue').focus();
  }
});

// ---- Query console ---------------------------------------------------------
const out = $('consoleOut');
const history = [];
let histIdx = -1;

function print(text, cls = 'res') {
  const span = document.createElement('span');
  span.className = cls;
  span.textContent = text + '\n';
  out.appendChild(span);
  out.scrollTop = out.scrollHeight;
}

function printJSON(obj) { print(JSON.stringify(obj, null, 2), 'res'); }

const HELP = `Commands:
  get <key>            look up a key
  put <key> <value>    set a key (value may contain spaces)
  delete <key>         remove a key
  scan                 list all key/value pairs
  flush                flush memtable -> SSTable
  compact              merge all SSTables into one
  stats                show entry & SSTable counts
  clear                clear this console
  help                 show this help`;

async function runCommand(line) {
  print('› ' + line, 'cmd');
  const parts = line.trim().split(/\s+/);
  const cmd = (parts[0] || '').toLowerCase();
  try {
    switch (cmd) {
      case '': break;
      case 'help': print(HELP, 'info'); break;
      case 'clear': out.innerHTML = ''; break;
      case 'scan': {
        const items = await api.list();
        if (!items.length) { print('(empty)', 'info'); break; }
        for (const it of items) print(it.key + ' = ' + it.value);
        break;
      }
      case 'stats': printJSON(await api.stats()); break;
      case 'flush': {
        const r = await api.flush();
        print('flushed. sstables now: ' + r.sstables, 'info');
        break;
      }
      case 'compact': {
        const r = await api.compact();
        print('compacted. sstables now: ' + r.sstables, 'info');
        break;
      }
      case 'get': {
        if (parts.length < 2) { print('usage: get <key>', 'err'); break; }
        const r = await api.get(parts[1]);
        print(r.found ? (parts[1] + ' = ' + r.value) : '(not found)', r.found ? 'res' : 'info');
        break;
      }
      case 'put': {
        if (parts.length < 3) { print('usage: put <key> <value>', 'err'); break; }
        const key = parts[1];
        const value = line.slice(line.indexOf(parts[1]) + parts[1].length).trim();
        await api.put(key, value);
        print('OK', 'info');
        break;
      }
      case 'delete': case 'del': {
        if (parts.length < 2) { print('usage: delete <key>', 'err'); break; }
        await api.del(parts[1]);
        print('OK', 'info');
        break;
      }
      default: print('unknown command: ' + cmd + ' (type help)', 'err');
    }
  } catch (err) {
    print('error: ' + err.message, 'err');
  }
}

$('consoleInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    const line = e.target.value;
    if (line.trim()) { history.push(line); histIdx = history.length; }
    e.target.value = '';
    runCommand(line);
  } else if (e.key === 'ArrowUp') {
    if (histIdx > 0) { histIdx--; e.target.value = history[histIdx]; }
    e.preventDefault();
  } else if (e.key === 'ArrowDown') {
    if (histIdx < history.length - 1) { histIdx++; e.target.value = history[histIdx]; }
    else { histIdx = history.length; e.target.value = ''; }
    e.preventDefault();
  }
});

// ---- Monitoring ------------------------------------------------------------
const samples = [];
let monTimer = null;

async function refreshMonitoring() {
  try {
    const s = await api.stats();
    $('monKeys').textContent = s.entries;
    $('monSstables').textContent = s.sstables;
    $('monTime').textContent = new Date().toLocaleTimeString();
    samples.push(s.entries);
    if (samples.length > 40) samples.shift();
    renderSpark();
  } catch { /* offline */ }
}

function renderSpark() {
  const spark = $('spark');
  const max = Math.max(1, ...samples);
  spark.innerHTML = '';
  for (const v of samples) {
    const bar = document.createElement('div');
    bar.className = 'bar';
    bar.style.height = (6 + (v / max) * 84) + 'px';
    spark.appendChild(bar);
  }
}

// Maintenance buttons (flush / compact).
$('flushBtn').addEventListener('click', async () => {
  const msg = $('maintMsg');
  try {
    const r = await api.flush();
    msg.className = 'form-msg ok';
    msg.textContent = 'Flushed. SSTables now: ' + r.sstables;
  } catch (e) {
    msg.className = 'form-msg err';
    msg.textContent = 'Flush failed: ' + e.message;
  }
  refreshMonitoring();
  refreshOverview();
});

$('compactBtn').addEventListener('click', async () => {
  const msg = $('maintMsg');
  try {
    const r = await api.compact();
    msg.className = 'form-msg ok';
    msg.textContent = 'Compacted. SSTables now: ' + r.sstables;
  } catch (e) {
    msg.className = 'form-msg err';
    msg.textContent = 'Compact failed: ' + e.message;
  }
  refreshMonitoring();
  refreshOverview();
});

// Poll monitoring while the page is open.
monTimer = setInterval(() => {
  if (!$('view-monitoring').classList.contains('hidden')) refreshMonitoring();
  ping();
}, 4000);

// ---- Global refresh button -------------------------------------------------
$('refreshBtn').addEventListener('click', () => {
  ping();
  refreshOverview();
  refreshData();
  refreshMonitoring();
});

// ---- Boot ------------------------------------------------------------------
(async function boot() {
  await ping();
  showView('overview');
  print('nagadb console ready. Type "help".', 'info');
})();
