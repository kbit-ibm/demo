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
