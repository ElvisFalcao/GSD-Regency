// Drives app.js in demo mode against a minimal DOM. It is not a browser and
// proves nothing about layout, but it executes every render path, which is
// where a renamed element or a bad field reference would otherwise hide until
// someone opened the page.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const ids = [...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]);
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function el(id = '') {
  const node = {
    id, _text: '', innerHTML: '', value: '', options: [{ text: 'All' }], dataset: {},
    classList: {
      _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); },
      toggle(c, on) { if (on) this._s.add(c); else this._s.delete(c); }, contains(c) { return this._s.has(c); }
    },
    addEventListener() {}, showModal() {}, close() {}, click() {}, focus() {}
  };
  Object.defineProperty(node, 'textContent', {
    get() { return this._text; },
    set(v) { this._text = String(v); this.innerHTML = esc(v); }
  });
  return node;
}

const nodes = new Map(ids.map((id) => [id, el(id)]));
const views = ['overview', 'tasks', 'campaigns', 'reports', 'settings'];
for (const v of views) nodes.set(`${v}View`, el(`${v}View`));
const navs = views.map((v) => { const n = el(); n.dataset.view = v; return n; });

globalThis.document = {
  getElementById: (id) => { if (!nodes.has(id)) nodes.set(id, el(id)); return nodes.get(id); },
  createElement: () => el(),
  querySelector: (sel) => navs.find((n) => sel.includes(n.dataset.view)) || el(),
  querySelectorAll: (sel) => (sel === '.nav' ? navs : sel === '.view' ? [...nodes.values()].filter((n) => n.id.endsWith('View')) : [])
};
const store = new Map();
globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
globalThis.window = { PM_CONFIG: {}, scrollTo() {} };
globalThis.FileReader = class {};

// No supabaseUrl in PM_CONFIG, so app.js boots straight into demo mode.
await import('../app.js');
await new Promise((resolve) => setTimeout(resolve, 50));

test('boots without credentials and renders the overview', () => {
  assert.match(nodes.get('statCards').innerHTML, /Due today/);
  assert.match(nodes.get('statCards').innerHTML, /Reports due/);
});

test('team board shows the real staff, not the old placeholders', () => {
  const board = nodes.get('teamBoard').innerHTML;
  assert.match(board, /Tshwaraganyo Lekabe/);
  assert.match(board, /Kesia Burdett/);
  assert.match(board, /Zaida Kays/);
  assert.doesNotMatch(board, /T-Man|Keisha|Ziada/);
});

test('settings lists access levels and roles', () => {
  assert.match(nodes.get('settingsPanel').innerHTML, /Paid Media Owner/);
  assert.match(nodes.get('settingsPanel').innerHTML, /Nobody is waiting for approval/);
});

test('the example campaign generates a full post, boost and report set', () => {
  nodes.get('seedDemo').onclick();
  const table = nodes.get('taskTable').innerHTML;
  assert.equal((table.match(/data-task-id/g) || []).length, 9);
  for (const type of ['Post', 'Boost', 'Report']) assert.ok(table.includes(`>${type}<`), `${type} missing`);
  assert.match(table, /Elvis Falcao/);
  assert.equal(Number(nodes.get('notificationCount').textContent) > 0, true);
});
