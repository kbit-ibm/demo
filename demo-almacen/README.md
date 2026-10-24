# Kbit · comparación clásica y Qiskit

```bash
python -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python app.py
```

Requiere Python 3.13 y Node.js (probado con Node 26). Abre **http://127.0.0.1:7860**. Interfaz propia; no utiliza Gradio.

- Motor clásico recuperado de `kbit-ibm/demo`, commit `1d3418f`, conservado sin cambios en `vendor/warehouse-engine.js`.
- Cuatro métodos clásicos originales y un híbrido QAOA que ejecuta Qiskit localmente.
- Dos instancias: qap10 oficial (10/10) y la original del repositorio (30/32).
- Mismas matrices, inicio y escala de costo. Greedy es constructivo; los otros reciben el inicio común. El adaptador corrige el doble conteo original y transmite el inicio al recocido con pulido.
- Se ven inicio/final, métricas, relaciones, curvas y circuito; descarga JSON con la evidencia completa.

Para verificar: `.venv/bin/python -m unittest discover -s tests -v`. La prueba de navegador usa `requirements-dev.txt`, `python -m playwright install chromium` y `python tests/browser_check.py` con el servidor iniciado.

El híbrido no garantiza mejorar al clásico. QAP10 tiene óptimo 340; el óptimo de la instancia 30/32 es desconocido. El costo no equivale a minutos ni demuestra ventaja cuántica. La documentación ampliada queda pendiente para una etapa posterior.

## Evaluación con presupuesto común

El modo mejorado utiliza un inicio clásico (cargado al presupuesto), selección adaptativa de vecindarios, CVaR y reutilización de ángulos QAOA. El dashboard conserva el modo anterior para comparar. La pestaña Evaluación muestra cinco semillas y un control con los mismos vecindarios sin Qiskit.

```bash
.venv/bin/python benchmark.py --scenario original --seconds 1 --seeds 7 19 42 73 101
```

Los resultados se conservan completos en `results/fair_benchmark.json`; no se descartan semillas desfavorables. Solo se aceptan soluciones completadas antes del límite, incluido el arranque de procesos. El tiempo total de retorno puede exceder unos milisegundos por serialización. Al alcanzar el óptimo conocido de qap10 los métodos paran. La ganancia adicional de Qiskit se mide después del inicio clásico; una mejora del híbrido completo no demuestra una mejora atribuible al circuito.

CVaR: [documentación oficial IBM](https://quantum.cloud.ibm.com/docs/en/tutorials/advanced-techniques-for-qaoa).
