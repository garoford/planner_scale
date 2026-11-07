#!/usr/bin/env node
// CLI del plan para agentes (Claude). Lee/escribe plan/data/plan.json de forma atómica.
// La página abierta se actualiza sola (el servidor avisa del cambio).
//
//   node plan/cli.js                     resumen compacto de todo el plan
//   node plan/cli.js ver <id>            detalle de una tarjeta / flujo / recurso (c7, fl1, r1)
//   node plan/cli.js mover <id> <col>    mueve una tarjeta de columna (id o nombre: curso, hecho…)
//   node plan/cli.js check <id> <n|texto> [off]   marca (o desmarca) un paso del checklist
//   node plan/cli.js paso <id> "texto"   añade un paso al checklist
//   node plan/cli.js nota <id> "texto"   añade una línea a las notas (tarjeta, flujo o recurso)
//   node plan/cli.js nueva "título" --col <listo|definir|ideas…> [--area back] [--fase f1] [--prio alta] [--nota "…"] [--flujo fl1]
//        --col es obligatorio. «definir» SOLO si espera una decisión del usuario, y entonces --nota debe
//        empezar por «Falta decidir: …». Lo ya decidido va a «listo».
//   node plan/cli.js validar             comprueba el plan (referencias, columnas, «Falta decidir»…)
//   node plan/cli.js set <id> <campo> "valor"   cambia un campo simple (title, area, phase, priority, status…)
//
// Para cambios grandes (flujos Mermaid, varios elementos) edita el JSON directamente con node,
// manteniendo el esquema descrito en plan/CLAUDE.md.
const fs = require("fs");
const path = require("path");

const FILE = path.join(__dirname, "data", "plan.json");
const S = JSON.parse(fs.readFileSync(FILE, "utf8"));
S.cards ||= []; S.flows ||= []; S.resources ||= []; S.phases ||= []; S.areas ||= []; S.columns ||= [];
S.flows.forEach((f) => (f.cards ||= []));

const today = () => new Date().toISOString().slice(0, 10);
const die = (m) => { console.error("✗ " + m); process.exit(1); };
function problems() {
  const out = [], ids = new Set(), dup = (id) => { if (ids.has(id)) out.push(`id duplicado: ${id}`); ids.add(id); };
  const cols = new Set(S.columns.map((c) => c.id)), phases = new Set(S.phases.map((p) => p.id)), areas = new Set(S.areas.map((a) => a.id));
  for (const c of S.cards) {
    dup(c.id);
    if (!c.title) out.push(`${c.id}: sin título`);
    if (!cols.has(c.col)) out.push(`${c.id}: columna "${c.col}" no existe`);
    if (c.phase && !phases.has(c.phase)) out.push(`${c.id}: fase "${c.phase}" no existe`);
    if (c.area && !areas.has(c.area)) out.push(`${c.id}: área "${c.area}" no existe`);
    if (!["alta", "media", "baja"].includes(c.priority)) out.push(`${c.id}: prioridad "${c.priority}" inválida`);
    if (c.col === "definir" && !/Falta decidir:/.test(c.notes || "")) out.push(`${c.id}: está en «Por definir» sin «Falta decidir: …» en las notas (si ya está decidido, va a «listo»)`);
    if (c.col !== "definir" && /Falta decidir:/.test(c.notes || "")) out.push(`${c.id}: dice «Falta decidir» pero está en «${c.col}» (¿muévela a definir o quita la línea?)`);
  }
  for (const f of S.flows) { dup(f.id); for (const k of f.cards) if (!S.cards.find((c) => c.id === k)) out.push(`${f.id}: tarjeta vinculada ${k} no existe`); if (!f.source?.trim()) out.push(`${f.id}: sin diagrama`); }
  for (const r of S.resources) { dup(r.id); if (!["adoptado", "evaluando", "descartado"].includes(r.status)) out.push(`${r.id}: estado "${r.status}" inválido`); }
  return out;
}
const write = () => {
  S.updated = new Date().toISOString();
  fs.writeFileSync(FILE + ".tmp", JSON.stringify(S, null, 2));
  fs.renameSync(FILE + ".tmp", FILE);
  const p = problems(); if (p.length) console.error("⚠ El plan tiene problemas:\n  - " + p.join("\n  - "));
};
const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const findIn = (arr, q) => arr.find((x) => x.id === q) || arr.find((x) => norm(x.name).startsWith(norm(q)));
const col = (q) => findIn(S.columns, q) || die(`columna "${q}" no existe (${S.columns.map((c) => c.id).join(", ")})`);
const colName = (id) => (S.columns.find((c) => c.id === id) || {}).name || id;
const phaseName = (id) => (S.phases.find((p) => p.id === id) || {}).name || "Sin fase";
const areaName = (id) => (S.areas.find((a) => a.id === id) || {}).name || "General";
const flowsOf = (cid) => S.flows.filter((f) => f.cards.includes(cid)).map((f) => f.id);
const nextId = (p, arr) => p + (1 + arr.reduce((m, x) => { const n = x.id.startsWith(p) ? parseInt(x.id.slice(p.length), 10) || 0 : 0; return Math.max(m, n); }, 0));
const item = (id) => {
  const c = S.cards.find((x) => x.id === id); if (c) return ["card", c];
  const f = S.flows.find((x) => x.id === id); if (f) return ["flow", f];
  const r = S.resources.find((x) => x.id === id); if (r) return ["res", r];
  die(`"${id}" no existe`);
};
const cardLine = (c) => {
  const d = c.checklist.filter((x) => x.done).length, n = c.checklist.length;
  const bits = [areaName(c.area), phaseName(c.phase), c.priority !== "media" ? c.priority : "", n ? `✓${d}/${n}` : "", flowsOf(c.id).length ? "flujo " + flowsOf(c.id).join(",") : ""].filter(Boolean);
  return `  - [${c.id}] ${c.title} (${bits.join(" · ")})`;
};
const flag = (name) => { const i = args.indexOf("--" + name); return i < 0 ? undefined : args.splice(i, 2)[1]; };

const [cmd = "resumen", ...args] = process.argv.slice(2);

switch (cmd) {
  case "resumen": {
    const out = [`# Plan ${S.project || ""} · actualizado ${(S.updated || "").slice(0, 16).replace("T", " ")}`];
    if (S.guide?.length) { out.push("\n## Reglas del plan (obligatorias)"); S.guide.forEach((g) => out.push("- " + g)); }
    out.push("\n## Tablero");
    for (const c of S.columns) {
      const cs = S.cards.filter((x) => x.col === c.id);
      out.push(`- ${c.name} [${c.id}] (${cs.length})`); cs.forEach((x) => out.push(cardLine(x) + (x.col === "definir" ? "\n      " + ((x.notes || "").match(/Falta decidir:[^\n]*/) || [""])[0] : "")));
    }
    out.push("\n## Roadmap");
    for (const p of S.phases) {
      const cs = S.cards.filter((x) => x.phase === p.id), last = S.columns[S.columns.length - 1]?.id;
      out.push(`- ${p.name} [${p.id}] ${cs.filter((x) => x.col === last).length}/${cs.length} hechas — ${p.goal || ""}`);
    }
    const dec = S.resources.filter((r) => r.status === "adoptado" && r.decision);
    if (dec.length) { out.push("\n## Decisiones vigentes (recursos adoptados)"); dec.forEach((r) => out.push(`- [${r.id}] ${r.title}: ${r.decision}`)); }
    const ev = S.resources.filter((r) => r.status === "evaluando");
    if (ev.length) { out.push("\n## Recursos en evaluación"); ev.forEach((r) => out.push(`- [${r.id}] ${r.title || r.url}`)); }
    if (S.flows.length) { out.push("\n## Flujos"); S.flows.forEach((f) => out.push(`- [${f.id}] ${f.title} — ${f.description || ""}${f.cards.length ? ` (tarjetas: ${f.cards.join(", ")})` : ""}`)); }
    out.push(`\nÁreas: ${S.areas.map((a) => a.id).join(", ")} · Columnas: ${S.columns.map((c) => c.id).join(", ")} · Fases: ${S.phases.map((p) => p.id).join(", ")}`);
    console.log(out.join("\n"));
    break;
  }
  case "ver": {
    const [kind, x] = item(args[0] || die("falta id"));
    const extra = kind === "card" ? { _estado: colName(x.col), _fase: phaseName(x.phase), _flujos: flowsOf(x.id) } : {};
    console.log(JSON.stringify({ ...x, ...extra }, null, 2));
    break;
  }
  case "mover": {
    const [kind, c] = item(args[0] || die("falta id")); if (kind !== "card") die("solo tarjetas");
    const dest = col(args[1] || die("falta columna")).id;
    if (dest === "definir" && !/Falta decidir:/.test(c.notes || "")) die(`Antes añade qué falta: nota ${c.id} "Falta decidir: …"`);
    if (c.col === "definir" && dest !== "definir") c.notes = (c.notes || "").replace(/^Falta decidir:[^\n]*\n?/m, "").trim();
    c.col = dest; write(); console.log(`✓ ${c.id} → ${colName(c.col)}`);
    break;
  }
  case "check": {
    const [kind, c] = item(args[0] || die("falta id")); if (kind !== "card") die("solo tarjetas");
    const q = args[1] ?? die("falta paso (número desde 1 o texto)");
    const step = /^\d+$/.test(q) ? c.checklist[+q - 1] : c.checklist.find((x) => norm(x.t).includes(norm(q)));
    if (!step) die(`paso "${q}" no encontrado`);
    step.done = args[2] !== "off"; write(); console.log(`✓ ${c.id}: ${step.done ? "[x]" : "[ ]"} ${step.t}`);
    break;
  }
  case "paso": {
    const [kind, c] = item(args[0] || die("falta id")); if (kind !== "card") die("solo tarjetas");
    c.checklist.push({ t: args[1] || die("falta texto"), done: false }); write(); console.log(`✓ ${c.id}: paso añadido`);
    break;
  }
  case "nota": {
    const [kind, x] = item(args[0] || die("falta id")); const t = args[1] || die("falta texto");
    const k = kind === "res" ? "note" : kind === "flow" ? "description" : "notes";
    x[k] = x[k] ? x[k] + "\n" + t : t; if (kind === "flow") x.updated = today();
    write(); console.log(`✓ ${x.id}: nota añadida`);
    break;
  }
  case "nueva": {
    const c0 = flag("col"), a = flag("area"), fa = flag("fase"), pr = flag("prio"), no = flag("nota"), fl = flag("flujo");
    const title = args[0] || die('falta título: nueva "título" --col <columna>');
    if (!c0) die("--col es obligatorio. «listo» = ya decidido · «definir» = espera decisión del usuario (con --nota \"Falta decidir: …\") · «ideas» = sin compromiso.");
    if (col(c0).id === "definir" && !/^Falta decidir:/.test(no || "")) die('En «definir» la nota debe empezar por «Falta decidir: …». Si ya está decidido, usa --col listo.');
    if (a && !S.areas.find((x) => x.id === a)) die(`área "${a}" no existe`);
    const c = { id: nextId("c", S.cards), col: c0 ? col(c0).id : S.columns[0].id, phase: fa ? (findIn(S.phases, fa) || die(`fase "${fa}" no existe`)).id : "",
      area: a || S.areas[0]?.id || "", priority: pr || "media", title, notes: no || "", checklist: [] };
    S.cards.push(c);
    if (fl) (S.flows.find((f) => f.id === fl) || die(`flujo "${fl}" no existe`)).cards.push(c.id);
    write(); console.log(`✓ creada [${c.id}] ${title} → ${colName(c.col)} · ${phaseName(c.phase)}`);
    break;
  }
  case "set": {
    const [, x] = item(args[0] || die("falta id")); const k = args[1] || die("falta campo"), v = args[2] ?? die("falta valor");
    if (["id", "cards", "checklist"].includes(k) || (x[k] !== undefined && typeof x[k] === "object")) die(`"${k}" no se cambia con set`);
    x[k] = k === "col" ? col(v).id : k === "phase" && v ? (findIn(S.phases, v) || die(`fase "${v}" no existe`)).id : v;
    write(); console.log(`✓ ${x.id}.${k} = ${x[k]}`);
    break;
  }
  case "validar": {
    const p = problems();
    if (!p.length) { console.log(`✓ Plan válido (${S.cards.length} tarjetas, ${S.flows.length} flujos, ${S.resources.length} recursos)`); break; }
    console.error("✗ Problemas:\n  - " + p.join("\n  - ")); process.exit(1);
  }
  default:
    die(`comando "${cmd}" desconocido. Usa: resumen, ver, mover, check, paso, nota, nueva, set, validar`);
}
