/*
 * Tour guiado del demo (driver.js 1.3.1, cargado localmente desde vendor/driver/).
 * Recorre 11 pasos + un resumen. Las acciones que ejecuta (resolver, intercambio de
 * ejemplo, comparativa, transición del plano) son las mismas que la interfaz y se
 * deshacen o son inocuas.
 */
(function () {
  'use strict';

  const STORE_KEY = 'layoutDemo.tourSeen.v1';
  const TOTAL = 11;
  const $ = (id) => document.getElementById(id);
  const App = window.DemoApp;
  const driverFactory = window.driver && window.driver.js && window.driver.js.driver;

  const storeGet = () => { try { return window.localStorage.getItem(STORE_KEY); } catch (e) { return null; } };
  const storeSet = (v) => { try { window.localStorage.setItem(STORE_KEY, v); } catch (e) { /* almacenamiento no disponible */ } };
  const reduceMotion = () => !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const visible = (sel) => { const n = document.querySelector(sel); return !!(n && n.getClientRects().length && !n.closest('[hidden]')); };

  let drv = null;
  let swapPair = null;

  // Botón "Siguiente" en estado de espera mientras termina una acción real.
  function waitThenNext(promise, label) {
    const btn = document.querySelector('.driver-popover-next-btn');
    if (btn) { btn.disabled = true; btn.textContent = label || 'Esperando…'; btn.classList.add('driver-popover-btn-disabled'); }
    Promise.resolve(promise).then(() => { if (drv && drv.isActive()) drv.moveNext(); });
  }

  // Recalcula el recorte resaltado cuando el contenido del paso cambia de tamaño.
  function refreshSoon() { setTimeout(() => { if (drv && drv.isActive()) drv.refresh(); }, 60); }

  function undoExampleSwap() {
    if (swapPair && App) { App.undoSwap(swapPair); }
    swapPair = null;
  }

  function buildSteps() {
    const steps = [
      {
        element: '#plan-panel',
        popover: {
          title: 'El problema y el plano',
          description: '<p>Hay que ubicar 30 productos (SKUs) en 32 ubicaciones de 4 pasillos. Los productos que se piden juntos deberían quedar cerca: el costo suma <strong>co-picking × distancia</strong>.</p><p>Cada tarjeta es un SKU con la letra de su familia. Pasa el cursor sobre uno para ver sus socios.</p>',
          side: 'left', align: 'start',
        },
      },
      {
        element: '#params',
        popover: {
          title: 'Parámetros de la instancia',
          description: '<p><strong>Densidad</strong>: qué porcentaje de pares de productos se piden juntos. <strong>Perfil</strong>: cómo se reparte la demanda.</p><p>Cambiarlos genera una instancia nueva y reinicia los resultados.</p>',
          side: 'right', align: 'start',
        },
      },
      {
        element: '#solver-block',
        popover: {
          title: 'Elige un solver y pulsa Resolver',
          description: '<p>Hay cuatro heurísticas clásicas. Al pulsar <strong>Siguiente</strong> lanzaremos <em>Recocido + pulido</em> a velocidad rápida, como si pulsaras Resolver.</p>',
          side: 'right', align: 'start',
          onNextClick: () => {
            if (App && !App.isBusy()) App.runSolver('hybrid', 8);
            drv.moveNext();
          },
        },
      },
      {
        element: '#metrics',
        popover: {
          title: 'Métricas en vivo y convergencia',
          description: '<p>Mientras el solver trabaja verás el <strong>costo actual</strong>, el <strong>mejor costo</strong> y la mejora frente a la asignación de partida.</p><p>El gráfico muestra cómo baja el costo paso a paso: gris, el actual; naranja, el mejor.</p>',
          side: 'left', align: 'start',
          onNextClick: () => {
            if (App && App.isRunning()) waitThenNext(App.waitIdle(), 'Terminando…');
            else drv.moveNext();
          },
        },
      },
      {
        element: '#manual',
        popover: {
          title: 'Modo manual: intercambia SKUs',
          description: '<p>Haz clic en dos ubicaciones del plano para intercambiar sus productos. Acabamos de hacer un intercambio de ejemplo: el historial muestra cuánto cambió el costo (Δ).</p><p>Al avanzar lo desharemos automáticamente.</p>',
          side: 'right', align: 'start',
        },
        onHighlighted: () => { if (App && !swapPair) swapPair = App.exampleSwap(); refreshSoon(); },
        onDeselected: undoExampleSwap,
      },
      {
        element: '#comparativa',
        popover: {
          title: 'Comparativa de solvers',
          description: '<p>Ejecuta las cuatro heurísticas sobre la misma instancia y compara costo final, mejora y tiempo. Con «Ver en plano» cargas cualquiera de las soluciones.</p>',
          side: 'bottom', align: 'start',
          onNextClick: () => {
            if (App && App.isBusy()) waitThenNext(App.waitIdle(), 'Comparando…');
            else drv.moveNext();
          },
        },
        onHighlighted: () => {
          if (App && !App.hasCompare() && !App.isBusy()) App.runCompare().then(refreshSoon);
          refreshSoon();
        },
      },
      {
        element: '#relaciones',
        popover: {
          title: 'Relaciones del mes',
          description: '<p>Un mes simulado de canastas: cuántas veces se pidió cada par de productos junto, y a qué distancia están en el plano actual. Filtra por familia o busca un SKU.</p>',
          side: 'top', align: 'start',
        },
      },
      {
        element: '#plans-card',
        popover: {
          title: 'Antes vs. Después: tres planos',
          description: '<p><strong>Inicio</strong> (aleatorio), <strong>Antes</strong> (mejor heurística clásica) y <strong>Después</strong> (ruta cuántica híbrida simulada). Los SKUs con borde oscuro y ↻ son los que cambian de ubicación.</p>',
          side: 'top', align: 'start',
        },
      },
      {
        element: '#morph-card',
        popover: {
          title: 'El deslizador',
          description: '<p>Desliza para transformar un plano en otro y ver qué productos se mueven. Lo reproducimos ahora de Antes a Después.</p>',
          side: 'top', align: 'start',
        },
        onHighlighted: () => { if (App) App.playMorph(); },
      },
      {
        element: '#diff-card',
        popover: {
          title: 'Diferencias lado a lado',
          description: '<p>Formulación, factibilidad, algoritmo, hardware, recursos, tiempo y costo de cada enfoque. Clave: 16 qubits en lugar de 960 variables binarias.</p>',
          side: 'top', align: 'start',
        },
      },
      {
        element: '.res-grid',
        popover: {
          title: 'Lectura honesta y benchmark',
          description: '<p>Con el mismo presupuesto y 5 semillas, la ruta cuántica <strong>empata</strong> con el mejor clásico; no lo supera. Es una simulación local y no hay ventaja cuántica demostrada.</p>',
          side: 'top', align: 'start',
        },
      },
    ];
    const usable = steps.filter((s) => visible(s.element));
    usable.push({
      popover: {
        title: 'Resumen',
        description: '<p>Has visto el problema, cómo lo resuelven las heurísticas clásicas, el modo manual, la comparativa y la ruta cuántica híbrida.</p><p>Conclusión: en esta instancia ambos enfoques llegan al mismo costo; el aporte cuántico está en la formulación, no en el resultado. Puedes repetir el tour con el botón de la cabecera o la tecla <kbd>T</kbd>.</p>',
      },
    });
    return usable;
  }

  function onRender(popover, opts) {
    const idx = opts.state.activeIndex || 0;
    const total = opts.config.steps.length;
    const isLast = idx === total - 1;
    const bar = document.createElement('div');
    bar.className = 'tour-progress';
    bar.setAttribute('aria-hidden', 'true');
    bar.innerHTML = `<i style="width:${(((idx + 1) / total) * 100).toFixed(1)}%"></i>`;
    popover.wrapper.prepend(bar);
    if (popover.progress) popover.progress.textContent = isLast ? 'Resumen' : `Paso ${idx + 1} de ${Math.min(TOTAL, total - 1)}`;
    if (popover.closeButton) { popover.closeButton.setAttribute('aria-label', 'Cerrar tour'); popover.closeButton.title = 'Cerrar'; }
  }

  function startTour() {
    if (!driverFactory) return;
    hideOffer();
    storeSet('1');
    if (drv && drv.isActive()) drv.destroy();
    drv = driverFactory({
      steps: buildSteps(),
      showProgress: true,
      progressText: '{{current}} de {{total}}',
      nextBtnText: 'Siguiente',
      prevBtnText: 'Anterior',
      doneBtnText: 'Terminar',
      allowClose: true,
      smoothScroll: !reduceMotion(),
      animate: !reduceMotion(),
      overlayColor: '#1f1c19',
      overlayOpacity: 0.45,
      stagePadding: 6,
      stageRadius: 6,
      popoverOffset: 12,
      popoverClass: 'tour-pop',
      onPopoverRender: onRender,
      onDestroyed: () => { undoExampleSwap(); const b = $('btn-tour'); if (b) b.focus({ preventScroll: true }); },
    });
    drv.drive();
  }

  // ---------- Oferta en el primer ingreso ----------
  function hideOffer() { const o = $('tour-offer'); if (o) o.hidden = true; }
  function maybeOffer() {
    if (storeGet()) return;
    const o = $('tour-offer');
    if (!o || !driverFactory) return;
    o.hidden = false;
  }

  function init() {
    const btn = $('btn-tour');
    if (!driverFactory) { if (btn) btn.hidden = true; return; }
    btn.addEventListener('click', startTour);
    $('tour-offer-start').addEventListener('click', startTour);
    $('tour-offer-skip').addEventListener('click', () => { storeSet('1'); hideOffer(); btn.focus(); });
    document.addEventListener('keydown', (ev) => {
      if (ev.key !== 't' && ev.key !== 'T') return;
      if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
      const t = ev.target;
      if (t && (t.isContentEditable || /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName))) return;
      if (drv && drv.isActive()) return;
      ev.preventDefault();
      startTour();
    });
    setTimeout(maybeOffer, 600);
  }

  window.DemoTour = { start: startTour };
  init();
})();
