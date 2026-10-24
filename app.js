/*
 * Interfaz del demo de slotting de almacén.
 * Depende de `WarehouseEngine` (engine.js).
 */
(function () {
  'use strict';

  const E = window.WarehouseEngine;
  if (!E) { document.body.insertAdjacentHTML('afterbegin', '<p style="padding:16px;color:#f87171">No se pudo cargar engine.js</p>'); return; }

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const BASELINE_SEED = 99; // misma asignación de partida que usa el recocido por defecto
  const TOP_LINKS = 40;

  // ---------- Geometría del plano ----------
  const G = {
    left: 78, top: 56, colPitch: 170, firstCol: 150,
    slotW: 136, slotH: 46, rowPitch: 54, rows: 8,
  };
  const colX = (a) => G.firstCol + a * G.colPitch;            // a: 0..3
  const rowY = (p) => G.top + (G.rows - 1 - p) * G.rowPitch + G.rowPitch / 2; // p: 0..7 (0 = frente, abajo)

  // Velocidad: cada `every` frames se consumen `steps` pasos del generador.
  const SPEEDS = [
    null,
    { every: 12, steps: 1, dur: 420, label: 'Muy lenta' },
    { every: 6, steps: 1, dur: 320, label: 'Lenta' },
    { every: 3, steps: 1, dur: 240, label: 'Moderada' },
    { every: 2, steps: 1, dur: 180, label: 'Media' },
    { every: 1, steps: 1, dur: 120, label: 'Normal' },
    { every: 1, steps: 2, dur: 90, label: 'Rápida' },
    { every: 1, steps: 4, dur: 70, label: 'Muy rápida' },
    { every: 1, steps: 8, dur: 60, label: 'Turbo' },
    { every: 1, steps: 20, dur: 50, label: 'Ultra' },
    { every: 1, steps: 1e9, dur: 0, label: 'Instantánea' },
  ];
  const FRAME_BUDGET_MS = 14;

  // ---------- Estado ----------
  const S = {
    inst: null,
    baseline: null, baselineCost: NaN,
    assign: null, cost: NaN,
    best: null,              // { assign, cost, by }
    gen: null, running: false, raf: 0, frame: 0,
    runSolver: null, runBest: Infinity, lastSnap: null,
    history: [],
    selected: -1, focusSku: -1,
    moves: [],
    compareBusy: false, compare: null,
  };

  // ---------- DOM ----------
  const $ = (id) => document.getElementById(id);
  const el = {
    density: $('density'), densityOut: $('density-out'),
    profile: $('profile'), profileHelp: $('profile-help'),
    solver: $('solver'), solverHelp: $('solver-help'),
    speed: $('speed'), speedOut: $('speed-out'),
    run: $('btn-run'), reset: $('btn-reset'), random: $('btn-random'), bestBtn: $('btn-best'), compare: $('btn-compare'),
    svg: $('plano'), wrap: $('plan-wrap'), tooltip: $('tooltip'), planStatus: $('plan-status'),
    showLinks: $('show-links'), linkMode: $('link-mode'),
    mCost: $('m-cost'), mCostSub: $('m-cost-sub'), mBest: $('m-best'), mBestBy: $('m-best-by'), mStart: $('m-start'),
    mImpr: $('m-impr'), mImprCur: $('m-impr-cur'), mStage: $('m-stage'), mIter: $('m-iter'),
    mProgress: $('m-progress'), mProgressBar: $('m-progress-bar'), mTemp: $('m-temp'), mGap: $('m-gap'),
    chart: $('chart'), cmpBody: $('cmp-body'),
    moveLast: $('move-last'), moveHistory: $('move-history'),
    legend: $('legend'), hsPairs: $('hs-pairs'), hsProfile: $('hs-profile'), announcer: $('announcer'),
  };

  // ---------- Utilidades ----------
  // Enteros con punto de miles siempre (es-ES no agrupa números de 4 cifras): 8572 -> "8.572"
  const nf0 = { format: (n) => { const r = Math.round(n); const s = String(Math.abs(r)).replace(/\B(?=(\d{3})+(?!\d))/g, '.'); return (r < 0 ? '-' : '') + s; } };
  const nf1 = new Intl.NumberFormat('es-ES', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const nf2 = new Intl.NumberFormat('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmt1 = (n) => { const [i, d] = nf1.format(n).split(','); return i.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ',' + d; };
  const fmt = (n) => (Number.isFinite(n) ? nf0.format(Math.round(n)) : '—');
  const fmtPct = (x) => (Number.isFinite(x) ? nf1.format(x * 100) + ' %' : '—');
  const fmtSigned = (n) => (n > 0 ? '+' : n < 0 ? '−' : '±') + nf0.format(Math.abs(Math.round(n)));
  // Paleta alegre y distinguible sobre fondo blanco (sustituye a la del motor solo en la UI).
  const FAM_COLORS = { A: '#2563eb', B: '#ca8a04', C: '#16a34a', D: '#7c3aed', E: '#db2777', F: '#0d9488' };
  const famColor = (f) => FAM_COLORS[f] || (E.FAMILIES[f] && E.FAMILIES[f].color) || '#6b7280';
  const fmtCompact = (n) => {
    if (!Number.isFinite(n)) return '—';
    const a = Math.abs(n);
    if (a >= 1e6) return nf1.format(n / 1e6) + 'M';
    if (a >= 1e3) return nf1.format(n / 1e3) + 'k';
    return nf0.format(n);
  };
  const svgEl = (tag, attrs, parent) => {
    const n = document.createElementNS(SVG_NS, tag);
    if (attrs) for (const k in attrs) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  };
  const solverName = (id) => (E.SOLVERS.find((s) => s.id === id) || { name: id }).name;
  const isComplete = (a) => { for (let i = 0; i < a.length; i++) if (a[i] < 0) return false; return true; };
  const famName = (f) => E.FAMILIES[f].name;
  const announce = (msg) => { el.announcer.textContent = ''; setTimeout(() => { el.announcer.textContent = msg; }, 30); };
  const slotCenter = (s) => { const sl = S.inst.slots[s]; return [colX(sl.aisle - 1), rowY(sl.pos - 1)]; };

  function occupancyOf(assign) {
    const occ = new Int32Array(S.inst.numSlots).fill(-1);
    for (let h = 0; h < assign.length; h++) if (assign[h] >= 0) occ[assign[h]] = h;
    return occ;
  }
  function skuShare(assign, h) {
    const { W, D, numSkus } = S.inst;
    let c = 0;
    for (let k = 0; k < numSkus; k++) if (k !== h && assign[k] >= 0) c += W[h][k] * D[assign[h]][assign[k]];
    return c;
  }
  function topPartners(h, n) {
    const W = S.inst.W[h];
    const arr = [];
    for (let k = 0; k < S.inst.numSkus; k++) if (k !== h && W[k] > 0) arr.push({ k, w: W[k] });
    arr.sort((a, b) => b.w - a.w || a.k - b.k);
    return arr.slice(0, n);
  }

  // ---------- Construcción del SVG ----------
  let gSlots, gLinks, gSkus, gFocus, slotNodes = [], skuNodes = [];

  // ---------- Piezas reutilizables del plano (usadas por el plano interactivo y por Antes/Después) ----------
  const slotXY = (sl) => [colX(sl.aisle - 1), rowY(sl.pos - 1)];

  // Suelo: zonas, pasillos y andén. No depende del estado.
  function drawFloor(svg) {
    const xMin = colX(0) - G.slotW / 2 - 14, xMax = colX(3) + G.slotW / 2 + 14;
    const rowTop = (p) => rowY(p) - G.rowPitch / 2;
    const rowBot = (p) => rowY(p) + G.rowPitch / 2;
    const zones = [
      { name: 'Fondo', from: 5, to: 7, fill: 'rgba(100,116,139,0.06)' },
      { name: 'Medio', from: 3, to: 4, fill: 'rgba(234,179,8,0.09)' },
      { name: 'Frente', from: 0, to: 2, fill: 'rgba(22,163,74,0.08)' },
    ];
    const gz = svgEl('g', { 'aria-hidden': 'true' }, svg);
    zones.forEach((z, i) => {
      const y1 = rowTop(z.to), y2 = rowBot(z.from);
      svgEl('rect', { class: 'zone-band', x: 8, y: y1, width: xMax - 8, height: y2 - y1, rx: 10, fill: z.fill }, gz);
      if (i > 0) svgEl('line', { class: 'zone-line', x1: 8, x2: xMax, y1: y1, y2: y1 }, gz);
      const t = svgEl('text', { class: 'zone-label', x: 30, y: (y1 + y2) / 2, 'text-anchor': 'middle', transform: `rotate(-90 30 ${(y1 + y2) / 2})` }, gz);
      t.textContent = z.name;
    });
    for (let a = 0; a < 4; a++) {
      const cx = colX(a);
      svgEl('rect', { class: 'aisle-floor', x: cx - G.slotW / 2 - 8, y: G.top - 4, width: G.slotW + 16, height: G.rows * G.rowPitch + 8, rx: 12 }, gz);
      const t = svgEl('text', { class: 'aisle-label', x: cx, y: G.top - 16, 'text-anchor': 'middle' }, gz);
      t.textContent = `Pasillo ${a + 1}`;
    }
    const dockY = G.top + G.rows * G.rowPitch + 14;
    svgEl('rect', { class: 'dock', x: xMin, y: dockY, width: xMax - xMin, height: 30, rx: 10 }, gz);
    const dt = svgEl('text', { class: 'dock-label', x: (xMin + xMax) / 2, y: dockY + 19, 'text-anchor': 'middle' }, gz);
    dt.textContent = 'FRENTE DEL ALMACÉN · DESPACHO';
    return gz;
  }

  // Tarjeta de producto (SKU) con franja de familia, etiqueta de picks e insignia de "cambió".
  function makeSkuNode(parent, sku) {
    const w = G.slotW - 8, h = G.slotH - 6, col = famColor(sku.family);
    const g = svgEl('g', { class: 'sku', 'data-sku': sku.id - 1 }, parent);
    svgEl('rect', { class: 'sku-shadow', x: -w / 2, y: -h / 2 + 2.5, width: w, height: h, rx: 8 }, g);
    svgEl('rect', { class: 'sku-bg', x: -w / 2, y: -h / 2, width: w, height: h, rx: 8, stroke: col }, g);
    svgEl('rect', { x: -w / 2 + 3, y: -h / 2 + 3, width: 6, height: h - 6, rx: 3, fill: col }, g);
    const id = svgEl('text', { class: 'sku-id', x: -w / 2 + 15, y: -1 }, g);
    id.textContent = `SKU ${sku.id}`;
    const fam = svgEl('text', { class: 'sku-fam', x: -w / 2 + 15, y: 12 }, g);
    fam.textContent = sku.family === 'E' ? 'Cuid. personal' : famName(sku.family);
    svgEl('rect', { class: 'sku-price-bg', x: w / 2 - 38, y: -h / 2 + 4, width: 34, height: 15, rx: 7.5 }, g);
    const pk = svgEl('text', { class: 'sku-picks', x: w / 2 - 21, y: -h / 2 + 15, 'text-anchor': 'middle' }, g);
    pk.textContent = fmtCompact(sku.picks);
    const badge = svgEl('g', { class: 'sku-badge', transform: `translate(${-w / 2 + 2} ${-h / 2 + 1})` }, g);
    svgEl('circle', { r: 9 }, badge);
    const bt = svgEl('text', { y: 4, 'text-anchor': 'middle' }, badge);
    bt.textContent = '↻';
    g._picks = pk;
    g._x = null; g._y = null;
    return g;
  }

  function buildStatic() {
    const svg = el.svg;
    svg.textContent = '';
    drawFloor(svg);

    // Slots (interactivos)
    gSlots = svgEl('g', { class: 'slots' }, svg);
    slotNodes = S.inst.slots.map((sl) => {
      const [cx, cy] = slotCenter(sl.id);
      const g = svgEl('g', { class: 'slot', tabindex: '0', role: 'button', 'data-slot': sl.id, transform: `translate(${cx} ${cy})` }, gSlots);
      svgEl('rect', { class: 'slot-bg', x: -G.slotW / 2, y: -G.slotH / 2, width: G.slotW, height: G.slotH, rx: 9 }, g);
      svgEl('rect', { class: 'slot-ring', x: -G.slotW / 2 - 3, y: -G.slotH / 2 - 3, width: G.slotW + 6, height: G.slotH + 6, rx: 11 }, g);
      const n = svgEl('text', { class: 'slot-num', x: G.slotW / 2 - 5, y: G.slotH / 2 - 4, 'text-anchor': 'end' }, g);
      n.textContent = `${sl.aisle}-${sl.pos}`;
      const e = svgEl('text', { class: 'slot-empty-label', x: 0, y: 4, 'text-anchor': 'middle' }, g);
      e.textContent = 'vacío';
      g._empty = e;
      g._label = '';
      return g;
    });

    gSkus = svgEl('g', { class: 'skus', 'aria-hidden': 'true' }, svg);
    gLinks = svgEl('g', { class: 'links mode-cost', 'aria-hidden': 'true' }, svg);
    gFocus = svgEl('g', { class: 'focus-links', 'aria-hidden': 'true' }, svg);

    skuNodes = S.inst.skus.map((sku) => makeSkuNode(gSkus, sku));

    // Eventos de slots
    slotNodes.forEach((g, s) => {
      g.addEventListener('click', () => onSlotActivate(s));
      g.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); onSlotActivate(s); }
        else if (ev.key === 'Escape') { clearSelection(); }
      });
      g.addEventListener('mouseenter', () => showTooltip(s));
      g.addEventListener('mouseleave', hideTooltip);
      g.addEventListener('focus', () => showTooltip(s));
      g.addEventListener('blur', hideTooltip);
    });
  }

  function refreshSkuLabels() {
    // los picks cambian con el perfil de demanda
    S.inst.skus.forEach((sku, h) => { skuNodes[h]._picks.textContent = fmtCompact(sku.picks); });
  }

  // ---------- Render ----------
  function renderAssignment() {
    const a = S.assign;
    const occ = occupancyOf(a);
    for (let h = 0; h < skuNodes.length; h++) {
      const g = skuNodes[h];
      if (a[h] < 0) { g.classList.add('is-hidden'); continue; }
      g.classList.remove('is-hidden');
      const [x, y] = slotCenter(a[h]);
      if (g._x !== x || g._y !== y) {
        g.style.transform = `translate(${x}px, ${y}px)`;
        g._x = x; g._y = y;
      }
    }
    for (let s = 0; s < slotNodes.length; s++) {
      const g = slotNodes[s], o = occ[s];
      g._empty.style.display = o === -1 ? '' : 'none';
      const sl = S.inst.slots[s];
      const label = `Pasillo ${sl.aisle}, posición ${sl.pos}, zona ${sl.zone}: ` +
        (o === -1 ? 'vacía' : `SKU ${o + 1}, ${famName(S.inst.skus[o].family)}`);
      if (g._label !== label) { g.setAttribute('aria-label', label); g._label = label; }
      g.classList.toggle('is-selected', s === S.selected);
      g.setAttribute('aria-pressed', s === S.selected ? 'true' : 'false');
    }
    renderLinks();
    if (S.focusSku >= 0) renderFocus();
    updatePairDistances();
  }

  function curvePath(x1, y1, x2, y2, bend) {
    const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
    const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy) || 1;
    const off = bend * len;
    const cx = mx - (dy / len) * off, cy = my + (dx / len) * off;
    return `M${x1.toFixed(1)} ${y1.toFixed(1)}Q${cx.toFixed(1)} ${cy.toFixed(1)} ${x2.toFixed(1)} ${y2.toFixed(1)}`;
  }

  function renderLinks() {
    if (!el.showLinks.checked) { gLinks.innerHTML = ''; return; }
    const mode = el.linkMode.value;
    gLinks.setAttribute('class', 'links mode-' + mode);
    const { W, D, numSkus } = S.inst, a = S.assign;
    const list = [];
    for (let i = 0; i < numSkus; i++) {
      if (a[i] < 0) continue;
      for (let j = i + 1; j < numSkus; j++) {
        if (a[j] < 0 || W[i][j] <= 0) continue;
        const v = mode === 'cost' ? W[i][j] * D[a[i]][a[j]] : W[i][j];
        if (v > 0) list.push({ i, j, v });
      }
    }
    list.sort((p, q) => q.v - p.v);
    const top = list.slice(0, TOP_LINKS);
    if (!top.length) { gLinks.innerHTML = ''; return; }
    const vmax = top[0].v;
    let html = '';
    for (let t = top.length - 1; t >= 0; t--) {
      const { i, j, v } = top[t];
      const [x1, y1] = slotCenter(a[i]), [x2, y2] = slotCenter(a[j]);
      const r = v / vmax;
      html += `<path d="${curvePath(x1, y1, x2, y2, 0.14)}" stroke-width="${(0.8 + 4.2 * r).toFixed(2)}" opacity="${(0.14 + 0.5 * r).toFixed(2)}"/>`;
    }
    gLinks.innerHTML = html;
  }

  function renderFocus() {
    if (!gFocus) return;
    const h = S.focusSku;
    skuNodes.forEach((g) => { g.classList.remove('is-focus', 'is-partner'); });
    gFocus.innerHTML = '';
    if (h < 0 || S.assign[h] < 0) { el.svg.classList.remove('has-focus'); return; }
    el.svg.classList.add('has-focus');
    skuNodes[h].classList.add('is-focus');
    const partners = topPartners(h, 3);
    const [x1, y1] = slotCenter(S.assign[h]);
    let html = '';
    partners.forEach(({ k, w }) => {
      skuNodes[k].classList.add('is-partner');
      if (S.assign[k] < 0) return;
      const [x2, y2] = slotCenter(S.assign[k]);
      html += `<path d="${curvePath(x1, y1, x2, y2, 0.18)}" stroke-width="2.2"/>`;
      html += `<text x="${((x1 + x2) / 2).toFixed(1)}" y="${((y1 + y2) / 2 - 6).toFixed(1)}" text-anchor="middle">${fmt(w)}</text>`;
    });
    gFocus.innerHTML = html;
  }

  // ---------- Tooltip ----------
  function showTooltip(s) {
    if (!S.assign) return;
    const occ = occupancyOf(S.assign);
    const h = occ[s];
    const sl = S.inst.slots[s];
    let html;
    if (h === -1) {
      html = `<h4>Ubicación vacía</h4><div class="tt-meta">Pasillo ${sl.aisle} · posición ${sl.pos} · ${sl.zone}</div>` +
        `<div class="tt-meta" style="margin:0">Selecciona un SKU y luego esta ubicación para moverlo aquí.</div>`;
      S.focusSku = -1;
    } else {
      const sku = S.inst.skus[h];
      const partners = topPartners(h, 3);
      const D = S.inst.D;
      html = `<h4><i style="background:${famColor(sku.family)}"></i>SKU ${sku.id}</h4>` +
        `<div class="tt-meta">${famName(sku.family)} · <strong>${fmt(sku.picks)}</strong> picks/año<br>` +
        `Pasillo ${sl.aisle} · posición ${sl.pos} · ${sl.zone}<br>Aporte al costo: <strong>${fmt(skuShare(S.assign, h))}</strong></div>` +
        `<div class="tt-sub">Co-picking más fuerte</div>`;
      if (partners.length) {
        html += '<ol>' + partners.map(({ k, w }) => {
          const p = S.inst.skus[k];
          const d = S.assign[k] >= 0 ? D[S.assign[h]][S.assign[k]] : NaN;
          return `<li>SKU ${p.id} <span>(${famName(p.family)}) · frec. ${fmt(w)} · dist. ${Number.isFinite(d) ? d : '—'}</span></li>`;
        }).join('') + '</ol>';
      } else {
        html += '<div class="tt-meta">Sin co-picking con esta densidad.</div>';
      }
      S.focusSku = h;
    }
    el.tooltip.innerHTML = html;
    el.tooltip.hidden = false;
    renderFocus();
    // Posición
    const wr = el.wrap.getBoundingClientRect();
    const r = slotNodes[s].getBoundingClientRect();
    const tw = el.tooltip.offsetWidth, th = el.tooltip.offsetHeight;
    let x = r.right - wr.left + 10;
    if (x + tw > wr.width) x = r.left - wr.left - tw - 10;
    if (x < 4) x = Math.max(4, Math.min(wr.width - tw - 4, r.left - wr.left));
    let y = r.top - wr.top + r.height / 2 - th / 2;
    y = Math.max(4, Math.min(wr.height - th - 4, y));
    el.tooltip.style.left = x + 'px';
    el.tooltip.style.top = y + 'px';
  }
  function hideTooltip() {
    el.tooltip.hidden = true;
    S.focusSku = -1;
    renderFocus();
  }

  // ---------- Métricas ----------
  function shownBest() {
    let c = S.best ? S.best.cost : Infinity, by = S.best ? S.best.by : '';
    if (S.gen && Number.isFinite(S.runBest) && S.runBest < c - 1e-9) { c = S.runBest; by = solverName(S.runSolver) + ' (en curso)'; }
    return { c, by };
  }

  function renderMetrics(snap) {
    const complete = S.assign && isComplete(S.assign);
    el.mCost.textContent = complete ? fmt(S.cost) : '—';
    el.mCostSub.textContent = complete ? 'distancia ponderada' : 'construyendo…';
    el.mStart.textContent = fmt(S.baselineCost);
    const b = shownBest();
    el.mBest.textContent = Number.isFinite(b.c) ? fmt(b.c) : '—';
    el.mBestBy.textContent = Number.isFinite(b.c) ? b.by : 'ejecuta un solver';
    el.mImpr.textContent = Number.isFinite(b.c) ? fmtPct((S.baselineCost - b.c) / S.baselineCost) : '—';
    el.mImprCur.textContent = complete ? `asignación actual: ${fmtPct((S.baselineCost - S.cost) / S.baselineCost)}` : '';
    el.mGap.textContent = complete && Number.isFinite(b.c) ? (S.cost - b.c <= 0.5 ? 'óptima conocida' : '+' + fmtPct((S.cost - b.c) / b.c)) : '—';

    if (snap) {
      // En la fase de pulido del híbrido el contador de iteraciones se reinicia: el progreso se mantiene monótono.
      const polishing = snap.label === 'Pulido local';
      const pct = Math.max(S.runPct || 0, snap.maxIter ? Math.min(1, snap.iter / snap.maxIter) : 0);
      S.runPct = pct;
      el.mProgressBar.style.width = (pct * 100).toFixed(1) + '%';
      el.mProgress.setAttribute('aria-valuenow', String(Math.round(pct * 100)));
      el.mIter.textContent = polishing
        ? `Fase final de pulido · paso ${fmt(S.history.length)}`
        : `Iteración ${fmt(snap.iter)} de ${fmt(snap.maxIter)} (${Math.round(pct * 100)} %) · paso ${fmt(S.history.length)}`;
      el.mTemp.textContent = snap.temp == null ? 'n/a' : (snap.temp >= 100 ? fmt(snap.temp) : snap.temp.toFixed(snap.temp >= 1 ? 1 : 3));
      el.mStage.textContent = `${solverName(S.runSolver)} · ${snap.label}`;
    }
  }

  function resetProgress(stage) {
    el.mProgressBar.style.width = '0%';
    el.mProgress.setAttribute('aria-valuenow', '0');
    el.mIter.textContent = '—';
    el.mTemp.textContent = '—';
    el.mStage.textContent = stage || 'En espera';
  }

  // ---------- Gráfico de convergencia ----------
  function drawChart() {
    const svg = el.chart;
    const W = 360, H = 200, L = 46, R = 10, T = 12, B = 26;
    const pts = S.history;
    let html = '';
    const finite = pts.filter((p) => Number.isFinite(p.c));
    if (!finite.length) {
      html += `<rect class="frame" x="${L}" y="${T}" width="${W - L - R}" height="${H - T - B}"/>`;
      html += `<text class="empty" x="${(L + W - R) / 2}" y="${H / 2}" text-anchor="middle">Ejecuta un solver para ver la convergencia</text>`;
      svg.innerHTML = html;
      return;
    }
    let lo = Infinity, hi = -Infinity;
    for (const p of finite) { lo = Math.min(lo, p.c, p.b); hi = Math.max(hi, p.c, p.b); }
    if (Number.isFinite(S.baselineCost)) hi = Math.max(hi, S.baselineCost);
    const pad = (hi - lo) * 0.06 || hi * 0.05 || 1;
    lo = Math.max(0, lo - pad); hi += pad;
    const n = Math.max(pts.length - 1, 1);
    const X = (i) => L + (i / n) * (W - L - R);
    const Y = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);

    html += '<g class="grid">';
    const ticks = 4;
    let axis = '<g class="axis">';
    for (let t = 0; t <= ticks; t++) {
      const v = lo + (t / ticks) * (hi - lo), y = Y(v);
      html += `<line x1="${L}" x2="${W - R}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}"/>`;
      axis += `<text x="${L - 6}" y="${(y + 3).toFixed(1)}" text-anchor="end">${fmtCompact(v)}</text>`;
    }
    html += '</g>';
    axis += `<text x="${L}" y="${H - 9}" text-anchor="start">0</text><text x="${W - R}" y="${H - 9}" text-anchor="end">${fmt(pts.length - 1)}</text>`;
    axis += `<text class="axis-title" x="${(L + W - R) / 2}" y="${H - 9}" text-anchor="middle">paso del solver</text></g>`;
    html += axis;

    if (Number.isFinite(S.baselineCost)) {
      const yb = Y(S.baselineCost).toFixed(1);
      html += `<line class="l-base" x1="${L}" x2="${W - R}" y1="${yb}" y2="${yb}"/>`;
    }
    const line = (key) => {
      let d = '', pen = false;
      // Submuestreo si hay muchos puntos
      const stride = Math.max(1, Math.floor(pts.length / 600));
      for (let i = 0; i < pts.length; i += stride) {
        const v = pts[i][key];
        if (!Number.isFinite(v)) { pen = false; continue; }
        d += (pen ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(v).toFixed(1);
        pen = true;
      }
      const last = pts[pts.length - 1][key];
      if (Number.isFinite(last)) d += (pen ? 'L' : 'M') + X(pts.length - 1).toFixed(1) + ' ' + Y(last).toFixed(1);
      return d;
    };
    html += `<path class="l-cur" d="${line('c')}"/>`;
    html += `<path class="l-best" d="${line('b')}"/>`;
    const lb = finite[finite.length - 1].b;
    html += `<circle cx="${X(pts.length - 1).toFixed(1)}" cy="${Y(lb).toFixed(1)}" r="3.5" class="dot"/>`;
    svg.innerHTML = html;
  }

  // ---------- Botones / estado de ejecución ----------
  function updateButtons() {
    const txt = el.run.querySelector('.btn-text'), icon = el.run.querySelector('.btn-icon');
    if (S.running) {
      txt.textContent = 'Pausar'; icon.textContent = '❚❚';
      el.run.classList.add('is-running');
      el.run.setAttribute('aria-label', 'Pausar el solver');
    } else if (S.gen) {
      txt.textContent = 'Continuar'; icon.textContent = '▶';
      el.run.classList.remove('is-running');
      el.run.setAttribute('aria-label', 'Continuar el solver en pausa');
    } else {
      txt.textContent = 'Resolver'; icon.textContent = '▶';
      el.run.classList.remove('is-running');
      el.run.setAttribute('aria-label', 'Resolver con el algoritmo seleccionado');
    }
    const busy = S.compareBusy;
    el.run.disabled = busy;
    el.reset.disabled = busy;
    el.random.disabled = busy;
    el.compare.disabled = busy;
    el.density.disabled = busy;
    el.profile.disabled = busy;
    el.solver.disabled = busy;
    el.bestBtn.disabled = busy || !S.best;
  }

  function setStatus(msg) { el.planStatus.textContent = msg || ''; }

  function setMoveDuration() {
    const sp = SPEEDS[+el.speed.value];
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    document.documentElement.style.setProperty('--move-dur', (reduce ? 0 : sp.dur) + 'ms');
  }

  function solverOpts(id) {
    if (id === 'sa' || id === 'local') return { start: S.baseline };
    return {};
  }

  function startRun() {
    clearSelection(true);
    const id = el.solver.value;
    S.runSolver = id;
    S.gen = E.createSolver(id, S.inst, solverOpts(id));
    S.history = [];
    S.runBest = Infinity;
    S.lastSnap = null;
    S.runPct = 0;
    S.frame = 0;
    if (id === 'greedy') {
      S.assign = new Int32Array(S.inst.numSkus).fill(-1);
      S.cost = NaN;
    } else {
      S.assign = Int32Array.from(S.baseline);
      S.cost = S.baselineCost;
      S.history.push({ c: S.baselineCost, b: S.baselineCost });
    }
    renderAssignment();
    drawChart();
    resetProgress(`${solverName(id)} · iniciando`);
    setStatus(`Ejecutando: ${solverName(id)}`);
    announce(`Ejecutando ${solverName(id)}`);
    resume();
  }

  function resume() {
    S.running = true;
    updateButtons();
    cancelAnimationFrame(S.raf);
    S.raf = requestAnimationFrame(tick);
  }

  function pause() {
    S.running = false;
    cancelAnimationFrame(S.raf);
    updateButtons();
    setStatus(`En pausa: ${solverName(S.runSolver)}`);
  }

  function discardRun() {
    S.running = false;
    S.gen = null;
    cancelAnimationFrame(S.raf);
    updateButtons();
  }

  function recordSnap(snap) {
    S.lastSnap = snap;
    if (Number.isFinite(snap.bestCost) && snap.bestCost < S.runBest) S.runBest = snap.bestCost;
    S.history.push({ c: snap.cost, b: Number.isFinite(snap.bestCost) ? Math.min(snap.bestCost, S.runBest) : NaN });
  }

  function applySnap(snap) {
    S.assign = snap.assign;
    S.cost = snap.cost;
    renderAssignment();
    renderMetrics(snap);
    drawChart();
  }

  function tick() {
    if (!S.running || !S.gen) return;
    const sp = SPEEDS[+el.speed.value];
    S.frame++;
    if (S.frame % sp.every === 0) {
      const t0 = performance.now();
      let snap = null, done = false;
      for (let i = 0; i < sp.steps; i++) {
        const r = S.gen.next();
        if (r.done) { done = true; break; }
        snap = r.value;
        recordSnap(snap);
        if (performance.now() - t0 > FRAME_BUDGET_MS) break;
      }
      if (snap) applySnap(snap);
      if (done) { finishRun(); return; }
    }
    S.raf = requestAnimationFrame(tick);
  }

  function finishRun() {
    const snap = S.lastSnap;
    const id = S.runSolver;
    discardRun();
    if (!snap) return;
    S.assign = Int32Array.from(snap.bestAssign);
    S.cost = E.cost(S.inst, S.assign);
    const improvedGlobal = updateBest(S.assign, S.cost, solverName(id));
    renderAssignment();
    renderMetrics(snap);
    el.mStage.textContent = `${solverName(id)} · terminado`;
    el.mIter.textContent = `Completado en ${fmt(S.history.length)} pasos animados`;
    el.mProgressBar.style.width = '100%';
    el.mProgress.setAttribute('aria-valuenow', '100');
    drawChart();
    flashAll();
    const msg = `${solverName(id)} terminó: costo ${fmt(S.cost)} (${fmtPct((S.baselineCost - S.cost) / S.baselineCost)} mejor que la aleatoria)` + (improvedGlobal ? ' · nuevo mejor' : '');
    setStatus(msg);
    announce(msg);
    updateButtons();
  }

  function updateBest(assign, cost, by) {
    if (!S.best || cost < S.best.cost - 1e-9) {
      S.best = { assign: Int32Array.from(assign), cost, by };
      updateButtons();
      return true;
    }
    return false;
  }

  function flashAll() {
    skuNodes.forEach((g) => { g.classList.remove('flash'); void g.getBBox; });
    requestAnimationFrame(() => skuNodes.forEach((g) => g.classList.add('flash')));
    setTimeout(() => skuNodes.forEach((g) => g.classList.remove('flash')), 700);
  }

  // ---------- Modo manual ----------
  function clearSelection(silent) {
    if (S.selected === -1) return;
    S.selected = -1;
    slotNodes.forEach((g) => { g.classList.remove('is-selected'); g.setAttribute('aria-pressed', 'false'); });
    if (!silent) setStatus('');
  }

  function onSlotActivate(s) {
    if (S.compareBusy) return;
    let prefix = '';
    if (S.gen) {
      if (!isComplete(S.assign)) {
        setStatus('Espera a que el solver termine de construir la solución, o pulsa Reiniciar.');
        return;
      }
      discardRun();
      resetProgress('Modo manual');
      prefix = 'Solver detenido (modo manual). ';
    }
    const occ = occupancyOf(S.assign);
    if (S.selected === -1) {
      S.selected = s;
      renderAssignment();
      const o = occ[s];
      setStatus(prefix + (o === -1 ? 'Ubicación vacía seleccionada: elige un SKU para traerlo aquí.' : `SKU ${o + 1} seleccionado: elige otra ubicación para intercambiar.`));
      return;
    }
    if (S.selected === s) { clearSelection(); renderAssignment(); return; }

    const a = S.selected, b = s;
    S.selected = -1;
    const ha = occ[a], hb = occ[b];
    if (ha === -1 && hb === -1) {
      renderAssignment();
      setStatus('Ambas ubicaciones están vacías: no hay nada que mover.');
      return;
    }
    const before = S.cost;
    const assign = Int32Array.from(S.assign);
    let delta, label;
    if (ha !== -1 && hb !== -1) {
      delta = E.deltaSwap(S.inst, assign, ha, hb);
      const t = assign[ha]; assign[ha] = assign[hb]; assign[hb] = t;
      label = `SKU ${ha + 1} ⇄ SKU ${hb + 1}`;
    } else {
      const h = ha !== -1 ? ha : hb, target = ha !== -1 ? b : a;
      delta = E.deltaMove(S.inst, assign, h, target);
      assign[h] = target;
      const sl = S.inst.slots[target];
      label = `SKU ${h + 1} → ${sl.aisle}-${sl.pos} (vacío)`;
    }
    S.assign = assign;
    S.cost = E.cost(S.inst, assign);
    delta = S.cost - before; // exacto (coincide con el delta incremental)
    logMove(label, delta);
    renderAssignment();
    renderMetrics();
    const touched = ha !== -1 && hb !== -1 ? [ha, hb] : [ha !== -1 ? ha : hb];
    touched.forEach((h) => { const g = skuNodes[h]; g.classList.remove('flash'); requestAnimationFrame(() => g.classList.add('flash')); setTimeout(() => g.classList.remove('flash'), 700); });
    setStatus(`${label}: Δ ${fmtSigned(delta)} · costo ${fmt(S.cost)}`);
    // refrescar tooltip si el foco sigue en el slot
    if (document.activeElement === slotNodes[s]) showTooltip(s);
  }

  function logMove(label, delta) {
    const cls = delta < -0.5 ? 'good' : delta > 0.5 ? 'bad' : 'zero';
    const rel = Number.isFinite(S.cost - delta) && S.cost - delta !== 0 ? delta / (S.cost - delta) : 0;
    const b = shownBest();
    const vsBest = Number.isFinite(b.c)
      ? (S.cost - b.c <= 0.5 ? 'igual o mejor que la mejor conocida' : `+${fmtPct((S.cost - b.c) / b.c)} vs. mejor`)
      : 'aún sin solución de referencia';
    el.moveLast.innerHTML = `<strong>${label}</strong><br>Δ costo: <span class="delta ${cls}">${fmtSigned(delta)}</span> (${delta > 0 ? '+' : ''}${fmtPct(rel)})<br>` +
      `Costo: <strong>${fmt(S.cost)}</strong> · ${vsBest}`;
    S.moves.unshift({ label, delta, cls });
    S.moves = S.moves.slice(0, 12);
    el.moveHistory.innerHTML = S.moves.map((m) => `<li><span>${m.label}</span><span class="delta ${m.cls}">${m.delta == null ? '' : fmtSigned(m.delta)}</span></li>`).join('');
    announce(`${label}. Cambio de costo ${fmtSigned(delta)}. Costo actual ${fmt(S.cost)}.`);
  }

  function resetMoves() {
    S.moves = [];
    el.moveHistory.innerHTML = '';
    el.moveLast.textContent = 'Aún no hay movimientos manuales.';
  }

  // ---------- Acciones ----------
  function doReset() {
    discardRun();
    clearSelection(true);
    S.assign = Int32Array.from(S.baseline);
    S.cost = S.baselineCost;
    S.history = [];
    resetProgress();
    renderAssignment();
    renderMetrics();
    drawChart();
    setStatus('Asignación de partida (aleatoria de referencia).');
  }

  function doRandom() {
    discardRun();
    clearSelection(true);
    const before = S.cost;
    S.assign = E.randomAssignment(S.inst, (Math.random() * 2 ** 31) >>> 0);
    S.cost = E.cost(S.inst, S.assign);
    resetProgress('Modo manual');
    logMove('Asignación aleatoria', Number.isFinite(before) ? S.cost - before : null);
    renderAssignment();
    renderMetrics();
    setStatus(`Nueva asignación aleatoria: costo ${fmt(S.cost)}`);
  }

  function doApplyBest() {
    if (!S.best) return;
    discardRun();
    clearSelection(true);
    const before = S.cost;
    S.assign = Int32Array.from(S.best.assign);
    S.cost = E.cost(S.inst, S.assign);
    resetProgress('Mejor solución aplicada');
    logMove(`Mejor solución (${S.best.by})`, Number.isFinite(before) ? S.cost - before : null);
    renderAssignment();
    renderMetrics();
    flashAll();
    setStatus(`Mejor solución aplicada: costo ${fmt(S.cost)} (${S.best.by})`);
  }

  function onRunClick() {
    if (S.running) pause();
    else if (S.gen) { setStatus(`Ejecutando: ${solverName(S.runSolver)}`); resume(); }
    else startRun();
  }

  // ---------- Comparativa ----------
  function renderCompare() {
    const rows = S.compare || [];
    if (!rows.length) {
      el.cmpBody.innerHTML = '<tr class="empty-row"><td colspan="5">Pulsa «Comparar todos los solvers» para ejecutar las cuatro heurísticas sobre la instancia actual.</td></tr>';
      return;
    }
    const done = rows.filter((r) => r.cost != null);
    const bestCost = done.length ? Math.min(...done.map((r) => r.cost)) : Infinity;
    const maxImpr = done.length ? Math.max(...done.map((r) => r.impr)) : 1;
    el.cmpBody.innerHTML = rows.map((r, i) => {
      if (r.cost == null) {
        return `<tr><th scope="row">${solverName(r.id)}</th><td class="num muted" colspan="3">${r.pending ? 'ejecutando…' : 'en cola'}</td><td></td></tr>`;
      }
      const isBest = Math.abs(r.cost - bestCost) < 0.5;
      const w = maxImpr > 0 ? Math.max(0, r.impr / maxImpr) * 100 : 0;
      return `<tr class="${isBest ? 'is-best' : ''}">` +
        `<th scope="row">${solverName(r.id)}${isBest ? '<span class="badge">mejor</span>' : ''}</th>` +
        `<td class="num">${fmt(r.cost)}</td>` +
        `<td class="num"><div class="bar-cell"><span>${fmtPct(r.impr)}</span><span class="mini-bar" aria-hidden="true"><i style="width:${w.toFixed(1)}%"></i></span></div></td>` +
        `<td class="num">${r.ms < 10 ? r.ms.toFixed(2) : fmt(r.ms)}</td>` +
        `<td class="num"><button type="button" class="btn btn-sm" data-cmp="${i}" aria-label="Ver la solución de ${solverName(r.id)} en el plano">Ver en plano</button></td></tr>`;
    }).join('');
  }

  function runCompare() {
    if (S.compareBusy) return;
    discardRun();
    clearSelection(true);
    S.compareBusy = true;
    updateButtons();
    setStatus('Comparando los 4 solvers…');
    S.compare = E.SOLVERS.map((s) => ({ id: s.id, cost: null, pending: false }));
    renderCompare();
    const inst = S.inst;
    let idx = 0;
    const step = () => {
      if (inst !== S.inst) { S.compareBusy = false; updateButtons(); return; }
      if (idx >= S.compare.length) {
        S.compareBusy = false;
        updateButtons();
        renderMetrics();
        const best = S.compare.reduce((p, q) => (q.cost < p.cost ? q : p));
        const msg = `Comparativa lista: mejor ${solverName(best.id)} con costo ${fmt(best.cost)}.`;
        setStatus(msg);
        announce(msg);
        return;
      }
      const row = S.compare[idx];
      row.pending = true;
      renderCompare();
      setTimeout(() => {
        const gen = E.createSolver(row.id, inst, solverOpts(row.id));
        const t0 = performance.now();
        let last = null;
        for (const s of gen) last = s;
        const ms = performance.now() - t0;
        row.assign = Int32Array.from(last.bestAssign);
        row.cost = E.cost(inst, row.assign);
        row.impr = (S.baselineCost - row.cost) / S.baselineCost;
        row.ms = ms;
        row.pending = false;
        updateBest(row.assign, row.cost, solverName(row.id));
        renderCompare();
        renderMetrics();
        idx++;
        setTimeout(step, 30);
      }, 30);
    };
    step();
  }

  function applyCompareRow(i) {
    const r = S.compare && S.compare[i];
    if (!r || !r.assign) return;
    discardRun();
    clearSelection(true);
    const before = S.cost;
    S.assign = Int32Array.from(r.assign);
    S.cost = E.cost(S.inst, S.assign);
    resetProgress(`Solución de ${solverName(r.id)}`);
    logMove(`Solución de ${solverName(r.id)}`, Number.isFinite(before) ? S.cost - before : null);
    renderAssignment();
    renderMetrics();
    flashAll();
    setStatus(`Mostrando solución de ${solverName(r.id)}: costo ${fmt(S.cost)}`);
    el.svg.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }


  // ---------- Relaciones del mes ----------
  const P = { month: null, seed: 1, shown: 15, rows: [] };

  function skuChip(i) {
    const s = S.inst.skus[i];
    const fam = E.FAMILIES[s.family].name;
    return `<span class="sku-chip"><span class="sku-dot" style="background:${famColor(s.family)}"></span>SKU ${s.id} <span class="muted">· ${fam}</span></span>`;
  }

  function pairDistance(i, j) {
    return S.inst.D[S.assign[i]][S.assign[j]];
  }

  function filteredPairs() {
    const fam = $('pairs-family').value;
    const q = $('pairs-search').value.trim();
    return P.month.pairs.filter((p) => {
      const a = S.inst.skus[p.i], b = S.inst.skus[p.j];
      if (fam && a.family !== fam && b.family !== fam) return false;
      if (q && String(a.id) !== q && String(b.id) !== q) return false;
      return true;
    });
  }

  function renderPairs() {
    if (!P.month) return;
    const list = filteredPairs();
    const max = P.month.pairs.length ? P.month.pairs[0].count : 1;
    P.rows = list.slice(0, P.shown);
    $('pairs-body').innerHTML = P.rows.map((p, r) => `<tr>
      <td class="num">${r + 1}</td><td>${skuChip(p.i)}</td><td>${skuChip(p.j)}</td>
      <td class="num"><div class="cnt-cell"><span class="cnt-bar"><i style="width:${(p.count / max * 100).toFixed(1)}%"></i></span><span class="cnt-val">${p.count}</span></div></td>
      <td class="num">${fmtPct(p.share)}</td><td class="num" data-dist="${r}"></td></tr>`).join('')
      || '<tr class="empty-row"><td colspan="6">Ningún par coincide con el filtro.</td></tr>';
    $('btn-pairs-more').hidden = list.length <= P.shown;
    $('btn-pairs-more').textContent = `Ver más pares (${list.length - P.shown} restantes)`;
    $('pairs-summary').textContent = `Mes simulado: ${fmt(P.month.numBaskets)} canastas · ${fmt(P.month.pairs.length)} pares distintos con al menos una coincidencia · mostrando ${P.rows.length} de ${list.length}.`;
    updatePairDistances();
  }

  function updatePairDistances() {
    if (!P.month) return;
    document.querySelectorAll('#pairs-body [data-dist]').forEach((td) => {
      const p = P.rows[+td.dataset.dist];
      const d = pairDistance(p.i, p.j);
      td.textContent = d;
      td.className = 'num ' + (d <= 2 ? 'dist-near' : d >= 10 ? 'dist-far' : '');
    });
  }

  function rebuildMonth() {
    P.month = E.simulateMonth(S.inst, { seed: P.seed });
    P.shown = 15;
    renderPairs();
  }

  function initPairs() {
    const sel = $('pairs-family');
    Object.keys(E.FAMILIES).forEach((f) => {
      const o = document.createElement('option');
      o.value = f; o.textContent = `${f} · ${E.FAMILIES[f].name}`;
      sel.appendChild(o);
    });
    sel.addEventListener('change', () => { P.shown = 15; renderPairs(); });
    $('pairs-search').addEventListener('input', () => { P.shown = 15; renderPairs(); });
    $('btn-month').addEventListener('click', () => { P.seed++; rebuildMonth(); });
    $('btn-pairs-more').addEventListener('click', () => { P.shown += 25; renderPairs(); });
  }

  // ---------- Instancia ----------
  function rebuildInstance() {
    discardRun();
    hideTooltip();
    const density = +el.density.value / 100;
    const profile = +el.profile.value;
    const firstBuild = !S.inst;
    S.inst = E.buildInstance({ density, profile });
    S.baseline = E.randomAssignment(S.inst, BASELINE_SEED);
    S.baselineCost = E.cost(S.inst, S.baseline);
    S.assign = Int32Array.from(S.baseline);
    S.cost = S.baselineCost;
    S.best = null;
    S.history = [];
    S.selected = -1;
    S.compare = null;
    if (firstBuild) buildStatic(); else refreshSkuLabels();
    resetMoves();
    rebuildMonth();
    renderCompare();
    resetProgress();
    renderAssignment();
    renderMetrics();
    drawChart();
    updateButtons();
    const p = E.PROFILES.find((x) => x.id === profile);
    el.hsPairs.textContent = `${S.inst.nonzeroPairs} / ${S.inst.totalPairs} (${Math.round(S.inst.density * 100)} %)`;
    el.hsProfile.textContent = p ? p.name : '—';
    if (!firstBuild) setStatus(`Nueva instancia: densidad ${Math.round(density * 100)} %, perfil «${p.name}». Costo de partida ${fmt(S.baselineCost)}.`);
  }

  // ---------- Inicialización ----------
  function init() {
    initPairs();
    // Selectores
    el.profile.innerHTML = E.PROFILES.map((p) => `<option value="${p.id}">${p.name}</option>`).join('');
    el.solver.innerHTML = E.SOLVERS.map((s) => `<option value="${s.id}">${s.name}</option>`).join('');
    el.solver.value = 'hybrid';
    const updProfileHelp = () => { const p = E.PROFILES.find((x) => x.id === +el.profile.value); el.profileHelp.textContent = p ? p.desc : ''; };
    const updSolverHelp = () => { const s = E.SOLVERS.find((x) => x.id === el.solver.value); el.solverHelp.textContent = s ? s.desc : ''; };
    updProfileHelp(); updSolverHelp();

    // Leyenda
    el.legend.innerHTML = Object.keys(E.FAMILIES).map((k) => `<li><i style="background:${famColor(k)}"></i>${E.FAMILIES[k].name}</li>`).join('') +
      '<li><i style="border:1.5px dashed #8a909a"></i>Ubicación vacía</li>';

    el.density.addEventListener('input', () => { el.densityOut.textContent = el.density.value + ' %'; rebuildInstance(); });
    el.profile.addEventListener('change', () => { updProfileHelp(); rebuildInstance(); });
    el.solver.addEventListener('change', () => {
      updSolverHelp();
      if (S.gen) { discardRun(); resetProgress(); setStatus('Solver cambiado: pulsa Resolver para empezar.'); }
    });
    el.speed.addEventListener('input', () => { el.speedOut.textContent = SPEEDS[+el.speed.value].label; setMoveDuration(); });
    el.speedOut.textContent = SPEEDS[+el.speed.value].label;
    setMoveDuration();

    el.run.addEventListener('click', onRunClick);
    el.reset.addEventListener('click', doReset);
    el.random.addEventListener('click', doRandom);
    el.bestBtn.addEventListener('click', doApplyBest);
    el.compare.addEventListener('click', runCompare);
    el.cmpBody.addEventListener('click', (ev) => {
      const b = ev.target.closest('button[data-cmp]');
      if (b) applyCompareRow(+b.dataset.cmp);
    });
    el.showLinks.addEventListener('change', renderLinks);
    el.linkMode.addEventListener('change', renderLinks);
    document.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape' && S.selected !== -1) { clearSelection(); renderAssignment(); }
    });

    rebuildInstance();
    setStatus('Pulsa Resolver o intercambia SKUs haciendo clic en dos ubicaciones.');
    initQuantum();
  }

  // =====================================================================
  // ANTES vs. DESPUÉS — clásico vs. cuántico.
  // Todo número sale de window.QuantumData (precalculado en simulador local) o del motor.
  // Convención del archivo: cada par i<k una vez; el plano cuenta pares ordenados -> x2.
  // =====================================================================
  const QX = 2;
  const Q = { views: {}, sel: null, hl: 'ab', pickPair: null, hoverPair: null, morphKey: 'ant-des', t: 0, anim: 0 };
  const reduceMotion = () => !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const pctDown = (from, to) => (from > 0 ? (from - to) / from : NaN);
  const discTxt = (x) => (Number.isFinite(x) ? (x > 0 ? '−' : x < 0 ? '+' : '±') + nf1.format(Math.abs(x) * 100) + ' %' : '—');
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // Vista de plano reutilizable (no interactiva): suelo + slots + tarjetas de SKU.
  function createPlanView(svg, inst, opts) {
    opts = opts || {};
    svg.textContent = '';
    drawFloor(svg);
    const gSl = svgEl('g', { class: 'slots', 'aria-hidden': 'true' }, svg);
    inst.slots.forEach((sl) => {
      const [cx, cy] = slotXY(sl);
      const g = svgEl('g', { class: 'slot slot-static', transform: `translate(${cx} ${cy})` }, gSl);
      svgEl('rect', { class: 'slot-bg', x: -G.slotW / 2, y: -G.slotH / 2, width: G.slotW, height: G.slotH, rx: 9 }, g);
      const n = svgEl('text', { class: 'slot-num', x: G.slotW / 2 - 5, y: G.slotH / 2 - 4, 'text-anchor': 'end' }, g);
      n.textContent = `${sl.aisle}-${sl.pos}`;
    });
    const gS = svgEl('g', { class: 'skus', 'aria-hidden': 'true' }, svg);
    const gP = svgEl('g', { class: 'pair-links', 'aria-hidden': 'true' }, svg);
    const nodes = inst.skus.map((sku) => makeSkuNode(gS, sku));
    const view = {
      svg, inst, nodes, assign: null, pair: null,
      place(h, x, y) {
        const g = nodes[h];
        if (g._x !== x || g._y !== y) { g.style.transform = `translate(${x}px, ${y}px)`; g._x = x; g._y = y; }
      },
      setAssign(a) {
        view.assign = a;
        for (let h = 0; h < nodes.length; h++) { const [x, y] = slotXY(inst.slots[a[h]]); view.place(h, x, y); }
        view.drawPair();
      },
      mark(set) { nodes.forEach((g, h) => g.classList.toggle('is-diff', !!(set && set.has(h)))); },
      setPair(p, showDist) { view.pair = p; view.showDist = showDist !== false; view.drawPair(); },
      drawPair() {
        nodes.forEach((g) => g.classList.remove('is-focus', 'is-partner'));
        const p = view.pair;
        if (!p || !view.assign) { svg.classList.remove('has-focus'); gP.innerHTML = ''; return; }
        const [h, k] = p;
        svg.classList.add('has-focus');
        nodes[h].classList.add('is-focus');
        nodes[k].classList.add('is-partner');
        const x1 = nodes[h]._x, y1 = nodes[h]._y, x2 = nodes[k]._x, y2 = nodes[k]._y;
        let html = `<path d="${curvePath(x1, y1, x2, y2, 0.18)}"/>`;
        if (view.showDist) {
          const d = inst.D[view.assign[h]][view.assign[k]];
          html += `<text x="${((x1 + x2) / 2).toFixed(1)}" y="${((y1 + y2) / 2 - 8).toFixed(1)}" text-anchor="middle">d = ${d}</text>`;
        }
        gP.innerHTML = html;
      },
    };
    if (opts.onHover) {
      nodes.forEach((g, h) => g.addEventListener('pointerenter', () => opts.onHover(h)));
      svg.addEventListener('pointerleave', () => opts.onHover(-1));
    }
    return view;
  }

  function strongestPartner(inst, h) {
    let best = -1, bw = 0;
    for (let k = 0; k < inst.numSkus; k++) if (k !== h && inst.W[h][k] > bw) { bw = inst.W[h][k]; best = k; }
    return best;
  }

  function initQuantum() {
    const QD = window.QuantumData;
    const ok = QD && Array.isArray(QD.initial) && QD.quantumV2 && Array.isArray(QD.classical) && QD.classical.length;
    if (!ok) {
      $('ad-missing').hidden = false; $('ad-body').hidden = true;
      $('promo-track').innerHTML = '<li class="promo-item"><span class="ptag n">i</span>Resultados cuánticos no disponibles: falta quantum_data.js</li>';
      return;
    }
    const ip = QD.instance || {};
    Q.QD = QD;
    Q.inst = E.buildInstance({ density: ip.density == null ? 1 : ip.density, profile: ip.profile || 1, seed: ip.seed == null ? 1 : ip.seed });
    const n = Q.inst.numSkus;
    const mk = (arr, fileCost, what) => {
      if (!Array.isArray(arr) || arr.length !== n) { console.warn('QuantumData: asignación inválida en', what); return null; }
      const a = Int32Array.from(arr);
      const c = E.cost(Q.inst, a);
      if (Number.isFinite(fileCost) && Math.abs(c - fileCost * QX) > 0.5) console.warn(`QuantumData: costo de ${what} no coincide (${c} vs ${fileCost * QX})`);
      return { assign: a, cost: c };
    };
    Q.ini = mk(QD.initial, QD.initialCost, 'inicio');
    Q.classical = QD.classical.map((c) => Object.assign({ id: c.id, label: c.label, seconds: c.seconds }, mk(c.assignment, c.cost, c.label)));
    Q.v2 = QD.quantumV2;
    Q.des = mk(Q.v2.assignment, Q.v2.cost, 'cuántico v2');
    Q.v1 = QD.quantumV1 ? mk(QD.quantumV1.assignment, QD.quantumV1.cost, 'cuántico v1') : null;
    if (!Q.ini || !Q.des || Q.classical.some((c) => !c.assign)) {
      $('ad-missing').hidden = false; $('ad-body').hidden = true; return;
    }
    // ANTES por defecto: el mejor clásico (en empate se prefiere Recocido + pulido).
    const minC = Math.min(...Q.classical.map((c) => c.cost));
    const ties = Q.classical.filter((c) => Math.abs(c.cost - minC) < 0.5);
    Q.sel = (ties.find((c) => c.id === 'hybrid') || ties[0]).id;

    const onHover = (h) => {
      Q.hoverPair = h < 0 ? null : (() => { const k = strongestPartner(Q.inst, h); return k < 0 ? null : [h, k]; })();
      renderPairAll();
    };
    Q.views.ini = createPlanView($('plan-ini'), Q.inst, { onHover });
    Q.views.ant = createPlanView($('plan-ant'), Q.inst, { onHover });
    Q.views.des = createPlanView($('plan-des'), Q.inst, { onHover });
    Q.views.morph = createPlanView($('plan-morph'), Q.inst, { onHover });
    Q.views.ini.setAssign(Q.ini.assign);
    Q.views.des.setAssign(Q.des.assign);

    renderClassicSeg();
    initPairSelect();
    $('hl-seg').addEventListener('click', (ev) => {
      const b = ev.target.closest('button[data-hl]');
      if (!b) return;
      Q.hl = b.dataset.hl;
      $('hl-seg').querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', x === b ? 'true' : 'false'));
      renderMarks();
    });
    initMorph();
    renderLanes();
    renderBench();
    renderVersions();
    onClassicChange();
  }

  const antes = () => Q.classical.find((c) => c.id === Q.sel);
  const diffSet = (a, b) => { const s = new Set(); for (let h = 0; h < a.length; h++) if (a[h] !== b[h]) s.add(h); return s; };

  function renderClassicSeg() {
    const seg = $('classic-seg');
    seg.innerHTML = Q.classical.map((c) =>
      `<button type="button" class="seg-btn" data-cl="${esc(c.id)}" aria-pressed="${c.id === Q.sel}">${esc(c.label)} <span class="sc">${fmt(c.cost)}</span></button>`).join('');
    seg.addEventListener('click', (ev) => {
      const b = ev.target.closest('button[data-cl]');
      if (!b || b.dataset.cl === Q.sel) return;
      Q.sel = b.dataset.cl;
      onClassicChange();
      announce(`ANTES: ${antes().label}, costo ${fmt(antes().cost)}`);
    });
  }

  function onClassicChange() {
    $('classic-seg').querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.cl === Q.sel ? 'true' : 'false'));
    Q.views.ant.setAssign(antes().assign);
    renderHero();
    renderPromo();
    renderHonest();
    renderPlanHeads();
    renderMarks();
    renderPairAll();
    renderDiffTable();
    renderMorph();
  }

  function renderHero() {
    const a = antes(), ini = Q.ini.cost, des = Q.des.cost;
    const warm = Number.isFinite(Q.v2.warm_start_cost) ? Q.v2.warm_start_cost * QX : NaN;
    const gain = Number.isFinite(Q.v2.qiskit_additional_gain) ? Q.v2.qiskit_additional_gain * QX : NaN;
    const d = des - a.cost;
    const why = Math.abs(warm - des) < 0.5
      ? `la aporta el arranque clásico (${fmt(warm)}); el circuito suma ${fmt(gain)}`
      : `ganancia del circuito tras el arranque: ${fmt(gain)}`;
    $('hero-kpis').innerHTML =
      `<div class="hk hk-ini"><span class="hk-label">Inicio</span><span class="hk-value">${fmt(ini)}</span><span class="hk-sub">asignación aleatoria de partida</span></div>` +
      `<div class="hk hk-ant"><span class="disc">${discTxt(pctDown(ini, a.cost))}</span><span class="hk-label">Antes · clásico</span><span class="hk-value price">${fmt(a.cost)}</span><span class="hk-sub">${esc(a.label)} · ${nf2.format(a.seconds * 1000)} ms</span></div>` +
      `<div class="hk hk-des"><span class="disc">${discTxt(pctDown(ini, des))}</span><span class="hk-label">Después · cuántico híbrido</span><span class="hk-value price">${fmt(des)}</span><span class="hk-sub">${Q.v2.qubits} qubits · simulador local · ${nf2.format(Q.v2.seconds)} s</span></div>` +
      `<div class="hk hk-diff"><span class="disc ${d < 0 ? 'g' : 'n'}">${discTxt(pctDown(a.cost, des))}</span><span class="hk-label">Después − Antes</span><span class="hk-value ${d < 0 ? 'good' : ''}">${fmtSigned(d)}</span><span class="hk-sub">Esa diferencia ${why}.</span></div>`;
  }

  function benchStats() {
    const b = Q.QD.benchmark;
    if (!b || !b.summary) return null;
    const classicIds = ['local', 'sa', 'hybrid'].filter((k) => b.summary[k]);
    const bestClassicMean = Math.min(...classicIds.map((k) => b.summary[k].mean_cost)) * QX;
    return { b, bestClassicMean, seeds: b.seeds || [], losses: (b.seeds || []).length - (b.wins || 0) - (b.ties || 0) };
  }

  function renderPromo() {
    const bs = benchStats();
    const items = [
      `<span class="ptag">${discTxt(pctDown(Q.ini.cost, Q.des.cost)).replace(/,\d/, '')}</span>Mejora vs. asignación aleatoria (${fmt(Q.ini.cost)} → ${fmt(Q.des.cost)})`,
      `<span class="ptag n">${fmt(antes().cost)}</span>ANTES · ${esc(antes().label)}`,
      `<span class="ptag q">${fmt(Q.des.cost)}</span>DESPUÉS · ruta cuántica híbrida`,
      `<span class="ptag g">${Q.v2.qubits} qubits</span>${nf1.format(Q.v2.valid_fraction * 100).replace(',0', '')} % de muestras válidas`,
    ];
    if (bs) items.push(`<span class="ptag n">=</span>Empata con el mejor clásico (${fmt(bs.bestClassicMean)}) a igual presupuesto`);
    items.push(`<span class="ptag">${fmt((Q.v2.qiskit_additional_gain || 0) * QX)}</span>ganancia del circuito · simulación local, sin QPU`);
    $('promo-track').innerHTML = items.map((t) => `<li class="promo-item">${t}</li>`).join('');
  }

  function renderHonest() {
    const bs = benchStats();
    const warm = Q.v2.warm_start_cost * QX, gain = (Q.v2.qiskit_additional_gain || 0) * QX;
    const items = [];
    if (bs) {
      items.push(`<strong>Empate, no victoria:</strong> con el mismo presupuesto (${nf1.format(bs.b.budgetSeconds)} s por método, ${bs.seeds.length} semillas) la ruta cuántica alcanza el mejor costo clásico, ${fmt(bs.b.summary.qiskit.best_cost)} × 2 = <strong>${fmt(bs.b.summary.qiskit.best_cost * QX)}</strong>, pero no lo supera (${bs.b.wins} victorias, ${bs.b.ties} empates).`);
    }
    items.push(`<strong>Ganancia adicional del circuito = ${fmt(gain)}:</strong> el arranque clásico ya tenía costo ${fmt(warm)} y el circuito QAOA no lo mejoró. La diferencia frente al ANTES mostrado (${fmt(antes().cost)}) viene de ese arranque clásico, no del circuito.`);
    items.push('<strong>Es una simulación local:</strong> Qiskit con StatevectorSampler en una computadora clásica; no se usó ninguna computadora cuántica real (QPU).');
    items.push('<strong>No hay ventaja cuántica demostrada</strong> en esta instancia.');
    items.push(`<strong>Dónde está el valor:</strong> en la nueva formulación — ${Q.v2.qubits} qubits en lugar de ${fmt(Q.inst.numSkus * Q.inst.numSlots)} variables binarias, y factibilidad por construcción (${nf1.format(Q.v2.valid_fraction * 100).replace(',0', '')} % de muestras válidas) — como camino hacia hardware cuántico futuro.`);
    $('honest-list').innerHTML = items.map((t) => `<li>${t}</li>`).join('');
  }

  function renderPlanHeads() {
    const a = antes();
    const movedAnt = diffSet(Q.ini.assign, a.assign).size, movedDes = diffSet(Q.ini.assign, Q.des.assign).size;
    const dAD = diffSet(a.assign, Q.des.assign).size;
    const n = Q.inst.numSkus;
    $('pc-cost-ini').textContent = fmt(Q.ini.cost);
    $('pc-cost-ant').textContent = fmt(a.cost);
    $('pc-cost-des').textContent = fmt(Q.des.cost);
    $('pc-sub-ant').innerHTML = `<span class="disc">${discTxt(pctDown(Q.ini.cost, a.cost))}</span>${movedAnt} de ${n} reubicados vs. inicio`;
    $('pc-sub-des').innerHTML = `<span class="disc">${discTxt(pctDown(Q.ini.cost, Q.des.cost))}</span>${movedDes} de ${n} vs. inicio · <strong>${dAD}</strong> distintos de ANTES`;
    $('plan-ant').setAttribute('aria-label', `Plano ANTES (${a.label}), costo ${fmt(a.cost)}; ${movedAnt} productos reubicados respecto al inicio`);
    $('plan-des').setAttribute('aria-label', `Plano DESPUÉS (ruta cuántica híbrida), costo ${fmt(Q.des.cost)}; ${dAD} productos en distinta ubicación que en ANTES`);
    $('plan-ini').setAttribute('aria-label', `Plano de INICIO, costo ${fmt(Q.ini.cost)}`);
  }

  function renderMarks() {
    const a = antes().assign, d = Q.des.assign, i = Q.ini.assign;
    if (Q.hl === 'ab') {
      const s = diffSet(a, d);
      Q.views.ini.mark(null); Q.views.ant.mark(s); Q.views.des.mark(s);
    } else if (Q.hl === 'init') {
      Q.views.ini.mark(null); Q.views.ant.mark(diffSet(i, a)); Q.views.des.mark(diffSet(i, d));
    } else {
      Q.views.ini.mark(null); Q.views.ant.mark(null); Q.views.des.mark(null);
    }
  }

  function initPairSelect() {
    const { W, D, numSkus } = Q.inst;
    const list = [];
    for (let i = 0; i < numSkus; i++) for (let j = i + 1; j < numSkus; j++) if (W[i][j] > 0) list.push({ i, j, w: W[i][j] });
    list.sort((p, q) => q.w - p.w || p.i - q.i || p.j - q.j);
    const top = list.slice(0, 12);
    // Por defecto: de los pares más fuertes, el que más acorta su distancia de INICIO a DESPUÉS.
    let def = top[0], gainBest = -Infinity;
    top.forEach((p) => {
      const g = p.w * (D[Q.ini.assign[p.i]][Q.ini.assign[p.j]] - D[Q.des.assign[p.i]][Q.des.assign[p.j]]);
      if (g > gainBest) { gainBest = g; def = p; }
    });
    const sel = $('pair-select');
    sel.innerHTML = '<option value="">Ninguna</option>' + top.map((p) =>
      `<option value="${p.i}-${p.j}">SKU ${p.i + 1} ↔ SKU ${p.j + 1} · peso ${fmt(p.w)}</option>`).join('');
    sel.value = `${def.i}-${def.j}`;
    Q.pickPair = [def.i, def.j];
    sel.addEventListener('change', () => {
      Q.pickPair = sel.value ? sel.value.split('-').map(Number) : null;
      renderPairAll();
    });
  }

  function renderPairAll() {
    const p = Q.hoverPair || Q.pickPair;
    Q.views.ini.setPair(p); Q.views.ant.setPair(p); Q.views.des.setPair(p);
    Q.views.morph.setPair(p, Q.t === 0 || Q.t === 1);
    const cap = $('pair-caption');
    if (!p) { cap.textContent = 'Pasa el cursor sobre un producto o elige una pareja para comparar su distancia en los tres planos.'; return; }
    const [h, k] = p, D = Q.inst.D;
    const dist = (a) => D[a[h]][a[k]];
    const d0 = dist(Q.ini.assign), d1 = dist(antes().assign), d2 = dist(Q.des.assign);
    cap.innerHTML = `<strong>SKU ${h + 1}</strong> (${famName(Q.inst.skus[h].family)}) ↔ <strong>SKU ${k + 1}</strong> (${famName(Q.inst.skus[k].family)}) · peso de co-picking ${fmt(Q.inst.W[h][k])}` +
      ` · distancia: INICIO <span class="dist">${d0}</span> → ANTES <span class="dist">${d1}</span> → DESPUÉS <span class="dist">${d2}</span>` +
      (Q.hoverPair ? ' <span class="muted">(socio más fuerte del producto bajo el cursor)</span>' : '');
  }

  // ---------- Morph Antes/Después ----------
  function morphEnds() {
    const a = antes();
    const pts = {
      ini: { name: 'INICIO', assign: Q.ini.assign, cost: Q.ini.cost },
      ant: { name: 'ANTES', assign: a.assign, cost: a.cost },
      des: { name: 'DESPUÉS', assign: Q.des.assign, cost: Q.des.cost },
    };
    const [f, t] = Q.morphKey.split('-');
    return { A: pts[f], B: pts[t] };
  }

  function renderMorph() {
    const { A, B } = morphEnds();
    const v = Q.views.morph, t = Q.t, slots = Q.inst.slots;
    const moving = diffSet(A.assign, B.assign);
    for (let h = 0; h < v.nodes.length; h++) {
      const [x1, y1] = slotXY(slots[A.assign[h]]), [x2, y2] = slotXY(slots[B.assign[h]]);
      v.place(h, x1 + (x2 - x1) * t, y1 + (y2 - y1) * t);
    }
    v.assign = t < 0.5 ? A.assign : B.assign;
    v.mark(moving);
    v.setPair(Q.hoverPair || Q.pickPair, t === 0 || t === 1);
    $('morph-a').textContent = A.name; $('morph-b').textContent = B.name;
    $('morph-a').setAttribute('aria-pressed', t === 0 ? 'true' : 'false');
    $('morph-b').setAttribute('aria-pressed', t === 1 ? 'true' : 'false');
    $('morph-end-a').textContent = `${A.name} · ${fmt(A.cost)}`;
    $('morph-end-b').textContent = `${B.name} · ${fmt(B.cost)}`;
    const r = $('morph-range');
    const pct = Math.round(t * 100);
    const txt = t === 0 ? `${A.name}, costo ${fmt(A.cost)}` : t === 1 ? `${B.name}, costo ${fmt(B.cost)}` : `Transición ${pct} %`;
    r.setAttribute('aria-valuetext', txt);
    const ro = $('morph-readout');
    if (t === 0 || t === 1) {
      const P = t === 0 ? A : B;
      ro.innerHTML = `<span class="tag ${P.name === 'ANTES' ? 'tag-ant' : P.name === 'DESPUÉS' ? 'tag-des' : ''}">${P.name}</span><span class="mr-cost price">${fmt(P.cost)}</span>` +
        `<span class="muted">${moving.size} productos cambian de ubicación entre ${A.name} y ${B.name}</span>`;
    } else {
      ro.innerHTML = `<span class="tag">Transición ${pct} %</span><span class="muted">${moving.size} productos en movimiento (resaltados); las posiciones intermedias no son asignaciones reales</span>`;
    }
  }

  function setMorphT(t, fromSlider) {
    Q.t = Math.max(0, Math.min(1, t));
    if (!fromSlider) $('morph-range').value = String(Math.round(Q.t * 1000));
    renderMorph();
  }

  function animateMorph(target, onDone) {
    cancelAnimationFrame(Q.anim);
    const from = Q.t;
    if (reduceMotion() || from === target) { setMorphT(target); if (onDone) onDone(); return; }
    const dur = 1100 * Math.abs(target - from);
    const t0 = performance.now();
    const ease = (x) => (x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2);
    const step = (now) => {
      const k = Math.min(1, (now - t0) / dur);
      setMorphT(k >= 1 ? target : from + (target - from) * ease(k));
      if (k < 1) Q.anim = requestAnimationFrame(step); else if (onDone) onDone();
    };
    Q.anim = requestAnimationFrame(step);
  }

  function initMorph() {
    const r = $('morph-range');
    r.addEventListener('input', () => { cancelAnimationFrame(Q.anim); setMorphT(+r.value / 1000, true); });
    $('morph-a').addEventListener('click', () => animateMorph(0));
    $('morph-b').addEventListener('click', () => animateMorph(1));
    $('morph-play').addEventListener('click', () => {
      const go = () => animateMorph(1, () => announce(`Transición completa: ${morphEnds().B.name}, costo ${fmt(morphEnds().B.cost)}`));
      if (Q.t >= 1) { setMorphT(0); setTimeout(go, reduceMotion() ? 0 : 250); } else go();
    });
    $('morph-select').addEventListener('change', (ev) => { Q.morphKey = ev.target.value; cancelAnimationFrame(Q.anim); setMorphT(0); });
  }

  // ---------- Tabla de diferencias ----------
  function renderDiffTable() {
    const a = antes(), v2 = Q.v2, inst = Q.inst;
    const nVars = inst.numSkus * inst.numSlots;
    const empties = inst.numSlots - inst.numSkus;
    const nPairs = Array.isArray(v2.swap_pairs) && v2.swap_pairs[0] ? v2.swap_pairs[0].length : v2.qubits;
    const warm = v2.warm_start_cost * QX, gain = (v2.qiskit_additional_gain || 0) * QX;
    const validPct = nf1.format(v2.valid_fraction * 100).replace(',0', '');
    const rows = [
      ['Cómo se formula',
        `Asignación directa SKU → ubicación: una variable binaria por combinación (${inst.numSkus} × ${inst.numSlots}).<span class="big">${fmt(nVars)} variables</span>`,
        `Cada qubit decide si se aplica el intercambio de un par disjunto de productos (${nPairs} pares) → QUBO polinómico sobre ${inst.numSlots} ítems (${inst.numSkus} productos + ${empties} vacíos).<span class="big">${v2.qubits} qubits <span class="mini-pill">${fmt(nVars / v2.qubits)}× menos variables</span></span>`],
      ['Factibilidad',
        'Las heurísticas solo aplican movimientos válidos (mover o intercambiar), uno a uno. En la formulación binaria, casi todas las combinaciones de variables no son asignaciones válidas y requieren penalizaciones.',
        `Cada combinación de qubits es una permutación válida, por construcción.<span class="big">${validPct} % de muestras válidas</span>`],
      ['Algoritmo',
        `Heurísticas clásicas (constructivo, búsqueda local, recocido simulado, recocido + pulido) que mueven productos uno a uno. Mostrado: <strong>${esc(a.label)}</strong>.`,
        `QAOA con calendario LR de rampa fija (sin entrenar ángulos: ${nf1.format(v2.training_seconds || 0)} s de entrenamiento), Qiskit, StatevectorSampler. <span class="note">${esc(v2.label)}</span>`],
      ['Hardware',
        'CPU clásica.',
        'Simulador local de vector de estado en CPU. <strong>Sin computadora cuántica real (QPU).</strong>'],
      ['Punto de partida',
        `Asignación aleatoria común (costo ${fmt(Q.ini.cost)}); el constructivo arma la solución desde cero.`,
        `Arranque clásico (<em>warm start</em>) con costo ${fmt(warm)}.`],
      ['Recursos',
        'Solo CPU: 0 qubits, 0 shots.',
        `${v2.qubits} qubits · ${fmt(v2.total_shots)} shots totales · ${fmt(v2.evaluations)} evaluaciones<span class="note">Evaluaciones de costo de muestras: ${fmt(v2.sample_evaluations)}</span>`],
      ['Tiempo',
        `<span class="big">${nf2.format(a.seconds * 1000)} ms</span><span class="note">${esc(a.label)}, corrida única precalculada</span>`,
        `<span class="big">${nf2.format(v2.seconds)} s</span><span class="note">en simulador · presupuesto ${nf1.format(v2.budget_seconds)} s · muestreo ${nf2.format(v2.sampling_seconds)} s</span>`],
      ['Costo final',
        `<span class="big price">${fmt(a.cost)}</span><span class="note">${discTxt(pctDown(Q.ini.cost, a.cost))} vs. inicio</span>`,
        `<span class="big price">${fmt(Q.des.cost)}</span><span class="note">${discTxt(pctDown(Q.ini.cost, Q.des.cost))} vs. inicio · igual al arranque clásico (${fmt(warm)})</span>`],
      ['Ganancia atribuible al circuito',
        'No aplica.',
        `<span class="big">${fmt(gain)} <span class="mini-pill n">sin mejora</span></span><span class="note">arranque clásico ${fmt(warm)} → final ${fmt(Q.des.cost)}</span>`],
    ];
    $('diff-body').innerHTML = rows.map(([k, x, y]) =>
      `<tr><th scope="row">${k}</th><td class="col-ant" data-label="ANTES · clásico">${x}</td><td class="col-des" data-label="DESPUÉS · cuántico">${y}</td></tr>`).join('');
  }

  // ---------- Infografía en dos carriles ----------
  function renderLanes() {
    const v2 = Q.v2, inst = Q.inst, best = Math.min(...Q.classical.map((c) => c.cost));
    const step = (b, s, cls) => `<li class="step ${cls || ''}"><b>${b}</b><span>${s}</span></li>`;
    $('lanes').innerHTML =
      `<div class="lane lane-ant"><div class="lane-label">ANTES <small>clásico</small></div><ol class="steps">` +
      step('Datos', `co-picking W y distancias D (${inst.numSkus} SKUs, ${inst.numSlots} ubicaciones)`) +
      step('Heurística en CPU', 'mueve o intercambia productos uno a uno; acepta o rechaza cada cambio') +
      step('Asignación', `mejor clásico de una corrida: <span class="s-n">${fmt(best)}</span>`, 'res') +
      `</ol></div>` +
      `<div class="lane lane-des"><div class="lane-label">DESPUÉS <small>cuántico híbrido</small></div><ol class="steps">` +
      step('Datos', 'mismas W y D') +
      step('Arranque clásico', `warm start: <span class="s-n">${fmt(v2.warm_start_cost * QX)}</span>`) +
      step('QUBO de intercambios', `${v2.qubits} pares disjuntos → ${v2.qubits} qubits`, 'hot') +
      step('Circuito QAOA', 'calendario LR de rampa fija · Qiskit · simulador', 'hot') +
      step('Medición', `${fmt(v2.total_shots)} shots · ${nf1.format(v2.valid_fraction * 100).replace(',0', '')} % válidas`, 'hot') +
      step('Asignación', `<span class="s-n">${fmt(Q.des.cost)}</span> · ganancia del circuito ${fmt((v2.qiskit_additional_gain || 0) * QX)}`, 'res') +
      `</ol></div>`;
  }

  // ---------- Benchmark ----------
  function renderBench() {
    const bs = benchStats();
    if (!bs) { $('resultados').querySelector('.table-wrap').hidden = true; $('bench-intro').textContent = 'No hay datos de benchmark en quantum_data.js.'; return; }
    const { b, bestClassicMean, seeds, losses } = bs;
    $('bench-intro').innerHTML = `Cada método recibió un presupuesto de <strong>${nf1.format(b.budgetSeconds)} s</strong> por ejecución en <strong>${seeds.length} semillas</strong> (${seeds.join(', ')}). Costos en la convención del plano (archivo × 2). Se conservan todas las semillas, también las desfavorables.`;
    const names = {
      local: ['Búsqueda local', 'clásico'],
      sa: ['Recocido simulado', 'clásico'],
      hybrid: ['Recocido + pulido', 'clásico'],
      qiskit: ['Híbrido QAOA · Qiskit', 'cuántico simulado'],
      ablation: ['Control sin Qiskit', 'mismos vecindarios, sin circuito'],
    };
    const order = ['local', 'sa', 'hybrid', 'qiskit', 'ablation'].filter((k) => b.summary[k]);
    $('bench-body').innerHTML = order.map((k) => {
      const s = b.summary[k], mean = s.mean_cost * QX, delta = mean - bestClassicMean;
      const vs = Math.abs(delta) < 0.05 ? '<span class="mini-pill n">empate en media</span>'
        : delta > 0 ? `<span class="mini-pill r">+${nf1.format(delta)} en media</span>` : `<span class="mini-pill">${nf1.format(delta)} en media</span>`;
      return `<tr class="${k === 'qiskit' ? 'is-q' : ''}"><th scope="row" class="meth">${names[k][0]}<small>${names[k][1]}</small></th>` +
        `<td class="num">${fmt1(mean)}</td><td class="num">${fmt(s.best_cost * QX)}</td><td class="num">${nf2.format(s.std_cost * QX)}</td>` +
        `<td class="num">${nf2.format(s.mean_seconds)} s</td><td>${vs}</td></tr>`;
    }).join('');
    $('bench-score').innerHTML =
      `<div class="score"><span class="sv">${b.wins}</span><span class="sl">victorias del híbrido cuántico vs. mejor clásico</span></div>` +
      `<div class="score"><span class="sv">${b.ties}</span><span class="sl">empates</span></div>` +
      `<div class="score"><span class="sv">${losses}</span><span class="sl">semillas peores que el mejor clásico (por 1,5 en costo)</span></div>` +
      `<div class="score"><span class="sv">${b.winsVsAblation}</span><span class="sl">victorias vs. control sin Qiskit</span></div>`;
    const q = b.summary.qiskit;
    $('verdict').innerHTML = '<h4>Veredicto</h4>' +
      `<p>La ruta cuántica <strong>empata</strong> con el mejor clásico (${fmt(q.best_cost)} × 2 = <strong>${fmt(q.best_cost * QX)}</strong>); <strong>no lo supera</strong>. En media queda en ${fmt1(q.mean_cost * QX)} frente a ${fmt1(bestClassicMean)}.</p>` +
      `<p>La <strong>ganancia adicional del circuito</strong> tras el arranque clásico es <strong>${fmt((Q.v2.qiskit_additional_gain || 0) * QX)}</strong>, y el control con los mismos vecindarios sin Qiskit obtiene el mismo resultado.</p>` +
      '<p>Todo se ejecutó en un <strong>simulador local</strong>, sin hardware cuántico. <strong>No hay ventaja cuántica demostrada.</strong> El valor de la propuesta está en la formulación: menos variables y factibilidad por construcción, como base para probar en hardware futuro.</p>';
  }

  function renderVersions() {
    const v1 = Q.QD.quantumV1, v2 = Q.v2;
    const card = (v, cost, tag, cls, title) => !v ? '' :
      `<div class="ver ${cls}"><span class="disc ${cls === 'cur' ? 'g' : 'n'} ver-tag">${tag}</span><h5>${title}</h5><span class="muted">${esc(v.label)}</span>` +
      `<div class="vk"><div><b>${v.qubits}</b><span>qubits</span></div><div><b class="price">${fmt(cost)}</b><span>costo final</span></div>` +
      `<div><b>${nf1.format(v.valid_fraction * 100).replace(',0', '')} %</b><span>muestras válidas</span></div>` +
      `<div><b>${fmt(v.total_shots)}</b><span>shots totales</span></div><div><b>${fmt(v.evaluations)}</b><span>evaluaciones</span></div>` +
      `<div><b>${nf2.format(v.seconds)} s</b><span>tiempo</span></div></div></div>`;
    $('versions').innerHTML =
      card(v1, Q.v1 && Q.v1.cost, 'versión previa', 'old', 'Primera versión') +
      card(v2, Q.des.cost, 'versión actual', 'cur', 'Versión actual: intercambios');
  }

  init();
})();
