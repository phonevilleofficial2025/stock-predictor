// A real spreadsheet engine — ported from the CPFR simulation workbook export
// (name box + formula bar, click-to-select cells, frozen header/columns, a green
// corner marking formula cells, and a formula parser/evaluator supporting SUM, IF,
// IFERROR, AVERAGE, VLOOKUP, CONCATENATE plus a few extras below) — refactored from
// that standalone HTML file into an ES module that mounts into a container element
// instead of owning the whole document, so it can live inside the React app and
// follow its dark-mode toggle instead of `prefers-color-scheme`.
//
// Deliberate deviation from the source workbook: editing is restricted to cells
// explicitly marked `editable` on the workbook data (anything else — formulas,
// uploaded history — rejects the edit), since the server only knows how to persist
// specific fields. Editable cells only ever hold plain numbers, never formulas.

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONF = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

class Err {
  constructor(c) { this.c = c; }
}

const K = (r, c) => r * 20000 + c;
const CN = (s) => s.split('').reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0);
// Column-number -> letter (A, B, ..., Z, AA, ...), exported so formula-building code
// (e.g. cpfrWorkbook.js) can reference cells by the same A1-style addresses the
// compiled formulas use, without duplicating this.
export const CL = (n) => {
  let s = '';
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = (n - m - 1) / 26;
  }
  return s;
};

function n_(x) {
  if (x instanceof Err) throw x;
  if (x == null || x === '') return 0;
  if (typeof x === 'number') return x;
  if (typeof x === 'boolean') return +x;
  const t = +x;
  if (Number.isNaN(t)) throw new Err('#VALUE!');
  return t;
}
function s_(x) {
  return x == null ? '' : typeof x === 'boolean' ? (x ? 'TRUE' : 'FALSE') : (typeof x === 'number' ? String(x) : x);
}
function eq(a, b) {
  a = a ?? ''; b = b ?? '';
  if (typeof a === 'string' && typeof b === 'string') return a.toLowerCase() === b.toLowerCase();
  return a === b;
}
function cm(a, b) { a = a ?? 0; b = b ?? 0; return a < b ? -1 : a > b ? 1 : 0; }
function dv(a, b) { b = n_(b); if (b === 0) throw new Err('#DIV/0!'); return n_(a) / b; }
function tr(x) { return x === true || (typeof x === 'number' && x !== 0) || (typeof x === 'string' && x.toUpperCase() === 'TRUE'); }
function flat(a) { return a.flatMap((t) => { t = t(); return Array.isArray(t) ? t.flat() : [t]; }); }

const F = {
  IF: (c, a, b) => (tr(c()) ? (a ? a() : true) : (b ? b() : false)),
  IFERROR: (a, b) => { try { const v = a(); return v instanceof Err ? b() : v; } catch { return b(); } },
  SUM: (...a) => flat(a).reduce((s, x) => s + (typeof x === 'number' ? x : 0), 0),
  AVERAGE: (...a) => {
    const x = flat(a).filter((v) => typeof v === 'number');
    if (!x.length) throw new Err('#DIV/0!');
    return x.reduce((s, v) => s + v, 0) / x.length;
  },
  CONCATENATE: (...a) => a.map((t) => s_(t())).join(''),
  MAX: (...a) => { const x = flat(a).filter((v) => typeof v === 'number'); return x.length ? Math.max(...x) : 0; },
  MIN: (...a) => { const x = flat(a).filter((v) => typeof v === 'number'); return x.length ? Math.min(...x) : 0; },
  ROUND: (a, b) => { const x = n_(a()); const d = b ? n_(b()) : 0; const m = 10 ** d; return Math.round(x * m) / m; },
  AND: (...a) => a.every((t) => tr(t())),
  OR: (...a) => a.some((t) => tr(t())),
  NOT: (a) => !tr(a()),
  VLOOKUP: (k, t, i) => {
    const key = k(); const tab = t(); const ix = n_(i());
    for (const row of tab) if (row[0] != null && eq(row[0], key)) {
      if (ix > row.length) throw new Err('#REF!');
      const v = row[ix - 1];
      return v == null ? 0 : v;
    }
    throw new Err('#N/A');
  },
};

const TOK = /\s*(?:("(?:[^"]|"")*")|((?:'[^']+'|[A-Za-z_][\w.]*)!)?(\$?[A-Z]{1,3}\$?\d+(?::\$?[A-Z]{1,3}\$?\d+)?|\$?[A-Z]{1,3}:\$?[A-Z]{1,3})(?![\w(])|(\d+\.?\d*(?:[eE][+-]?\d+)?)|([A-Z][A-Z0-9.]*)\(|(<=|>=|<>|[-+*/^&=<>(),%]))/y;

const MON_RX = /yyyy|yy|mmmm|mmm|mm|m|dd|d/gi;
function fmtDate(v, f) {
  const d = new Date(Math.round((v - 25569) * 864e5));
  const Y = d.getUTCFullYear(); const M = d.getUTCMonth(); const Dd = d.getUTCDate();
  return f.replace(MON_RX, (t) => ({
    yyyy: Y, yy: String(Y).slice(2), mmmm: MONF[M], mmm: MON[M],
    mm: String(M + 1).padStart(2, '0'), m: M + 1, dd: String(Dd).padStart(2, '0'), d: Dd,
  }[t.toLowerCase()]));
}

function fmt(v, f) {
  if (v instanceof Err) return v.c;
  if (v == null) return '';
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (typeof v !== 'number') return String(v);
  if (!f || f === 'General') return String(+v.toPrecision(10));
  const parts = f.split(';');
  let sec = parts[0];
  if (v < 0 && parts.length > 1) sec = parts[1];
  else if (v === 0 && parts.length > 2) sec = parts[2];
  let c = sec.replace(/\[[^\]]*\]/g, '');
  const lit = [];
  c = c.replace(/"([^"]*)"/g, (m, t) => { lit.push(t); return '\u0001'; });
  if (/[dmyh]/i.test(c.replace(/[_\\*].?/g, '')) && !/[0#]/.test(c)) return fmtDate(v, c.replace(/\u0001/g, () => lit.shift()));
  c = c.replace(/_./g, '').replace(/\*./g, '').replace(/\\(.)/g, '$1');
  if (!/[0#]/.test(c)) return c.replace(/\u0001/g, () => lit.shift()).trim();
  const pct = c.includes('%');
  const dec = ((/\.(0+|#+)/.exec(c) || [])[1] || '').length;
  const th = /#,#|0,0/.test(c);
  const x = Math.abs(v) * (pct ? 100 : 1);
  let s = x.toFixed(dec);
  if (th) { let [a, b] = s.split('.'); a = a.replace(/\B(?=(\d{3})+(?!\d))/g, ','); s = b ? `${a}.${b}` : a; }
  const pre = (/^[^#0]*/.exec(c)[0]).replace(/\u0001/g, () => lit.shift());
  const suf = (/[#0?.,]*([^#0?.,]*)$/.exec(c)[1] || '').replace(/\u0001/g, () => lit.shift());
  let out = pre + s + suf;
  out = out.replace(/\?/g, '');
  return (v < 0 && parts.length === 1 ? '-' : '') + out.replace(/%?$/, pct ? '%' : '').replace(/%+$/, pct ? '%' : '');
}

const esc = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const escAttr = (t) => esc(String(t)).replace(/"/g, '&quot;');

// Renders a live <select> directly into a header cell — e.g. Balance/PO's month
// picker — instead of that section being a scrollable window like Weekly Sell-Out/
// CPFR. `dropdown`: { options: [{value,label}], value, suffix? }. Wired up for real
// (a 'change' listener, via `wireDropdowns` below) after the HTML string this
// produces is actually in the DOM.
function renderDropdown(r, c, dropdown) {
  const opts = dropdown.options.map((o) => `<option value="${escAttr(o.value)}"${o.value === dropdown.value ? ' selected' : ''}>${esc(o.label)}</option>`).join('');
  const suffix = dropdown.suffix ? ` ${esc(dropdown.suffix)}` : '';
  return `<select class="xl-hdr-select" data-r="${r}" data-c="${c}">${opts}</select>${suffix}`;
}

let styleInjected = false;
function ensureBaseStyle() {
  if (styleInjected) return;
  styleInjected = true;
  const style = document.createElement('style');
  style.textContent = `
.xlapp{--xl-bg:#f3f4f6;--xl-bar:#fff;--xl-ink:#1f2937;--xl-line:#d1d5db;--xl-acc:#1f4e9c;
  display:flex;flex-direction:column;background:var(--xl-bg);color:var(--xl-ink);font:14px system-ui,sans-serif;
  border:1px solid var(--xl-line);border-radius:6px;overflow:hidden;height:70vh}
.dark .xlapp{--xl-bg:#111827;--xl-bar:#1f2937;--xl-ink:#e5e7eb;--xl-line:#374151;--xl-acc:#6ea0ff}
.xlapp .xl-fx{display:flex;gap:8px;align-items:center;background:var(--xl-bar);border-bottom:1px solid var(--xl-line);padding:6px 10px}
.xlapp .xl-nb{width:90px;font-weight:600;text-align:center;border:1px solid var(--xl-line);border-radius:4px;padding:4px;background:transparent;color:inherit}
.xlapp .xl-fi{flex:1;min-width:0;border:1px solid var(--xl-line);border-radius:4px;padding:4px 8px;font:13px ui-monospace,Consolas,monospace;background:transparent;color:inherit}
.xlapp .xl-fi[readonly]{opacity:.55;cursor:not-allowed}
.xlapp .xl-note{font-size:12px;opacity:.7;padding:4px 10px;background:var(--xl-bar);border-bottom:1px solid var(--xl-line)}
.xlapp .xl-wrap{flex:1;overflow:auto;background:#fff}
.dark .xlapp .xl-wrap{background:#1f2937}
.xlapp .xl-sheet{display:flex;flex-direction:column;width:fit-content}
.xlapp .xl-headrow{display:flex;align-items:flex-start;position:sticky;top:0;z-index:6}
.xlapp .xl-bodyrow{display:flex;align-items:flex-start}
.xlapp .xl-window-head{overflow:hidden;flex-shrink:0}
.xlapp .xl-window-body{overflow-x:auto;flex-shrink:0}
.xlapp .xl-window-body::-webkit-scrollbar{height:8px}
.xlapp .xl-hdr-select{background:rgba(255,255,255,.15);color:inherit;border:1px solid rgba(255,255,255,.4);border-radius:4px;padding:1px 4px;font:inherit;font-weight:700;cursor:pointer}
.xlapp .xl-hdr-select option{color:#1f2937;background:#fff}
.xlapp table{border-collapse:collapse;table-layout:fixed}
.xlapp td{border:1px solid #e3e3e3;padding:0 4px;overflow:hidden;white-space:nowrap;color:#000;background:#fff;box-sizing:border-box;position:relative}
.dark .xlapp td{border-color:#374151;color:#e5e7eb;background:#1f2937}
.xlapp td.xl-sel{outline:2px solid #1a73e8;outline-offset:-2px;z-index:5}
.xlapp td input.xl-cell-input{width:100%;height:100%;margin:0;padding:0 3px;border:0;outline:2px solid #1a73e8;outline-offset:-2px;box-sizing:border-box;font:inherit;text-align:inherit;color:inherit;background:#fff}
.dark .xlapp td input.xl-cell-input{background:#111827;color:#e5e7eb}
.xlapp td.xl-fm::after{content:"";position:absolute;right:0;top:0;border:4px solid transparent;border-top-color:#16a34a;border-right-color:#16a34a}
.xlapp td.xl-saving::after{content:"";position:absolute;right:1px;top:1px;width:6px;height:6px;border-radius:50%;background:#6366f1;animation:xl-pulse 1s infinite}
.xlapp td.xl-error::after{content:"";position:absolute;right:1px;top:1px;width:6px;height:6px;border-radius:50%;background:#ef4444}
@keyframes xl-pulse{0%,100%{opacity:1}50%{opacity:.3}}
.xlapp .xl-zoom{display:flex;align-items:center;gap:4px;flex-shrink:0}
.xlapp .xl-zoom-btn{width:24px;height:24px;line-height:1;border:1px solid var(--xl-line);border-radius:4px;background:transparent;color:inherit;cursor:pointer;font:15px/1 system-ui,sans-serif;display:flex;align-items:center;justify-content:center}
.xlapp .xl-zoom-btn:disabled{opacity:.4;cursor:not-allowed}
.xlapp .xl-zoom-btn:not(:disabled):hover{background:var(--xl-line)}
.xlapp .xl-zoom-label{font-size:12px;min-width:38px;text-align:center;opacity:.8;cursor:pointer}
.xlapp .xl-fs-btn{width:28px;height:24px;line-height:1;border:1px solid var(--xl-line);border-radius:4px;background:transparent;color:inherit;cursor:pointer;font:14px/1 system-ui,sans-serif;display:flex;align-items:center;justify-content:center}
.xlapp .xl-fs-btn:hover{background:var(--xl-line)}
.xlapp.xl-fs{height:100vh;border-radius:0}
`;
  document.head.appendChild(style);
}

/**
 * Mount a spreadsheet app into `container`.
 * @param {HTMLElement} container
 * @param {{sheets: object[], styles: {css:string, nf:string}[]}} workbookData
 * @param {{onCommit?: (sheetName:string, r:number, c:number, value:number, field:any)=>void}} opts
 */
export function mountExcelApp(container, initialWorkbookData, opts = {}) {
  ensureBaseStyle();
  const { onCommit } = opts;

  // `workbookData` is reassigned by `update()` (a fresh data-only refresh — e.g. a
  // commit round-trip, a page/filter change) so callers never have to tear down and
  // recreate the whole engine just to show new values, which would otherwise reset
  // zoom, full screen, window scroll positions and the current selection on every
  // edit or page change.
  let workbookData = initialWorkbookData;
  const SH = {};
  const memo = new Map();
  // The source workbook export starts with `live=false` and shows each formula
  // cell's pre-baked `v` (computed once, at export time) until the first edit, as a
  // cheap-render optimization for a frozen snapshot. This sheet is never a frozen
  // snapshot — the builder leaves formula cells' `v` empty and relies on the engine
  // to compute them — so formulas must evaluate from the very first render.
  let live = true;

  function indexSheets(wd) {
    Object.keys(SH).forEach((k) => delete SH[k]);
    wd.sheets.forEach((s) => {
      s.m = new Map();
      s.cells.forEach(([r, c, v, f, st, editable, field, styleMap, dropdown]) => {
        s.m.set(K(r, c), { v, f: f || undefined, st, editable: !!editable, field, styleMap, dropdown });
      });
      SH[s.name] = s;
    });
  }
  indexSheets(workbookData);

  function V(sn, r, c) {
    const sh = SH[sn];
    if (!sh) throw new Err('#REF!');
    const cell = sh.m.get(K(r, c));
    if (!cell) return null;
    if (cell.f === undefined || !live) return cell.v;
    const key = `${sn}!${K(r, c)}`;
    if (memo.has(key)) { const m = memo.get(key); if (m instanceof Err) throw m; return m; }
    memo.set(key, 0);
    let v;
    try {
      if (!cell.fn) cell.fn = compile(cell.f);
      v = cell.fn(sn);
    } catch (e) { v = e instanceof Err ? e : new Err('#VALUE!'); }
    memo.set(key, v);
    if (v instanceof Err) throw v;
    return v;
  }
  function RG(sn, r1, c1, r2, c2) {
    const sh = SH[sn];
    if (!sh) throw new Err('#REF!');
    r2 = Math.min(r2, sh.maxr || r2);
    const o = [];
    for (let r = r1; r <= r2; r++) { const row = []; for (let c = c1; c <= c2; c++) row.push(V(sn, r, c)); o.push(row); }
    return o;
  }

  function compile(f) {
    f = f.slice(1);
    const T = []; let i = 0;
    while (i < f.length && f.slice(i).trim()) {
      TOK.lastIndex = i;
      const m = TOK.exec(f);
      if (!m) throw new Error(`Bad formula: ${f}`);
      i = TOK.lastIndex;
      T.push(m);
    }
    let p = 0;
    const op = () => T[p] && T[p][6];
    const cmp = () => {
      let a = cat();
      while (['=', '<>', '<', '>', '<=', '>='].includes(op())) {
        const o = T[p++][6]; const b = cat();
        a = o === '=' ? `eq(${a},${b})` : o === '<>' ? `!eq(${a},${b})` : `(cm(${a},${b})${o}0)`;
      }
      return a;
    };
    const cat = () => { let a = add(); while (op() === '&') { p++; a = `(s_(${a})+s_(${add()}))`; } return a; };
    const add = () => { let a = mul(); while (op() === '+' || op() === '-') { const o = T[p++][6]; a = `(n_(${a})${o}n_(${mul()}))`; } return a; };
    const mul = () => { let a = pw(); while (op() === '*' || op() === '/') { const o = T[p++][6]; const b = pw(); a = o === '/' ? `dv(${a},${b})` : `(n_(${a})*n_(${b}))`; } return a; };
    const pw = () => { let a = un(); while (op() === '^') { p++; a = `Math.pow(n_(${a}),n_(${un()}))`; } return a; };
    const un = () => {
      if (op() === '-') { p++; return `(-n_(${un()}))`; }
      if (op() === '+') { p++; return un(); }
      let a = atom();
      while (op() === '%') { p++; a = `(n_(${a})/100)`; }
      return a;
    };
    const atom = () => {
      const t = T[p++];
      if (t[1]) return JSON.stringify(t[1].slice(1, -1).replace(/""/g, '"'));
      if (t[4]) return t[4];
      if (t[3]) {
        const sn = t[2] ? JSON.stringify(t[2].replace(/!$/, '').replace(/^'|'$/g, '')) : 'sn';
        const pr = (x) => { const m = /^\$?([A-Z]+)\$?(\d*)$/.exec(x); return [m[2] ? +m[2] : null, CN(m[1])]; };
        const pts = t[3].split(':');
        if (pts.length === 1) { const [r, c] = pr(pts[0]); return `V(${sn},${r},${c})`; }
        const [a, b] = pts.map(pr);
        return `RG(${sn},${a[0] ?? 1},${a[1]},${b[0] ?? 1048576},${b[1]})`;
      }
      if (t[5]) {
        const args = [];
        if (op() === ')') p++;
        else { for (;;) { args.push(`()=>(${cmp()})`); const o = T[p++][6]; if (o === ')') break; } }
        return `F.${t[5]}(${args.join(',')})`;
      }
      if (t[6] === '(') { const e = cmp(); p++; return `(${e})`; }
      throw new Error(`Bad formula: ${f}`);
    };
    const src = cmp();
    // eslint-disable-next-line no-new-func
    const fn = new Function('sn', 'V', 'RG', 'F', 'n_', 's_', 'eq', 'cm', 'dv', `return ${src}`);
    return (sn) => fn(sn, V, RG, F, n_, s_, eq, cm, dv);
  }

  // ---- rendering ----
  container.innerHTML = '';
  container.classList.add('xlapp');
  const fx = document.createElement('div'); fx.className = 'xl-fx';
  const nb = document.createElement('input'); nb.className = 'xl-nb'; nb.readOnly = true;
  const fi = document.createElement('input'); fi.className = 'xl-fi'; fi.placeholder = 'Select a cell — editable cells (shaded) can be typed into here';
  const zoomWrap = document.createElement('div'); zoomWrap.className = 'xl-zoom';
  const zoomOut = document.createElement('button'); zoomOut.type = 'button'; zoomOut.className = 'xl-zoom-btn'; zoomOut.textContent = '−'; zoomOut.setAttribute('aria-label', 'Zoom out');
  const zoomLabel = document.createElement('span'); zoomLabel.className = 'xl-zoom-label'; zoomLabel.title = 'Reset zoom';
  const zoomIn = document.createElement('button'); zoomIn.type = 'button'; zoomIn.className = 'xl-zoom-btn'; zoomIn.textContent = '+'; zoomIn.setAttribute('aria-label', 'Zoom in');
  zoomWrap.append(zoomOut, zoomLabel, zoomIn);
  const fsBtn = document.createElement('button'); fsBtn.type = 'button'; fsBtn.className = 'xl-fs-btn'; fsBtn.textContent = '⛶'; fsBtn.title = 'Full screen'; fsBtn.setAttribute('aria-label', 'Full screen');
  fx.append(nb, fi, zoomWrap, fsBtn);
  const note = document.createElement('div'); note.className = 'xl-note';
  note.textContent = 'Green corner = computed formula. Shaded cells are editable — click one and type directly into it (or use the bar above), press Enter to save.';
  const wrap = document.createElement('div'); wrap.className = 'xl-wrap';
  container.append(fx, note, wrap);

  let active = null;
  let cur = null; // [r,c]
  let selTd = null;
  let ver = 0;
  // The very first render with *real* data (On Hand, weeks) typically arrives via
  // update() rather than open() — the caller mounts with an empty/loading workbook
  // first (nothing to scroll to yet), then swaps in the real one once it loads. So
  // "apply the initial scroll-to-latest-upload position" has to be allowed to fire
  // on that first real update() too, not just inside open().
  let hasAppliedInitialScroll = false;

  function show(sh, r, c, cell) {
    let v;
    try { v = V(sh.name, r, c); } catch (e) { v = e instanceof Err ? e : new Err('#VALUE!'); }
    return fmt(v, workbookData.styles[cell.st]?.nf);
  }

  // Builds the sheet as a head band (rows 1..fr, sticky to the top of `.xl-wrap`) and
  // a body band (the rest) stacked vertically, each band split left-to-right into
  // blocks: one frozen block (sticky to the left of `.xl-wrap`), then an alternating
  // sequence of "flow" blocks (plain tables, scrolled by `.xl-wrap` itself, like the
  // whole sheet used to be) and "window" blocks (`sh.windows` ranges — e.g. Weekly
  // Sell-Out, CPFR, one Balance/PO month-group — clipped to a fixed pixel width with
  // their own internal horizontal scrollbar, head and body kept in sync by JS since
  // a lone `overflow-x:auto` div can't also host a `position:sticky` descendant that
  // tracks a scroll ancestor further up — see the band split above).
  function build(sh) {
    const hid = new Set(sh.hrows || []);
    const vc = [];
    sh.cols.forEach((w, i) => { if (w) vc.push(i + 1); });
    const cs = new Set(vc);
    const W = (c) => sh.cols[c - 1];
    let fc = 0; let acc = 0;
    for (let c = 1; c <= sh.fc; c++) { if (!W(c)) continue; if (acc + W(c) > 420) break; acc += W(c); fc = c; }
    const RH = (r) => (sh.rowh || {})[r] || sh.dh;
    const cover = new Set(); const span = {};
    (sh.merges || []).forEach(([r1, c1, r2, c2]) => {
      let rs = 0; let csn = 0;
      for (let r = r1; r <= r2; r++) if (!hid.has(r)) rs++;
      for (let c = c1; c <= c2; c++) if (cs.has(c)) csn++;
      span[K(r1, c1)] = [rs, csn];
      for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) if (r !== r1 || c !== c1) cover.add(K(r, c));
    });

    // Partition columns into blocks, in left-to-right order: frozen first, then the
    // rest split into flow/window runs. A window range never partially overlaps a
    // flow run (cpfrWorkbook.js's header merges each stay inside one section).
    const windows = sh.windows || [];
    const windowFor = (c) => windows.find((win) => c >= win.c1 && c <= win.c2);
    const rest = vc.filter((c) => c > fc);
    const blocks = [];
    if (fc > 0) blocks.push({ type: 'frozen', cols: vc.filter((c) => c <= fc) });
    let i = 0;
    while (i < rest.length) {
      const win = windowFor(rest[i]);
      const cols = [];
      while (i < rest.length && windowFor(rest[i]) === win) { cols.push(rest[i]); i++; }
      blocks.push(win ? { type: 'window', cols, width: win.width } : { type: 'flow', cols });
    }

    // Renders one block's cells for rows [r1, r2] into a <table>. `frozenC` sticks
    // each cell to the left of `.xl-wrap` (only the frozen block uses this); header
    // rows additionally stick to the top *within whichever ancestor is the nearest
    // scroll container* — for frozen/flow blocks that's `.xl-wrap` itself (correct),
    // for window blocks it's the window's own div (handled instead by wrapping only
    // the window's head band in an `overflow:hidden` twin kept in scroll-sync below).
    function renderBlock(block, r1, r2, stickyTop) {
      const totalWidth = block.cols.reduce((a, c) => a + W(c), 0);
      const out = [`<table style="width:${totalWidth}px"><colgroup>`, block.cols.map((c) => `<col style="width:${W(c)}px">`).join(''), '</colgroup>'];
      let top = 0;
      for (let r = r1; r <= r2; r++) {
        if (hid.has(r)) continue;
        const ht = RH(r);
        out.push(`<tr style="height:${ht}px">`);
        for (const c of block.cols) {
          const k = K(r, c);
          const frozenC = block.type === 'frozen';
          const frozenR = stickyTop && r <= sh.fr;
          const sty = (frozenR || frozenC) ? `position:sticky;${frozenR ? `top:${top}px;` : ''}${frozenC ? 'left:0px;' : ''}z-index:${frozenR && frozenC ? 4 : frozenR ? 3 : 2};` : '';
          if (cover.has(k)) continue;
          const cell = sh.m.get(k);
          const sp = span[k] || [1, 1];
          if (!sp[0] || !sp[1]) continue;
          // Formula-driven conditional formatting: a cell can carry a styleMap keyed
          // by its own computed (string) result — e.g. {Healthy: 7, Critical: 9} — so
          // a Status cell's background stays correct after a live edit, not just its text.
          let effSt = cell?.st;
          if (cell?.styleMap) {
            let val;
            try { val = V(sh.name, r, c); } catch (e) { val = e instanceof Err ? e : new Err('#VALUE!'); }
            if (typeof val === 'string' && cell.styleMap[val] !== undefined) effSt = cell.styleMap[val];
          }
          const cls = [cell ? `s${effSt}` : '', cell?.f ? 'xl-fm' : '', cell?.editable ? 'xl-editable' : ''].filter(Boolean).join(' ');
          const bg = (frozenR || frozenC) && !cell ? 'background:inherit;' : '';
          const content = cell ? (cell.dropdown ? renderDropdown(r, c, cell.dropdown) : esc(show(sh, r, c, cell))) : '';
          out.push(`<td data-r="${r}" data-c="${c}" class="${cls}"${sp[0] > 1 ? ` rowspan="${sp[0]}"` : ''}${sp[1] > 1 ? ` colspan="${sp[1]}"` : ''} style="${bg}${sty}">${content}</td>`);
        }
        out.push('</tr>');
        if (r <= sh.fr) top += ht;
      }
      out.push('</table>');
      return out.join('');
    }

    function renderBand(className, r1, r2, stickyTop, windowClass) {
      const parts = blocks.map((b) => {
        const html = renderBlock(b, r1, r2, stickyTop);
        if (b.type === 'window') return `<div class="${windowClass}" style="width:${b.width}px" data-win="${b.cols[0]}">${html}</div>`;
        return html;
      });
      return `<div class="${className}">${parts.join('')}</div>`;
    }

    const hasHead = sh.fr > 0;
    const headHtml = hasHead ? renderBand('xl-headrow', 1, sh.fr, true, 'xl-window-head') : '';
    const bodyHtml = renderBand('xl-bodyrow', sh.fr + 1, sh.maxr, false, 'xl-window-body');
    return `<div class="xl-sheet">${headHtml}${bodyHtml}</div>`;
  }

  // After (re)rendering, keep each window's head scroll position mirrored to its
  // body's — the body is the one with the real (visible) horizontal scrollbar.
  function wireWindowSync(root) {
    root.querySelectorAll('.xl-window-body').forEach((body) => {
      const win = body.dataset.win;
      const head = root.querySelector(`.xl-window-head[data-win="${win}"]`);
      if (!head) return;
      body.addEventListener('scroll', () => { head.scrollLeft = body.scrollLeft; });
    });
  }

  // Header dropdowns (e.g. Balance/PO's month picker) report through the same
  // onCommit callback cell edits use, so the page can treat "pick a different month"
  // like any other field change — just one that doesn't necessarily write to the
  // server (the page decides that per `field.kind`).
  function wireDropdowns(root) {
    root.querySelectorAll('.xl-hdr-select').forEach((select) => {
      select.addEventListener('change', () => {
        const r = +select.dataset.r; const c = +select.dataset.c;
        const cell = active.m.get(K(r, c));
        onCommit?.(active.name, r, c, select.value, cell?.dropdown?.field);
      });
    });
  }

  // A rebuild (every edit) replaces every window's DOM node, which would otherwise
  // reset "scrolled to week 40" back to week 1 on every single keystroke-commit —
  // captured before rebuilding and reapplied after, keyed by each window's start
  // column (stable across rebuilds since the column layout itself doesn't change).
  function captureWindowScroll(root) {
    const map = {};
    root.querySelectorAll('.xl-window-body').forEach((body) => { map[body.dataset.win] = body.scrollLeft; });
    return map;
  }
  function restoreWindowScroll(root, map) {
    root.querySelectorAll('.xl-window-body').forEach((body) => {
      const v = map[body.dataset.win];
      if (!v) return;
      body.scrollLeft = v;
      const head = root.querySelector(`.xl-window-head[data-win="${body.dataset.win}"]`);
      if (head) head.scrollLeft = v;
    });
  }

  // On first open only (not on later update()/edit rebuilds, which already preserve
  // wherever the user scrolled to) — a window whose data declares `scrollToCol` opens
  // scrolled so that column is the last one visible, e.g. landing on your most recent
  // upload instead of week 1.
  function applyInitialScroll(sh) {
    for (const win of sh.windows || []) {
      if (win.scrollToCol == null) continue;
      let cum = 0;
      for (let c = win.c1; c <= win.scrollToCol; c++) cum += (sh.cols[c - 1] || 0);
      const target = Math.max(0, cum - win.width);
      const body = wrap.querySelector(`.xl-window-body[data-win="${win.c1}"]`);
      if (body) body.scrollLeft = target;
      const head = wrap.querySelector(`.xl-window-head[data-win="${win.c1}"]`);
      if (head) head.scrollLeft = target;
    }
  }

  const styleTag = document.createElement('style');
  function rebuildStyleTag() {
    styleTag.textContent = workbookData.styles.map((s, i) => [
      `.xlapp .s${i}{${s.css}}`,
      s.darkCss ? `.dark .xlapp .s${i}{${s.darkCss}}` : '',
    ].filter(Boolean).join('\n')).join('\n');
  }
  rebuildStyleTag();
  container.prepend(styleTag);

  function refresh(sh) {
    wrap.querySelectorAll('td.xl-fm').forEach((td) => {
      const r = +td.dataset.r; const c = +td.dataset.c;
      td.textContent = show(sh, r, c, sh.m.get(K(r, c)));
    });
    sh.ver = ver;
  }

  function open(i) {
    editing = null;
    active = workbookData.sheets[i];
    if (!active.html) active.html = build(active);
    wrap.innerHTML = active.html;
    wireWindowSync(wrap);
    wireDropdowns(wrap);
    if (active.windows?.length) {
      applyInitialScroll(active);
      hasAppliedInitialScroll = true;
    }
    if (active.ver !== ver && live) refresh(active);
    active.ver = ver;
    cur = null; selTd = null;
    nb.value = ''; fi.value = ''; fi.readOnly = true;
  }

  // Swaps in freshly-loaded workbook data (a commit round-trip, a page/filter/month
  // change, a new upload) in place, instead of the caller tearing down and recreating
  // the whole engine — which would otherwise silently reset zoom, full screen, every
  // window's scroll position, and the current cell selection on every single edit.
  function update(newWorkbookData) {
    editing = null; // the pending rebuild will replace the DOM under any open editor
    const activeName = active?.name;
    const keepCur = cur;
    const scrollMap = captureWindowScroll(wrap);

    workbookData = newWorkbookData;
    indexSheets(workbookData);
    rebuildStyleTag();
    memo.clear();
    ver++;

    const idx = Math.max(0, workbookData.sheets.findIndex((s) => s.name === activeName));
    active = workbookData.sheets[idx];
    active.html = build(active);
    wrap.innerHTML = active.html;
    wireWindowSync(wrap);
    wireDropdowns(wrap);
    if (!hasAppliedInitialScroll && active.windows?.length) {
      applyInitialScroll(active);
      hasAppliedInitialScroll = true;
    } else {
      restoreWindowScroll(wrap, scrollMap);
    }
    active.ver = ver;

    // Re-select the same cell (now showing its latest value/formula) if it still
    // exists — the common case right after an edit, where nothing about the sheet's
    // shape changed, just the value the user just committed.
    const cell = keepCur ? active.m.get(K(...keepCur)) : null;
    if (cell) {
      cur = keepCur;
      selTd = wrap.querySelector(`td[data-r="${keepCur[0]}"][data-c="${keepCur[1]}"]`);
      if (selTd) selTd.classList.add('xl-sel');
      nb.value = CL(keepCur[1]) + keepCur[0];
      fi.value = cell.f ?? (cell.v == null ? '' : cell.v);
      fi.readOnly = !cell.editable;
    } else {
      cur = null; selTd = null;
      nb.value = ''; fi.value = ''; fi.readOnly = true;
    }
  }

  // Commits `raw` into the currently-selected (`cur`) editable cell — shared by the
  // formula bar's Enter key and the in-cell editor below, since both are just
  // different ways to type into the same selected cell.
  function commitRaw(raw) {
    if (!cur) return;
    const cell = active.m.get(K(...cur));
    if (!cell?.editable) return; // non-editable cells silently reject edits
    if (cell.field?.type === 'text') {
      cell.v = raw;
    } else {
      const trimmed = raw.trim();
      const num = trimmed === '' ? 0 : Number(trimmed);
      cell.v = Number.isNaN(num) ? 0 : num;
    }
    delete cell.f; delete cell.fn;

    live = true; memo.clear(); ver++;
    const scrollMap = captureWindowScroll(wrap);
    active.html = null;
    const keep = cur;
    active.html = build(active);
    wrap.innerHTML = active.html;
    wireWindowSync(wrap);
    wireDropdowns(wrap);
    restoreWindowScroll(wrap, scrollMap);
    active.ver = ver;
    selTd = wrap.querySelector(`td[data-r="${keep[0]}"][data-c="${keep[1]}"]`);
    if (selTd) selTd.classList.add('xl-sel');
    nb.value = CL(keep[1]) + keep[0];
    fi.value = cell.v == null ? '' : cell.v;
    fi.readOnly = !cell.editable;
    onCommit?.(active.name, keep[0], keep[1], cell.v, cell.field);
  }

  // In-cell editing: clicking an editable cell drops an <input> directly into that
  // <td> (instead of requiring the user to go up to the formula bar) — Enter commits,
  // Escape discards, clicking/tabbing away commits only if the value actually
  // changed (so just clicking a cell to look at it doesn't fire a needless save).
  let editing = null; // { r, c, input, original }

  function closeEditing() {
    if (!editing) return false;
    const { r, c, input, original } = editing;
    editing = null;
    if (input.value !== original) { commitRaw(input.value); return true; }
    const td = wrap.querySelector(`td[data-r="${r}"][data-c="${c}"]`);
    const cell = active.m.get(K(r, c));
    if (td && cell) td.textContent = show(active, r, c, cell);
    return false;
  }

  function startCellEdit(td, r, c) {
    const cell = active.m.get(K(r, c));
    if (!cell?.editable) return;
    const original = String(cell.f ?? (cell.v == null ? '' : cell.v));
    const input = document.createElement('input');
    input.className = 'xl-cell-input';
    input.value = original;
    td.textContent = '';
    td.appendChild(input);
    input.focus();
    input.select();
    editing = { r, c, input, original };

    input.addEventListener('input', () => { fi.value = input.value; });
    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        const v = input.value;
        editing = null;
        commitRaw(v);
      } else if (ev.key === 'Escape') {
        ev.preventDefault();
        editing = null;
        const td2 = wrap.querySelector(`td[data-r="${r}"][data-c="${c}"]`);
        if (td2) td2.textContent = show(active, r, c, cell);
      }
    });
    input.addEventListener('blur', () => { if (editing?.input === input) closeEditing(); });
  }

  function onWrapClick(e) {
    const clickedTd = e.target.closest('td');
    if (!clickedTd) return;
    const r = +clickedTd.dataset.r; const c = +clickedTd.dataset.c;
    if (editing && editing.r === r && editing.c === c) return; // clicking inside the cell being edited — let it place the cursor

    const rebuilt = closeEditing();
    const td = rebuilt ? wrap.querySelector(`td[data-r="${r}"][data-c="${c}"]`) : clickedTd;
    if (!td) return;

    if (selTd) selTd.classList.remove('xl-sel');
    selTd = td; td.classList.add('xl-sel');
    const cell = active.m.get(K(r, c));
    cur = [r, c];
    nb.value = CL(c) + r;
    fi.value = cell ? (cell.f ?? (cell.v == null ? '' : cell.v)) : '';
    fi.readOnly = !cell?.editable;
    if (cell?.editable) startCellEdit(td, r, c);
  }
  wrap.addEventListener('click', onWrapClick);

  function onFiKeydown(e) {
    if (e.key !== 'Enter' || !cur) return;
    commitRaw(fi.value);
  }
  fi.addEventListener('keydown', onFiKeydown);

  // Zoom scales the whole grid (fonts, cell padding, frozen-row/col offsets) via
  // CSS `zoom` rather than `transform: scale` — `zoom` participates in layout, so
  // the wrap's scrollable area and `position:sticky` frozen panes stay correct at
  // every level, which a transform would require extra bookkeeping to preserve.
  const ZOOM_STEPS = [50, 60, 70, 80, 90, 100, 110, 125, 150, 175, 200];
  let zoomIdx = ZOOM_STEPS.indexOf(100);
  function applyZoom() {
    const pct = ZOOM_STEPS[zoomIdx];
    wrap.style.zoom = `${pct}%`;
    zoomLabel.textContent = `${pct}%`;
    zoomOut.disabled = zoomIdx === 0;
    zoomIn.disabled = zoomIdx === ZOOM_STEPS.length - 1;
  }
  function onZoomOut() { if (zoomIdx > 0) { zoomIdx--; applyZoom(); } }
  function onZoomIn() { if (zoomIdx < ZOOM_STEPS.length - 1) { zoomIdx++; applyZoom(); } }
  function onZoomReset() { zoomIdx = ZOOM_STEPS.indexOf(100); applyZoom(); }
  zoomOut.addEventListener('click', onZoomOut);
  zoomIn.addEventListener('click', onZoomIn);
  zoomLabel.addEventListener('click', onZoomReset);
  applyZoom();

  // Full screen targets `container` itself (the `.xlapp` element) via the standard
  // Fullscreen API, so the whole widget — formula bar, zoom controls and grid —
  // fills the screen together. `.xlapp.xl-fs{height:100vh}` (in the base stylesheet
  // above) grows the grid to fill that space once fullscreen is active.
  function onFsChange() {
    const isFs = document.fullscreenElement === container;
    container.classList.toggle('xl-fs', isFs);
    fsBtn.title = isFs ? 'Exit full screen' : 'Full screen';
    fsBtn.setAttribute('aria-label', fsBtn.title);
  }
  function onFsClick() {
    if (document.fullscreenElement === container) document.exitFullscreen?.();
    else container.requestFullscreen?.();
  }
  fsBtn.addEventListener('click', onFsClick);
  document.addEventListener?.('fullscreenchange', onFsChange);

  function setCellStatus(sheetName, r, c, status) {
    if (!active || active.name !== sheetName) return;
    const td = wrap.querySelector(`td[data-r="${r}"][data-c="${c}"]`);
    if (!td) return;
    td.classList.remove('xl-saving', 'xl-error');
    if (status === 'saving') td.classList.add('xl-saving');
    else if (status === 'error') td.classList.add('xl-error');
  }

  open(0);

  return {
    setCellStatus,
    update,
    destroy() {
      wrap.removeEventListener('click', onWrapClick);
      fi.removeEventListener('keydown', onFiKeydown);
      zoomOut.removeEventListener('click', onZoomOut);
      zoomIn.removeEventListener('click', onZoomIn);
      zoomLabel.removeEventListener('click', onZoomReset);
      fsBtn.removeEventListener('click', onFsClick);
      document.removeEventListener?.('fullscreenchange', onFsChange);
      if (document.fullscreenElement === container) document.exitFullscreen?.();
      container.innerHTML = '';
      container.classList.remove('xlapp');
    },
  };
}
