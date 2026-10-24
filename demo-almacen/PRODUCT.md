# Kbit · Laboratorio de asignación

## Purpose
Demo local para presentar y ejecutar una comparación entre los cuatro métodos clásicos recuperados de kbit-ibm/demo y un método híbrido QAOA con Qiskit. La audiencia es el equipo y los evaluadores de la hackatón. Debe entenderse el estado inicial, qué cambia y cómo se mide la mejora.

## Scope and confirmed constraints
El usuario pidió recuperar y verificar el repositorio, unificar ambos enfoques y el diseño, retirar Gradio y mejorar la presentación. Se conserva qap10 oficial (10 productos/10 posiciones) y se incorpora la instancia original (30 productos/32 posiciones). No hay publicación, subida de código ni llamadas a QPU.

Cada producto ocupa una posición distinta. Peso de relación × distancia, suma sobre i<k. Las relaciones representan afinidad de aparición conjunta en una canasta; qap10 no contiene probabilidades ni frecuencias comerciales medidas. No atribuir ahorro de minutos o energía.

Los métodos reciben las mismas matrices y escala. Búsqueda local, recocido, pulido e híbrido Qiskit reciben el mismo inicio; greedy es constructivo y se identifica como tal. Los reinicios y presupuestos son explícitos. En 30 productos no se conoce el óptimo.

## Platform and stack
Aplicación web local adaptable. Backend Python FastAPI, Qiskit SDK y SciPy. Motor clásico JavaScript original ejecutado mediante Node.js. Frontend HTML/CSS/JavaScript, sin framework ni Gradio. Esta elección implementa la solicitud de una interfaz propia y mantiene el motor recuperado sin traducciones.

## Required user flow
Elegir instancia y semilla; revisar plano inicial; opcionalmente intercambiar dos posiciones; ejecutar los cinco métodos; inspeccionar tres planos, métricas, curvas y parejas; cambiar el clásico mostrado; descargar evidencia JSON. Configuración y resultados se invalidan al cambiar parámetros. La instancia original conserva densidad, perfil y mes de canastas simulado separado de F.

## Visual direction
Preferencia explícita actual: dashboard minimalista únicamente en blanco, negro y grises. Sin landing ni bloques de explicación. Tres planos y métricas en la vista principal; relaciones y datos en pestañas. Tipografía local DM Sans. Las métricas y los resultados no deben simularse.
