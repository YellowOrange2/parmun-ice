/* =========================================================
 * Pabrik Ops PWA — single-file vanilla JS app.
 * Sections: utils, API client, queue, state, renderers, router, init.
 * ========================================================= */

// ---------- utils ----------

const $ = sel => document.querySelector(sel);
const el = (tag, attrs = {}, children = []) => {
  const e = document.createElement(tag);
  for (const k in attrs) {
    if (k === 'class') e.className = attrs[k];
    else if (k === 'html') e.innerHTML = attrs[k];
    else if (k.startsWith('on') && typeof attrs[k] === 'function') e.addEventListener(k.slice(2), attrs[k]);
    else if (attrs[k] !== false && attrs[k] !== null && attrs[k] !== undefined) e.setAttribute(k, attrs[k]);
  }
  (Array.isArray(children) ? children : [children]).forEach(c => {
    if (c == null) return;
    e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  });
  return e;
};

const uuid = () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
  const r = Math.random() * 16 | 0;
  return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
});

const fmtInt = n => (n == null || isNaN(n)) ? '—' : Math.round(n).toLocaleString('en-US');
const fmtNum = (n, d = 2) => (n == null || isNaN(n)) ? '—' : Number(n).toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d });
const fmtPct = n => (n == null || isNaN(n)) ? '—' : (n * 100).toFixed(1) + '%';
const fmtMoney = n => (n == null || isNaN(n)) ? '—' : 'Rp ' + Math.round(n).toLocaleString('id-ID');

const todayLocalIso = () => {
  const d = new Date();
  const tz = d.getTimezoneOffset();
  return new Date(d.getTime() - tz * 60000).toISOString().slice(0, 16); // for datetime-local
};
const currentMonth = () => new Date().toISOString().slice(0, 7);

const toast = (msg, kind = '') => {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast show ' + kind;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { t.className = 'toast ' + kind; }, 2400);
};

// ---------- API client ----------
// Apps Script web apps don't accept custom headers without preflight pain,
// so we use plain GET with a JSON-encoded `p` param, or POST as text/plain.

async function apiCall(action, payload = {}) {
  const cfg = window.CONFIG;
  if (!cfg.API_URL || cfg.API_URL.includes('PASTE_YOUR')) {
    throw new Error('API_URL not configured in config.js');
  }
  const secret = localStorage.getItem('secret') || '';
  const body = JSON.stringify(Object.assign({ action, secret }, payload));
  const res = await fetch(cfg.API_URL, {
    method: 'POST',
    // text/plain dodges CORS preflight for Apps Script.
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'unknown error');
  return data;
}

// ---------- offline queue ----------
// Failed addEntry calls are stored locally and retried on next online tick.
// Each queued item has a stable id so the server dedupes if it actually went through.

const QUEUE_KEY = 'pabrik_queue_v1';
const queue = {
  read() { try { return JSON.parse(localStorage.getItem(QUEUE_KEY)) || []; } catch { return []; } },
  write(q) { localStorage.setItem(QUEUE_KEY, JSON.stringify(q)); },
  push(item) { const q = this.read(); q.push(item); this.write(q); updateNetPill(); },
  remove(id) { this.write(this.read().filter(i => i.id !== id)); updateNetPill(); },
  size() { return this.read().length; }
};

async function flushQueue() {
  if (!navigator.onLine) return;
  const items = queue.read();
  for (const item of items) {
    try {
      await apiCall('addEntry', item.payload);
      queue.remove(item.id);
    } catch (err) {
      return; // bail on first failure; we'll try again later
    }
  }
}

function updateNetPill() {
  const p = $('#netStatus');
  const n = queue.size();
  if (!navigator.onLine) { p.className = 'pill pill-bad'; p.textContent = 'offline' + (n ? ` · ${n} queued` : ''); }
  else if (n)            { p.className = 'pill pill-bad'; p.textContent = `${n} queued`; }
  else                   { p.className = 'pill pill-ok';  p.textContent = 'online'; }
}

// ---------- state ----------

const state = {
  view: 'dashboard',
  subEntry: 'kwh_log',
  skus: [],
  dashboard: null,
  month: currentMonth(),
  loading: false
};

// ---------- views: dashboard ----------

function renderDashboard() {
  const root = el('div');

  const head = el('div', { class: 'section-head' }, [
    el('h2', {}, 'Performance'),
    el('div', { class: 'controls' }, [
      el('input', {
        type: 'month',
        value: state.month,
        onchange: e => { state.month = e.target.value; loadDashboard(); }
      })
    ])
  ]);
  root.appendChild(head);

  if (state.loading || !state.dashboard) {
    root.appendChild(el('div', { class: 'loader' }, [
      el('span', { class: 'dot' }), el('span', { class: 'dot' }), el('span', { class: 'dot' }),
      el('span', {}, ' loading metrics…')
    ]));
    return root;
  }

  const d = state.dashboard;
  const t = d.totals;
  const cfg = window.CONFIG;

  const grid = el('div', { class: 'grid' });

  // bag sold
  grid.appendChild(card('Bag sold (month)', fmtInt(t.bagsSoldM), `today: ${fmtInt(t.bagsSoldD)}`, 'accent', '01'));
  // bag prod
  grid.appendChild(card('Bag prod (month)', fmtInt(t.bagsProdM), `today: ${fmtInt(t.bagsProdD)}`, 'accent', '02'));
  // kwh / bag
  grid.appendChild(card('kWh / bag', fmtNum(t.kwhPerBagM, 3), `total kWh: ${fmtNum(t.kwhM, 1)}`, '', '03'));
  // stock placeholder
  grid.appendChild(card('Bag stock', '—', 'tracking soon', '', '04'));
  // bags per wage — show inverse (wage per bag) as primary since it reads better
  grid.appendChild(card('Wage / bag', fmtMoney(t.wagePerBagM), `wage: ${fmtMoney(t.wageM)}`, '', '05'));
  // plastic loss
  const lossKind = (t.lossPctM != null && t.lossPctM > cfg.LOSS_RED_THRESHOLD) ? 'bad'
                 : (t.lossPctM != null && t.lossPctM < 0) ? 'good'
                 : '';
  grid.appendChild(card('Plastic loss', fmtPct(t.lossPctM), `${fmtInt(t.lossPcsM)} pcs · ${fmtNum(t.plasticKgM, 1)} kg`, lossKind, '06'));

  root.appendChild(grid);

  // per-SKU table
  if (d.perSku.length) {
    root.appendChild(el('div', { class: 'section-head', style: 'margin-top:22px;' }, [el('h2', {}, 'Per SKU')]));
    const wrap = el('div', { class: 'card card-wide', style: 'padding:0;overflow:auto;' });
    const tbl = el('table', { class: 'table' });
    tbl.appendChild(el('thead', {}, el('tr', {}, [
      el('th', {}, 'SKU'),
      el('th', { class: 'num' }, 'Prod'),
      el('th', { class: 'num' }, 'Sold')
    ])));
    const tbody = el('tbody');
    d.perSku.forEach(s => {
      tbody.appendChild(el('tr', {}, [
        el('td', {}, s.sku_name),
        el('td', { class: 'num' }, fmtInt(s.prodM)),
        el('td', { class: 'num' }, fmtInt(s.soldM))
      ]));
    });
    tbl.appendChild(tbody);
    wrap.appendChild(tbl);
    root.appendChild(wrap);
  }

  // per-machine kWh
  if (d.perMachine.length) {
    root.appendChild(el('div', { class: 'section-head', style: 'margin-top:22px;' }, [el('h2', {}, 'kWh by machine')]));
    const wrap = el('div', { class: 'card card-wide', style: 'padding:0;' });
    const tbl = el('table', { class: 'table' });
    tbl.appendChild(el('thead', {}, el('tr', {}, [
      el('th', {}, 'Machine'),
      el('th', { class: 'num' }, 'kWh (month)')
    ])));
    const tbody = el('tbody');
    d.perMachine.forEach(m => {
      tbody.appendChild(el('tr', {}, [
        el('td', {}, m.machine),
        el('td', { class: 'num' }, fmtNum(m.kwhM, 1))
      ]));
    });
    tbl.appendChild(tbody);
    wrap.appendChild(tbl);
    root.appendChild(wrap);
  }

  return root;
}

function card(title, value, sub, vClass = '', corner = '') {
  return el('div', { class: 'card' }, [
    corner ? el('span', { class: 'corner' }, corner) : null,
    el('div', { class: 'k' }, title),
    el('div', { class: 'v ' + vClass }, String(value)),
    sub ? el('div', { class: 'sub' }, sub) : null
  ]);
}

// ---------- views: entry ----------

const ENTRY_TYPES = [
  { id: 'kwh_log',      label: 'kWh' },
  { id: 'bag_prod_log', label: 'Prod' },
  { id: 'bag_sale_log', label: 'Sale' },
  { id: 'plastic_log',  label: 'Plastic' },
  { id: 'manpower_log', label: 'Wage' }
];

function renderEntry() {
  const root = el('div');

  // subtabs
  const subbar = el('div', { class: 'subtabs' });
  ENTRY_TYPES.forEach(t => {
    subbar.appendChild(el('button', {
      class: 'subtab' + (state.subEntry === t.id ? ' active' : ''),
      onclick: () => { state.subEntry = t.id; mount(); }
    }, t.label));
  });
  root.appendChild(subbar);

  root.appendChild(renderEntryForm(state.subEntry));
  return root;
}

function renderEntryForm(type) {
  const form = el('form', {
    class: 'form-card',
    onsubmit: e => { e.preventDefault(); submitEntry(type, form); }
  });

  const skuOptions = state.skus.map(s =>
    el('option', { value: s.sku_id }, s.sku_name + ' (' + s.sku_id + ')')
  );
  if (state.skus.length === 0) {
    skuOptions.push(el('option', { value: '', disabled: '' }, 'No SKUs — add some in your sheet'));
  }

  // Common timestamp field for all but manpower
  const tsField = (label = 'When') => [
    el('label', {}, label),
    el('input', { type: 'datetime-local', name: 'timestamp', value: todayLocalIso(), required: '' })
  ];

  let fields;
  switch (type) {
    case 'kwh_log':
      fields = [
        ...tsField(),
        el('label', {}, 'Machine'),
        el('select', { name: 'machine', required: '' }, [
          el('option', { value: 'Machine 1' }, 'Machine 1'),
          el('option', { value: 'Machine 2' }, 'Machine 2')
        ]),
        el('label', {}, 'kWh'),
        el('input', { type: 'number', step: '0.01', min: '0', name: 'kwh', required: '', inputmode: 'decimal' })
      ];
      break;
    case 'bag_prod_log':
      fields = [
        ...tsField(),
        el('label', {}, 'SKU'),
        el('select', { name: 'sku_id', required: '' }, skuOptions),
        el('label', {}, 'Qty (pcs)'),
        el('input', { type: 'number', step: '1', min: '0', name: 'qty', required: '', inputmode: 'numeric' })
      ];
      break;
    case 'bag_sale_log': {
      // Auto-fill unit_price from selected SKU. Hidden input carries the value to submit.
      const priceDisplay = el('div', {
        style: 'font-family: "JetBrains Mono", monospace; font-size: 18px; color: var(--amber-2); padding: 8px 0;'
      }, '—');
      const hiddenPrice = el('input', { type: 'hidden', name: 'unit_price', value: '0' });
      const skuSelect = el('select', { name: 'sku_id', required: '' }, skuOptions);
      const updatePrice = () => {
        const sku = state.skus.find(s => s.sku_id === skuSelect.value);
        const p = sku ? sku.unit_price : 0;
        hiddenPrice.value = String(p);
        priceDisplay.textContent = p > 0 ? `Rp ${p.toLocaleString('id-ID')} per pcs` : '— no price set in skus tab —';
      };
      skuSelect.addEventListener('change', updatePrice);
      // initialize after the element is in the DOM
      setTimeout(updatePrice, 0);
      fields = [
        ...tsField(),
        el('label', {}, 'SKU'),
        skuSelect,
        el('label', {}, 'Unit price'),
        priceDisplay,
        hiddenPrice,
        el('label', {}, 'Qty (pcs)'),
        el('input', { type: 'number', step: '1', min: '0', name: 'qty', required: '', inputmode: 'numeric' })
      ];
      break;
    }
    case 'plastic_log':
      fields = [
        ...tsField(),
        el('div', { class: 'row' }, [
          el('div', {}, [
            el('label', {}, 'Kg used'),
            el('input', { type: 'number', step: '0.01', min: '0', name: 'kg_used', required: '', inputmode: 'decimal' })
          ]),
          el('div', {}, [
            el('label', {}, 'Price / kg (Rp)'),
            el('input', { type: 'number', step: '1', min: '0', name: 'price_per_kg', inputmode: 'numeric' })
          ])
        ])
      ];
      break;
    case 'manpower_log':
      fields = [
        el('label', {}, 'Month'),
        el('input', { type: 'month', name: 'month', value: currentMonth(), required: '' }),
        el('div', { class: 'row' }, [
          el('div', {}, [
            el('label', {}, 'Total monthly wage (Rp)'),
            el('input', { type: 'number', step: '1', min: '0', name: 'total_monthly_wage', required: '', inputmode: 'numeric' })
          ]),
          el('div', {}, [
            el('label', {}, 'Headcount'),
            el('input', { type: 'number', step: '1', min: '0', name: 'headcount', inputmode: 'numeric' })
          ])
        ])
      ];
      break;
  }
  fields.forEach(f => form.appendChild(f));
  form.appendChild(el('label', {}, 'Note (optional)'));
  form.appendChild(el('input', { type: 'text', name: 'note' }));
  form.appendChild(el('button', { type: 'submit', class: 'btn-primary' }, 'Save entry'));
  return form;
}

async function submitEntry(type, form) {
  const fd = new FormData(form);
  const payload = { type, id: uuid(), operator: localStorage.getItem('operator_name') || '' };
  fd.forEach((v, k) => payload[k] = v);

  // Convert timestamp from datetime-local to ISO with offset
  if (payload.timestamp) {
    const d = new Date(payload.timestamp);
    payload.timestamp = d.toISOString();
  }

  const submitBtn = form.querySelector('button[type=submit]');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Saving…';

  try {
    if (!navigator.onLine) throw new Error('offline');
    await apiCall('addEntry', payload);
    toast('Saved', 'good');
    form.reset();
    // Restore the timestamp default after reset
    const tsInput = form.querySelector('input[name=timestamp]');
    if (tsInput) tsInput.value = todayLocalIso();
    const mInput = form.querySelector('input[name=month]');
    if (mInput) mInput.value = currentMonth();
  } catch (err) {
    queue.push({ id: payload.id, payload });
    toast('Queued (will retry): ' + err.message, 'bad');
    form.reset();
    const tsInput = form.querySelector('input[name=timestamp]');
    if (tsInput) tsInput.value = todayLocalIso();
    const mInput = form.querySelector('input[name=month]');
    if (mInput) mInput.value = currentMonth();
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Save entry';
  }
}

// ---------- views: settings ----------

function renderSettings() {
  const root = el('div');

  // Credentials card
  const credCard = el('div', { class: 'settings-card' });
  credCard.appendChild(el('h3', {}, 'Credentials'));
  credCard.appendChild(el('p', { class: 'muted' }, 'Your role is identified by the secret you paste here. Ask your admin for the operator or admin secret.'));

  credCard.appendChild(el('label', {}, 'Your name'));
  credCard.appendChild(el('input', {
    type: 'text',
    value: localStorage.getItem('operator_name') || '',
    placeholder: 'e.g. Budi',
    oninput: e => localStorage.setItem('operator_name', e.target.value)
  }));

  credCard.appendChild(el('label', {}, 'Secret'));
  credCard.appendChild(el('input', {
    type: 'password',
    value: localStorage.getItem('secret') || '',
    placeholder: 'paste secret',
    oninput: e => localStorage.setItem('secret', e.target.value)
  }));

  credCard.appendChild(el('button', {
    class: 'btn-ghost',
    style: 'margin-top:14px;',
    onclick: async () => {
      try {
        const r = await apiCall('ping');
        toast('Connected as ' + r.role, 'good');
      } catch (e) {
        toast('Connection failed: ' + e.message, 'bad');
      }
    }
  }, 'Test connection'));

  root.appendChild(credCard);

  // Queue card
  const qCard = el('div', { class: 'settings-card' });
  qCard.appendChild(el('h3', {}, 'Pending queue (' + queue.size() + ')'));
  const items = queue.read();
  if (items.length === 0) {
    qCard.appendChild(el('p', { class: 'muted' }, 'Nothing queued. Failed entries appear here for retry.'));
  } else {
    items.forEach(i => {
      qCard.appendChild(el('div', { class: 'queue-row' }, [
        el('span', {}, i.payload.type),
        el('span', {}, (i.payload.timestamp || i.payload.month || '').slice(0, 16))
      ]));
    });
    qCard.appendChild(el('button', {
      class: 'btn-ghost',
      style: 'margin-top:14px;',
      onclick: async () => {
        await flushQueue();
        toast(queue.size() ? `${queue.size()} still queued` : 'Queue empty', queue.size() ? 'bad' : 'good');
        mount();
      }
    }, 'Retry now'));
  }
  root.appendChild(qCard);

  // SKUs viewer
  const skuCard = el('div', { class: 'settings-card' });
  skuCard.appendChild(el('h3', {}, 'SKUs (read-only)'));
  skuCard.appendChild(el('p', { class: 'muted' }, 'Manage in the `skus` sheet directly. Refresh after editing.'));
  if (state.skus.length === 0) {
    skuCard.appendChild(el('p', { class: 'muted' }, 'No SKUs loaded.'));
  } else {
    const tbl = el('table', { class: 'table' });
    tbl.appendChild(el('thead', {}, el('tr', {}, [
      el('th', {}, 'ID'),
      el('th', {}, 'Name'),
      el('th', { class: 'num' }, 'Price')
    ])));
    const tb = el('tbody');
    state.skus.forEach(s => {
      tb.appendChild(el('tr', {}, [
        el('td', {}, s.sku_id),
        el('td', {}, s.sku_name),
        el('td', { class: 'num' }, s.unit_price ? 'Rp ' + s.unit_price.toLocaleString('id-ID') : '—')
      ]));
    });
    tbl.appendChild(tb);
    skuCard.appendChild(tbl);
  }
  skuCard.appendChild(el('button', {
    class: 'btn-ghost',
    style: 'margin-top:14px;',
    onclick: async () => { await loadSkus(); mount(); toast('SKUs refreshed', 'good'); }
  }, 'Refresh SKUs'));
  root.appendChild(skuCard);

  return root;
}

// ---------- router ----------

function mount() {
  const view = $('#view');
  view.innerHTML = '';
  document.querySelectorAll('.tab').forEach(t =>
    t.classList.toggle('active', t.dataset.view === state.view)
  );
  let node;
  if (state.view === 'dashboard') node = renderDashboard();
  else if (state.view === 'entry') node = renderEntry();
  else node = renderSettings();
  view.appendChild(node);
}

// ---------- data loading ----------

async function loadDashboard() {
  state.loading = true; mount();
  try {
    const r = await apiCall('getDashboard', { month: state.month });
    state.dashboard = r;
  } catch (err) {
    toast('Dashboard failed: ' + err.message, 'bad');
  } finally {
    state.loading = false; mount();
  }
}

async function loadSkus() {
  try {
    const r = await apiCall('getSkus');
    state.skus = r.skus || [];
  } catch (err) {
    // silent — settings page will show empty list
  }
}

// ---------- init ----------

function init() {
  // tab clicks
  document.querySelectorAll('.tab').forEach(t => {
    t.addEventListener('click', async () => {
      state.view = t.dataset.view;
      mount();
      if (state.view === 'dashboard' && !state.dashboard) await loadDashboard();
    });
  });

  // network listeners
  window.addEventListener('online', () => { updateNetPill(); flushQueue().then(updateNetPill); });
  window.addEventListener('offline', updateNetPill);
  setInterval(() => { if (navigator.onLine && queue.size()) flushQueue().then(updateNetPill); }, 30000);

  updateNetPill();
  mount();

  // First load: skus then dashboard (if creds present)
  if (localStorage.getItem('secret')) {
    loadSkus().then(loadDashboard);
  } else {
    state.view = 'settings';
    mount();
    toast('Paste your secret in Settings to begin', 'bad');
  }

  // register service worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
}

document.addEventListener('DOMContentLoaded', init);
