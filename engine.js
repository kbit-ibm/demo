/*
 * Motor del demo: instancia de slotting de almacén (QAP) + solvers clásicos.
 *
 *   30 SKUs en 6 familias  ->  32 slots (4 pasillos x 8 posiciones)
 *   min  sum_{h != i} W[h][i] * D[slot(h)][slot(i)]
 *   s.a. cada SKU en exactamente un slot, cada slot con a lo sumo un SKU.
 *
 * API pública (global `WarehouseEngine`, también module.exports en Node):
 *   FAMILIES, PROFILES, SOLVERS
 *   buildInstance({ density, profile, seed }) -> instance
 *   cost(instance, assign)                    -> number
 *   randomAssignment(instance, seed)          -> assign
 *   createSolver(name, instance, opts)        -> generador de pasos (ver abajo)
 *
 * `assign` es un Int32Array de largo numSkus: assign[sku] = slot (0..numSlots-1).
 *
 * Un solver es un generador: cada `.next()` devuelve
 *   { value: { assign, bestAssign, cost, bestCost, iter, maxIter, temp, label }, done }
 * `assign`/`bestAssign` son copias seguras para pintar en la UI.
 */
(function (root) {
  'use strict';

  const FAMILIES = {
    A: { name: 'Bebidas', color: '#3b82f6' },
    B: { name: 'Snacks', color: '#f59e0b' },
    C: { name: 'Limpieza', color: '#10b981' },
    D: { name: 'Oficina', color: '#8b5cf6' },
    E: { name: 'Cuidado personal', color: '#ec4899' },
    F: { name: 'Mascotas', color: '#ef4444' },
  };

  // [familia, picks anuales] — SKU 1..30
  const BASE_SKUS = [
    ['A', 1800], ['A', 1500], ['A', 900], ['A', 700], ['A', 400],
    ['B', 2000], ['B', 1600], ['B', 1200], ['B', 800], ['B', 500],
    ['C', 1400], ['C', 1000], ['C', 600], ['C', 450], ['C', 300],
    ['D', 1300], ['D', 1100], ['D', 900], ['D', 700], ['D', 500],
    ['E', 1700], ['E', 1400], ['E', 1000], ['E', 800], ['E', 500],
    ['F', 1500], ['F', 1200], ['F', 900], ['F', 700], ['F', 400],
  ];

  // Perfiles de demanda anual: cada uno reescala los picks de forma determinista.
  const PROFILES = [
    { id: 1, name: 'Base', desc: 'Volumen anual de referencia' },
    { id: 2, name: 'Alta rotación', desc: 'Pocos SKUs concentran la demanda' },
    { id: 3, name: 'Plana', desc: 'Demanda más homogénea entre SKUs' },
    { id: 4, name: 'Estacional', desc: 'Dos familias (A y E) se disparan' },
    { id: 5, name: 'Aleatoria', desc: 'Variación pseudoaleatoria ±35 %' },
  ];

  const NUM_AISLES = 4;
  const POS_PER_AISLE = 8;
  const AISLE_GAP = 4;
  const WORKING_DAYS = 300;

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function profilePicks(profileId, seed) {
    const picks = BASE_SKUS.map((s) => s[1]);
    const rng = mulberry32(seed * 7919 + profileId);
    return picks.map((p, i) => {
      const fam = BASE_SKUS[i][0];
      switch (profileId) {
        case 2: return Math.round(p * (p >= 1300 ? 1.5 : 0.6));
        case 3: return Math.round(p * 0.4 + 700);
        case 4: return Math.round(p * (fam === 'A' || fam === 'E' ? 1.6 : 0.9));
        case 5: return Math.max(300, Math.round(p * (0.65 + rng() * 0.7)));
        default: return p;
      }
    });
  }

  function familyDependency(f1, f2) {
    if (f1 === f2) return 2.0;
    const pair = [f1, f2].sort().join('');
    if (pair === 'AB' || pair === 'CD' || pair === 'EF') return 1.5;
    return 0.5;
  }

  function buildInstance(opts) {
    opts = opts || {};
    const density = opts.density == null ? 1.0 : opts.density;
    const profile = opts.profile || 1;
    const seed = opts.seed == null ? 1 : opts.seed;

    const picks = profilePicks(profile, seed);
    const skus = BASE_SKUS.map((s, i) => ({
      id: i + 1, family: s[0], picks: picks[i], color: FAMILIES[s[0]].color,
    }));
    const n = skus.length;

    const slots = [];
    for (let a = 0; a < NUM_AISLES; a++) {
      for (let p = 0; p < POS_PER_AISLE; p++) {
        slots.push({
          id: a * POS_PER_AISLE + p, aisle: a + 1, pos: p + 1,
          x: a * AISLE_GAP, y: p,
          zone: p < 3 ? 'Frente' : p < 5 ? 'Medio' : 'Fondo',
        });
      }
    }
    const m = slots.length;

    const D = [];
    for (let j = 0; j < m; j++) {
      D.push(new Float64Array(m));
      for (let k = 0; k < m; k++) {
        D[j][k] = Math.abs(slots[j].x - slots[k].x) + Math.abs(slots[j].y - slots[k].y);
      }
    }

    // Co-picking: w_ij = floor(min(q_i,q_j)/300) * r(f_i,f_j)
    const W = [];
    for (let i = 0; i < n; i++) W.push(new Float64Array(n));
    const pairs = [];
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const q = Math.floor(Math.min(skus[i].picks, skus[j].picks) / WORKING_DAYS);
        const w = q * familyDependency(skus[i].family, skus[j].family);
        W[i][j] = W[j][i] = w;
        pairs.push({ i, j, w });
      }
    }
    // Poda determinista: se conservan los pares más fuertes hasta la densidad objetivo.
    if (density < 1) {
      const keep = Math.round(density * pairs.length);
      const order = pairs.slice().sort((a, b) => b.w - a.w || a.i - b.i || a.j - b.j);
      for (let t = keep; t < order.length; t++) {
        W[order[t].i][order[t].j] = W[order[t].j][order[t].i] = 0;
      }
    }
    let nonzero = 0, maxW = 0;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      if (W[i][j] > 0) nonzero++;
      if (W[i][j] > maxW) maxW = W[i][j];
    }

    return {
      numSkus: n, numSlots: m, skus, slots, W, D,
      density: nonzero / pairs.length, nonzeroPairs: nonzero, totalPairs: pairs.length, maxW,
      params: { density, profile, seed },
    };
  }

  function cost(inst, assign) {
    const { W, D, numSkus } = inst;
    let c = 0;
    for (let h = 0; h < numSkus; h++) {
      const Dh = D[assign[h]], Wh = W[h];
      for (let i = h + 1; i < numSkus; i++) c += Wh[i] * Dh[assign[i]];
    }
    return 2 * c; // pares ordenados (h,i) e (i,h)
  }

  function randomAssignment(inst, seed) {
    const rng = mulberry32((seed == null ? 12345 : seed) >>> 0);
    const perm = Array.from({ length: inst.numSlots }, (_, i) => i);
    for (let i = perm.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [perm[i], perm[j]] = [perm[j], perm[i]];
    }
    return Int32Array.from(perm.slice(0, inst.numSkus));
  }

  // ---------- deltas O(n) ----------
  function deltaMove(inst, assign, h, q) {
    const { W, D, numSkus } = inst;
    const p = assign[h], Dp = D[p], Dq = D[q], Wh = W[h];
    let d = 0;
    for (let k = 0; k < numSkus; k++) if (k !== h) d += Wh[k] * (Dq[assign[k]] - Dp[assign[k]]);
    return 2 * d;
  }
  function deltaSwap(inst, assign, h, i) {
    const { W, D, numSkus } = inst;
    const p = assign[h], q = assign[i];
    const Dp = D[p], Dq = D[q], Wh = W[h], Wi = W[i];
    let d = 0;
    for (let k = 0; k < numSkus; k++) {
      if (k === h || k === i) continue;
      const s = assign[k];
      d += (Wh[k] - Wi[k]) * (Dq[s] - Dp[s]);
    }
    return 2 * d;
  }

  function occupancy(inst, assign) {
    const occ = new Int32Array(inst.numSlots).fill(-1);
    for (let h = 0; h < inst.numSkus; h++) occ[assign[h]] = h;
    return occ;
  }

  function snap(inst, assign, best, c, bc, iter, maxIter, temp, label) {
    return {
      assign: Int32Array.from(assign), bestAssign: Int32Array.from(best),
      cost: c, bestCost: bc, iter, maxIter, temp: temp == null ? null : temp, label: label || '',
    };
  }


  // ---------- Canastas de un mes ----------
  // Simula las canastas (pedidos) de un mes: el SKU ancla se elige según su volumen
  // y los demás según su afinidad (W) con el ancla. Devuelve cuántas veces cada
  // par de productos aparece junto en una misma canasta.
  function simulateMonth(inst, opts) {
    opts = opts || {};
    const rng = mulberry32((opts.seed || 1) * 104729 + 17);
    const { W, skus, numSkus } = inst;
    const monthlyLines = skus.reduce((a, s) => a + s.picks, 0) / 12;
    const numBaskets = opts.baskets || Math.round(monthlyLines / 3);
    const totalPicks = skus.reduce((a, s) => a + s.picks, 0);
    const counts = [];
    for (let i = 0; i < numSkus; i++) counts.push(new Int32Array(numSkus));
    const single = new Int32Array(numSkus);
    function draw(weights, exclude) {
      let tot = 0;
      for (let k = 0; k < numSkus; k++) if (!exclude.has(k)) tot += weights[k];
      if (tot <= 0) return -1;
      let r = rng() * tot;
      for (let k = 0; k < numSkus; k++) {
        if (exclude.has(k)) continue;
        r -= weights[k];
        if (r <= 0) return k;
      }
      return -1;
    }
    const pickW = skus.map((s) => s.picks / totalPicks);
    for (let b = 0; b < numBaskets; b++) {
      const u = rng();
      const size = u < 0.5 ? 2 : u < 0.8 ? 3 : 4;
      const chosen = new Set();
      const anchor = draw(pickW, chosen);
      chosen.add(anchor);
      while (chosen.size < size) {
        // el siguiente producto se elige por afinidad con alguno de los ya elegidos
        const aff = new Float64Array(numSkus);
        chosen.forEach((c) => { for (let k = 0; k < numSkus; k++) aff[k] += W[c][k]; });
        const nxt = draw(aff, chosen);
        if (nxt < 0) break;
        chosen.add(nxt);
      }
      const items = Array.from(chosen);
      items.forEach((i) => { single[i]++; });
      for (let x = 0; x < items.length; x++) for (let y = x + 1; y < items.length; y++) {
        counts[items[x]][items[y]]++; counts[items[y]][items[x]]++;
      }
    }
    const pairs = [];
    for (let i = 0; i < numSkus; i++) for (let j = i + 1; j < numSkus; j++) {
      if (counts[i][j] > 0) pairs.push({ i, j, count: counts[i][j], share: counts[i][j] / numBaskets });
    }
    pairs.sort((a, b) => b.count - a.count || a.i - b.i || a.j - b.j);
    return { numBaskets, counts, single, pairs };
  }

  // ---------- Solvers ----------

  // Heurística constructiva: SKUs más "conectados" primero, cada uno en el mejor slot libre.
  function* greedy(inst) {
    const { W, D, numSkus, numSlots } = inst;
    const weight = Array.from({ length: numSkus }, (_, h) => {
      let s = 0; for (let i = 0; i < numSkus; i++) s += W[h][i]; return s;
    });
    const order = weight.map((w, i) => i).sort((a, b) => weight[b] - weight[a]);
    const assign = new Int32Array(numSkus).fill(-1);
    const used = new Uint8Array(numSlots);
    let placed = [];
    for (let t = 0; t < numSkus; t++) {
      const h = order[t];
      let bestSlot = -1, bestC = Infinity;
      for (let s = 0; s < numSlots; s++) {
        if (used[s]) continue;
        let c = 0;
        if (placed.length === 0) {
          for (let k = 0; k < numSlots; k++) c += D[s][k]; // slot más central
        } else {
          for (const g of placed) c += W[h][g] * D[s][assign[g]];
        }
        if (c < bestC) { bestC = c; bestSlot = s; }
      }
      assign[h] = bestSlot; used[bestSlot] = 1; placed.push(h);
      const partial = Int32Array.from(assign);
      yield snap(inst, partial, partial, NaN, NaN, t + 1, numSkus, null, `Colocando SKU ${h + 1}`);
    }
    const c = cost(inst, assign);
    yield snap(inst, assign, assign, c, c, numSkus, numSkus, null, 'Construcción completa');
  }

  // Búsqueda local de mejor mejora (swap + mover a slot vacío) con reinicios.
  function* localSearch(inst, opts) {
    opts = opts || {};
    const restarts = opts.restarts || 8;
    const rng = mulberry32(opts.seed || 7);
    const { numSkus, numSlots } = inst;
    let globalBest = null, globalBestCost = Infinity, iter = 0;
    const maxIter = restarts;
    for (let r = 0; r < restarts; r++) {
      const assign = r === 0 && opts.start ? Int32Array.from(opts.start) : randomAssignment(inst, Math.floor(rng() * 1e9));
      let c = cost(inst, assign);
      let improved = true;
      while (improved) {
        improved = false;
        const occ = occupancy(inst, assign);
        let bestD = -1e-9, bm = null;
        for (let h = 0; h < numSkus; h++) {
          for (let s = 0; s < numSlots; s++) {
            if (s === assign[h]) continue;
            const o = occ[s];
            if (o === -1) {
              const d = deltaMove(inst, assign, h, s);
              if (d < bestD) { bestD = d; bm = [h, -1, s]; }
            } else if (o > h) {
              const d = deltaSwap(inst, assign, h, o);
              if (d < bestD) { bestD = d; bm = [h, o, s]; }
            }
          }
        }
        if (bm) {
          const [h, o, s] = bm;
          if (o === -1) assign[h] = s;
          else { const t = assign[h]; assign[h] = assign[o]; assign[o] = t; }
          c += bestD; improved = true;
          if (c < globalBestCost - 1e-9) { globalBestCost = c; globalBest = Int32Array.from(assign); }
          yield snap(inst, assign, globalBest || assign, c, globalBestCost, r, maxIter, null, `Reinicio ${r + 1}/${restarts}`);
        }
      }
      c = cost(inst, assign);
      if (c < globalBestCost) { globalBestCost = c; globalBest = Int32Array.from(assign); }
      iter = r + 1;
      yield snap(inst, assign, globalBest, c, globalBestCost, iter, maxIter, null, `Reinicio ${iter}/${restarts} en óptimo local`);
    }
    yield snap(inst, globalBest, globalBest, globalBestCost, globalBestCost, maxIter, maxIter, null, 'Finalizado');
  }

  // Recocido simulado con movimientos swap / mover a vacío.
  function* annealing(inst, opts) {
    opts = opts || {};
    const maxIter = opts.iterations || 200000;
    const rng = mulberry32(opts.seed || 42);
    const { numSkus, numSlots } = inst;
    const assign = opts.start ? Int32Array.from(opts.start) : randomAssignment(inst, 99);
    const occ = occupancy(inst, assign);
    let c = cost(inst, assign);
    let best = Int32Array.from(assign), bestC = c;
    // Temperatura inicial: ~ delta medio de movimientos aleatorios
    let sum = 0, cnt = 0;
    for (let t = 0; t < 200; t++) {
      const h = Math.floor(rng() * numSkus), s = Math.floor(rng() * numSlots);
      if (s === assign[h]) continue;
      const o = occ[s];
      sum += Math.abs(o === -1 ? deltaMove(inst, assign, h, s) : deltaSwap(inst, assign, h, o)); cnt++;
    }
    const T0 = Math.max(1, (sum / Math.max(1, cnt)) * 0.8), T1 = Math.max(0.01, T0 * 1e-4);
    const alpha = Math.pow(T1 / T0, 1 / maxIter);
    let T = T0;
    const chunk = Math.max(200, Math.floor(maxIter / 200));
    for (let it = 1; it <= maxIter; it++) {
      const h = Math.floor(rng() * numSkus);
      const s = Math.floor(rng() * numSlots);
      if (s !== assign[h]) {
        const o = occ[s];
        const d = o === -1 ? deltaMove(inst, assign, h, s) : deltaSwap(inst, assign, h, o);
        if (d <= 0 || rng() < Math.exp(-d / T)) {
          const p = assign[h];
          if (o === -1) { assign[h] = s; occ[s] = h; occ[p] = -1; }
          else { assign[h] = s; assign[o] = p; occ[s] = h; occ[p] = o; }
          c += d;
          if (c < bestC - 1e-9) { bestC = c; best = Int32Array.from(assign); }
        }
      }
      T *= alpha;
      if (it % chunk === 0) yield snap(inst, assign, best, c, bestC, it, maxIter, T, 'Enfriando');
    }
    bestC = cost(inst, best);
    yield snap(inst, best, best, bestC, bestC, maxIter, maxIter, T, 'Finalizado');
  }

  // Recocido + pulido final con búsqueda local desde la mejor solución.
  function* hybrid(inst, opts) {
    opts = opts || {};
    let last = null;
    for (const s of annealing(inst, { iterations: opts.iterations || 150000, seed: opts.seed || 5 })) {
      last = s; yield Object.assign({}, s, { maxIter: s.maxIter + 1 });
    }
    for (const s of localSearch(inst, { restarts: 1, start: last.bestAssign })) {
      yield Object.assign({}, s, { label: 'Pulido local', iter: last.maxIter, maxIter: last.maxIter + 1 });
    }
  }

  const SOLVERS = [
    { id: 'greedy', name: 'Constructivo (greedy)', desc: 'Coloca primero los SKUs más conectados en el mejor slot libre. Instantáneo, sin garantías.' },
    { id: 'local', name: 'Búsqueda local', desc: 'Parte de asignaciones aleatorias y aplica el mejor intercambio hasta un óptimo local; con reinicios.' },
    { id: 'sa', name: 'Recocido simulado', desc: 'Acepta empeoramientos al inicio para escapar de óptimos locales y se va "enfriando".' },
    { id: 'hybrid', name: 'Recocido + pulido', desc: 'Recocido simulado seguido de una búsqueda local final. Mejor relación calidad/tiempo.' },
  ];

  function createSolver(name, inst, opts) {
    switch (name) {
      case 'greedy': return greedy(inst, opts);
      case 'local': return localSearch(inst, opts);
      case 'sa': return annealing(inst, opts);
      case 'hybrid': return hybrid(inst, opts);
      default: throw new Error('Solver desconocido: ' + name);
    }
  }

  const api = {
    FAMILIES, PROFILES, SOLVERS, buildInstance, simulateMonth, cost, randomAssignment, createSolver,
    deltaSwap, deltaMove, occupancy,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.WarehouseEngine = api;
})(typeof self !== 'undefined' ? self : this);
