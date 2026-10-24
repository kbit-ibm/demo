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
