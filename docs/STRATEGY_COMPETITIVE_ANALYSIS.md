# ⚡🛡️ Análisis Comparativo y Hoja de Ruta Estratégica: Mayros vs. La Competencia

Este documento detalla las brechas técnicas y oportunidades estratégicas de **Mayros** frente a productos consolidados como **Claude Code** (Anthropic) y **Gemini CLI** (Google).

---

## 1. Filosofía de Producto: "Asistente Total" o "Herramienta Quirúrgica"

| Producto          | Enfoque Principal       | Fortalezas                                                                 | Debilidades en Dev-Flow                                 |
| :---------------- | :---------------------- | :------------------------------------------------------------------------- | :------------------------------------------------------ |
| **Mayros**        | **AI Operating System** | Omnipresencia (WhatsApp/Mobile), Memoria persistente (Cortex), Multicanal. | Fricción de inicio alta (Onboarding/Gateway).           |
| **Claude/Gemini** | **AI Pair Programmer**  | Integración Git profunda, Zero-config, Foco 100% en Terminal.              | Memoria efímera, Atados a su propio ecosistema de nube. |

### 💡 La Oportunidad para Mayros

Mayros debe implementar un **Modo "Dev-First"**. Actualmente, Mayros se siente como un asistente al que "invitas" a tu proyecto. Claude Code se siente como una extensión de tu terminal.

- **Acción:** Crear un comando `mayros init` o `mayros dev` que autodetecte el contexto del repo, ignore archivos vía `.gitignore` y comience a indexar en Cortex sin configuración manual.

---

## 2. Interfaz de Usuario (TUI) y Fluidez

- **Gemini CLI (Ink/React):** Ofrece una experiencia visualmente rica con barras de progreso interactivas y componentes que se actualizan sin "parpadeos".
- **Mayros (@mariozechner/pi-tui):** Es funcional y potente (soporta Vim), pero visualmente más rígido.

### 💡 Brecha técnica

- **Interactividad:** Durante tareas largas (escaneo de código, generación de planes), Mayros necesita una retroalimentación visual más granular y moderna.
- **Visualización de Contexto:** La herramienta actual de visualización de tokens es excelente, pero podría integrarse mejor en el flujo de chat principal para dar confianza al usuario sobre qué está leyendo la IA.

---

## 3. Distribución y Fricción de Instalación

Los desarrolladores valoran la velocidad de "Time-to-Hello-World".

- **Claude/Gemini:** Tienden hacia binarios únicos (SEA - Single Executable Apps) o instalaciones globales extremadamente rápidas.
- **Mayros:** Requiere Node.js >=22, instalación de Gateway (demonio), y un wizard de onboarding.

### 💡 Recomendación

- **Binario Único:** Explorar el empaquetado con **Bun** o **Node SEA** para ofrecer un instalador de un solo paso que no dependa de la versión de Node del sistema del usuario.
- **Modo "Ephemeral Gateway":** Permitir que el CLI levante un Gateway temporal en memoria si no detecta uno corriendo, eliminando la necesidad de `mayros gateway` como paso previo obligatorio.

---

## 4. El "Killer Feature": AIngle Cortex (Memoria Semántica)

Esta es la mayor ventaja competitiva de Mayros. Mientras Claude y Gemini olvidan el contexto entre sesiones o dependen de RAGs simples, Mayros tiene un grafo RDF persistente.

### 💡 Cómo ganar aquí

- **Evals de Arquitectura:** Publicar benchmarks que demuestren cómo Mayros resuelve problemas de "deuda técnica" o "refactorización a gran escala" mejor que otros gracias a Cortex.
- **Transparencia:** Mostrar al usuario _qué_ recordó Mayros de la sesión de ayer: _"Recordando que decidimos usar el patrón Repository en el módulo X..."_. Esto genera una confianza que la competencia no puede ofrecer.

---

## 5. Integración con el Ecosistema Git/GitHub

Claude Code destaca por su capacidad de gestionar el ciclo de vida de un PR desde la terminal.

### 💡 Faltantes en Mayros

- **Comandos de conveniencia:** Añadir herramientas nativas para:
  - `/review`: Revisar cambios locales antes de un commit.
  - `/commit`: Generar mensajes de commit basados en el diff (Conventional Commits).
  - `/pr`: Integración con la CLI de GitHub (`gh`) para crear pull requests.

---

## 6. Seguridad y Sandboxing

Mayros es superior en seguridad gracias a su **QuickJS WASM Sandbox** y sus 18 capas de protección.

### 💡 Estrategia de Marketing para Devs

- Promocionar Mayros como el CLI de IA **"Enterprise-Ready"**. Mientras que otros ejecutan comandos directamente en tu shell, Mayros puede (y debe por defecto en entornos sensibles) correr todo en un sandbox seguro.

---

## Resumen de Hoja de Ruta Crítica (Roadmap)

1.  **[Prioridad 1] Rapidez:** Reducir el tiempo de instalación y eliminar la obligatoriedad del onboarding manual para usuarios expertos.
2.  **[Prioridad 1] Git-Flow:** Implementar comandos directos para diffs, commits y revisiones de código.
3.  **[Prioridad 2] TUI Polish:** Modernizar los componentes visuales de la terminal para igualar la fluidez de Ink (React CLI).
4.  **[Prioridad 3] Benchmarking:** Crear y publicar el "Cortex Eval" para demostrar la superioridad de la memoria semántica en ingeniería de software.

---

_Documento generado por Gemini CLI para el equipo de Apilium Technologies._
