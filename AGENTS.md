# plan/ — SOLO planificación visual

Esta carpeta es exclusivamente el planificador visual del proyecto. Aquí NO va código del producto
(eso vive en el resto del repo).

- `index.html`: planificador de una sola página con cuatro vistas: Tablero (estados), Roadmap (fases),
  Recursos (hallazgos + decisión) y Flujos (diagramas). HTML/CSS/JS sin build. Atajos: 1-4 vistas, N nuevo, / buscar.
- `vendor/mermaid.min.js`: Mermaid 11.4.1 local (se carga solo al abrir Flujos).
- `server.js`: servidor Node sin dependencias. `node server.js` → http://localhost:5171. Protege contra pisarse
  (ETag/409) y avisa en vivo a la página cuando `plan.json` cambia, así que Claude puede editar con la página abierta.
- `cli.js`: CLI para agentes (ver abajo).
- `data/plan.json`: la fuente de verdad del plan. La página lo guarda sola al editar y se actualiza en vivo
  cuando un agente lo cambia. Escribe siempre de forma atómica (archivo .tmp + rename), como hace la CLI.
- Skill de diseño `impeccable` instalada solo aquí (`.agents/skills/impeccable`, enlazada en `.claude/skills`).
  Úsala para cualquier mejora visual del planificador.

Reglas del plan: también están dentro de `data/plan.json` → `guide` (las muestra `node plan/cli.js` y el botón ? de la página).
Validar siempre tras editar: `node plan/cli.js validar`. El servidor rechaza planes con estructura rota.

Esquema de `plan.json`: `guide[texto]`, `columns[{id,name}]` (las 5 base no se borran), `phases[{id,name,goal}]`, `areas[{id,name,hue}]`,
`cards[{id,col,phase,area,priority(alta|media|baja),title,notes,checklist[{t,done}]}]`,
`resources[{id,title,url,kind,status(adoptado|evaluando|descartado),area,note,decision,added}]`,
`flows[{id,title,area,description,source,updated,cards[cardId]}]`.
Los recursos `adoptado` son decisiones del producto: reflejarlas también en el contexto del proyecto si existe.

## Flujos que diseñamos con Claude

Cuando el usuario y Claude diseñen un flujo (de usuario, de sistema, de datos, de agentes…), Claude lo guarda en
`data/plan.json` → `flows` para que el usuario lo vea en la vista **Flujos** (http://localhost:5171/#flujos).
- `source` es código **Mermaid** (`flowchart LR|TD`, `sequenceDiagram`, `stateDiagram-v2`, `erDiagram`…).
  Textos en español, nodos cortos; `-->|etiqueta|` para las decisiones.
- `id` = siguiente número (`fl11`, `fl12`…), `updated` = fecha de hoy (YYYY-MM-DD), `area` = id de un área o `""`.
- Después de editarlo: `node plan/cli.js validar`. La página se actualiza sola en vivo.
- Flujo ↔ tablero: el vínculo vive en `flows[].cards` (ids de tarjetas). Si el flujo genera trabajo, crea sus
  tarjetas en `cards` (con `phase` del roadmap) y añade sus ids a `cards` del flujo. La tarjeta muestra “Flujo”
  y el flujo muestra sus tarjetas con estado y progreso.

## Columnas del tablero (respetar)
- **Ideas**: posibles, sin compromiso (o para mucho después).
- **Por definir**: SOLO lo que espera una decisión del usuario. En las notas, qué falta decidir.
- **Listo para construir**: ya decidido. El orden lo da la fase del roadmap, no la columna.
- **En curso** / **Hecho**: ejecución.
Al registrar algo que el usuario ya decidió, va a «Listo para construir», no a «Por definir».
La CLI y la página hacen cumplir esta regla (piden «Falta decidir» al mover a Por definir y la quitan al sacarla).

## Trabajar con Claude (planificar y ejecutar)

Referencias: cada elemento tiene un id visible y copiable en la página (`#c7` tarjeta, `#fl1` flujo, `#r1` recurso).
Ids nuevos: siguiente número del prefijo (`c`, `fl`, `r`).

CLI (`node plan/cli.js …`, desde la raíz del proyecto):
- *(sin argumentos)*: resumen compacto de tablero, roadmap, decisiones, recursos en evaluación y flujos. Úsalo en vez de leer el JSON.
- `ver <id>`: detalle completo · `mover <id> <col>` · `check <id> <n|texto> [off]` · `paso <id> "texto"`
- `nota <id> "texto"` · `nueva "título" --col <col> [--area] [--fase] [--prio] [--nota] [--flujo]` · `set <id> <campo> "valor"`
- `validar`: comprueba el plan (referencias, columnas, «Falta decidir»). Se ejecuta solo tras cada cambio de la CLI.
- `--col` es obligatorio; con `--col definir` la nota debe empezar por «Falta decidir: …».

Al planificar con el usuario: crea o ajusta tarjetas, fases, recursos y flujos para que lo vea en la página al momento.
Al ejecutar una tarjeta: `mover <id> curso` → hacer el trabajo en el código del proyecto → `check` de cada paso →
`nota <id> "qué se hizo / dónde"` → `mover <id> hecho`. Si surge trabajo nuevo, `nueva` en lugar de hacerlo sin registrar.
