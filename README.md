# Optimización de Layout de Almacén — Solución Clásica

Demo interactivo (HTML/CSS/JS, sin dependencias) para asignar 30 SKUs a 32 ubicaciones
(4 pasillos × 8 posiciones) minimizando la distancia ponderada por co-picking.

Solvers clásicos: constructivo (greedy), búsqueda local, recocido simulado y recocido + pulido.
También hay modo manual para intercambiar SKUs y comparar contra los solvers.

## Uso

Abrir `index.html` en el navegador, o:

```bash
python -m http.server 8000
```

y entrar a http://localhost:8000

## Demo unificada: clásico y Qiskit

La versión comparativa está en [`demo-almacen`](demo-almacen/README.md): dashboard en blanco y negro, cuatro métodos clásicos y un híbrido QAOA, con las instancias qap10 (10/10) y original (30/32).

```bash
cd demo-almacen
python -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python app.py
```

Abre http://127.0.0.1:7860. La demo clásica de la raíz sigue disponible como antes.
