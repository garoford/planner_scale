// Planner: planificador visual. Sin dependencias: node server.js
// Sirve index.html y guarda el plan en data/plan.json (legible y editable por agentes).
// - GET/PUT /api/plan con ETag: un PUT basado en una versión vieja recibe 409 (nadie pisa a nadie).
// - GET /api/events (SSE): avisa a la página cuando plan.json cambia (p. ej. lo editó Claude).
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = Number(process.env.PORT) || 5171;
const ROOT = __dirname;
const DIR = path.join(ROOT, "data");
const DATA = path.join(DIR, "plan.json");

const tag = (txt) => '"' + crypto.createHash("sha1").update(txt).digest("hex").slice(0, 16) + '"';
const readPlan = () => { try { return fs.readFileSync(DATA, "utf8"); } catch { return null; } };

const send = (res, code, body, type = "text/plain; charset=utf-8", extra = {}) => {
  res.writeHead(code, { "Content-Type": type, "Cache-Control": "no-store", ...extra });
  res.end(body);
};

/* Aviso en vivo de cambios en plan.json */
const clients = new Set();
let lastTag = null, watchT = null;
const broadcast = () => {
  const txt = readPlan(); if (txt == null) return;
  const t = tag(txt); if (t === lastTag) return; lastTag = t;
  for (const res of clients) res.write(`data: ${t}\n\n`);
};
fs.mkdirSync(DIR, { recursive: true });
lastTag = (readPlan() && tag(readPlan())) || null;
fs.watch(DIR, (_, file) => {
  if (file && !String(file).startsWith("plan.json")) return;
  clearTimeout(watchT); watchT = setTimeout(broadcast, 60);
});
setInterval(() => { for (const res of clients) res.write(": ping\n\n"); }, 25000);

http
  .createServer((req, res) => {
    const url = req.url.split("?")[0];

    if (url === "/api/plan" && req.method === "GET") {
      const txt = readPlan();
      return txt == null ? send(res, 404, "{}", "application/json") : send(res, 200, txt, "application/json", { ETag: tag(txt) });
    }

    if (url === "/api/plan" && req.method === "PUT") {
      let body = "";
      req.on("data", (c) => { body += c; if (body.length > 5e6) req.destroy(); });
      req.on("end", () => {
        let json, obj;
        try { obj = JSON.parse(body); json = JSON.stringify(obj, null, 2); } catch { return send(res, 400, "JSON inválido"); }
        // Estructura mínima: nunca guardar un plan roto (evita perder el plan por un error de un agente o de la página)
        const cols = Array.isArray(obj.columns) ? new Set(obj.columns.map((c) => c && c.id)) : null;
        const bad = !cols || !cols.size || !Array.isArray(obj.cards) || !Array.isArray(obj.flows || []) || !Array.isArray(obj.resources || [])
          || obj.cards.some((c) => !c || !c.id || !cols.has(c.col));
        if (bad) return send(res, 400, "Plan con estructura inválida; no se guarda.");
        const cur = readPlan(), ifMatch = req.headers["if-match"];
        if (cur != null && ifMatch && ifMatch !== tag(cur)) {
          return send(res, 409, JSON.stringify({ etag: tag(cur), plan: JSON.parse(cur) }), "application/json");
        }
        fs.writeFileSync(DATA + ".tmp", json);
        fs.renameSync(DATA + ".tmp", DATA);
        lastTag = tag(json);
        for (const c of clients) c.write(`data: ${lastTag}\n\n`);
        send(res, 200, JSON.stringify({ etag: lastTag }), "application/json");
      });
      return;
    }

    if (url === "/api/events") {
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store", Connection: "keep-alive" });
      res.write(`data: ${lastTag}\n\n`);
      clients.add(res);
      req.on("close", () => clients.delete(res));
      return;
    }

    if (url === "/" || url === "/index.html") {
      fs.readFile(path.join(ROOT, "index.html"), (err, buf) =>
        err ? send(res, 500, "Falta index.html") : send(res, 200, buf, "text/html; charset=utf-8")
      );
      return;
    }

    const m = url.match(/^\/vendor\/([\w.-]+\.js)$/);
    if (m) {
      fs.readFile(path.join(ROOT, "vendor", m[1]), (err, buf) => {
        if (err) return send(res, 404, "No encontrado");
        res.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "public, max-age=31536000, immutable" });
        res.end(buf);
      });
      return;
    }

    send(res, 404, "No encontrado");
  })
  .listen(PORT, () => console.log(`Planner → http://localhost:${PORT}`));
