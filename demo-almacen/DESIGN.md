---
name: Kbit Lab
description: Laboratorio comparativo de asignación de productos
colors:
  paper: "#ffffff"
  white: "#ffffff"
  ink: "#171717"
  muted: "#666666"
  line: "#e5e5e5"
  primary: "#171717"
  wash: "#f6f6f6"
  orange: "#111111"
  quantum: "#666666"
  quantum-wash: "#fafafa"
typography:
  display:
    fontFamily: DM
    fontSize: "clamp(32px,4vw,51px)"
    fontWeight: 550
    lineHeight: 1.1
    letterSpacing: "-0.035em"
  body:
    fontFamily: DM
    fontSize: "15px"
    lineHeight: 1.55
rounded:
  control: "7px"
  surface: "12px"
spacing:
  sm: "8px"
  md: "18px"
  lg: "34px"
  page: "44px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.white}"
    rounded: "{rounded.control}"
    padding: "9px 16px"
---

## Overview
Dashboard compacto: barra lateral, controles, tres planos y métricas. Las vistas de Relaciones y Datos se abren mediante pestañas. Sin hero de landing ni bloques explicativos.

## Colors
Solo blanco, negro y grises. Gris de relleno indica productos reubicados; una línea negra identifica la pareja seleccionada. Fondo blanco, límites finos, botón principal negro.

## Typography
DM Sans variable, servida desde assets locales con licencia OFL. Números tabulares en tablas y métricas. Textos secundarios de 12px o más; el plano usa coordenadas SVG y textos escalados. No utilizar colores débiles para datos importantes.

## Layout
Barra lateral de 170px y espacio de trabajo de ancho flexible, con margen de 24px. En móvil la navegación pasa arriba. Tres planos alineados en escritorio, apilados en móvil. Tablas con scroll propio. La distribución física siempre deriva de los datos, no de una cuadrícula decorativa.

## Elevation & Depth
Sin sombras ornamentales. Separar secciones con líneas finas y espacio. Controles sobre blanco, superficies auxiliares con color suave.

## Shapes
Controles de 7px; configuración de 12px. Diagramas con recuadros de producto y líneas geométricas. Las posiciones vacías usan borde discontinuo.

## Components
Configuración plegable, botones con estados disabled/loading, estado de ejecución anunciado, tabla seleccionable de métodos, diagramas interactivos por teclado, curvas SVG accesibles y detalles expandibles. Selección de texto, foco, careta y scrollbars usan la paleta. El movimiento respeta prefers-reduced-motion.

## Do's and Don'ts
Mostrar el inicio antes de ejecutar; conservar la misma pareja destacada en los tres planos. No inventar métricas, brechas desconocidas, ventaja cuántica o tiempos operativos. No sustituir resultados por precálculos visuales ni reintroducir Gradio.
