// Doorframe page logic. The same functions serve the visitor's clicks and the agent's
// website_* tools (site-actions.js), so both see one page state.
import { checkSite, checkDocuments, specLink } from "./check-core.js";

const $ = (s, r = document) => r.querySelector(s);
const esc = (t) => String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const SECTION_NAMES = {
  "2": "Network representation", "2.1": "Minimum network content", "3.1": "Runtime behavior",
  "3.2": "Peer loading", "3.3": "Minimum public files", "3.4": "Browser origins", "4": "Pluggable inference", "6": "Interoperability",
};
const ORDER = ["3.2", "3.3", "3.4", "2", "2.1", "3.1", "4", "6"];
const LABEL = { pass: "Pass", warn: "Warn", fail: "Fail", unknown: "Unknown" };

export class App {
  static last = null;
  static peerReports = [];
  static approved = new Set([location.origin]);

  static env() {
    return { fetch: (u, o) => fetch(u, o), isNode: false, sameOrigin: (u) => new URL(u).origin === location.origin };
  }

  /** Ask before Doorframe contacts a new origin (spec 5: consent before contact). */
  static async consent(url, purpose) {
    const origin = new URL(url).origin;
    if (App.approved.has(origin)) return true;
    const ok = await App.dialog({
      title: "Contact " + origin + "?",
      body: "Doorframe will send plain GET requests, without cookies or keys, to read " + purpose + " from this origin. Approval lasts for this visit only.",
      confirm: "Allow and check", decline: "Don't contact",
    });
    if (ok) App.approved.add(origin);
    return ok;
  }

  static dialog({ title, body, confirm, decline }) {
    return new Promise((resolve) => {
      const d = document.createElement("dialog");
      d.className = "df-dialog";
      d.innerHTML = `<form method="dialog"><h3>${esc(title)}</h3><p>${esc(body)}</p><div class="row"><button value="no" class="btn ghost">${esc(decline)}</button><button value="yes" class="btn">${esc(confirm)}</button></div></form>`;
      document.body.append(d);
      d.addEventListener("close", () => { resolve(d.returnValue === "yes"); d.remove(); });
      d.showModal();
    });
  }

  /** Run a live check and draw it. Returns the report, or a refusal. */
  static async runCheck(url, { fromAgent = false } = {}) {
    let parsed;
    try { parsed = new URL(String(url).trim()); } catch { return { ok: false, reason: "Not a full URL. Use https://..." }; }
    if (!(await App.consent(parsed.href, "the agent manifest, network and links.json"))) {
      App.status("Check cancelled: you did not allow contact with " + parsed.origin + ".");
      return { ok: false, reason: "The visitor did not allow contacting " + parsed.origin + "." };
    }
    $("#url").value = parsed.href;
    App.status("Checking " + parsed.href + " ...");
    $("#report").setAttribute("aria-busy", "true");
    const report = await checkSite(parsed.href, App.env());
    App.last = report;
    App.peerReports = [];
    App.render(report);
    App.status("Done. " + App.summaryLine(report) + (fromAgent ? " (run by the desk)" : ""));
    App.walkPeers(report);
    return { ok: true, report };
  }

  static runPasted() {
    const report = checkDocuments({
      manifestText: $("#p-manifest").value || null,
      networkText: $("#p-network").value || null,
      linksText: $("#p-links").value.trim() ? $("#p-links").value : null,
    }, { label: "pasted files" });
    App.last = report;
    App.peerReports = [];
    App.render(report);
    App.status("Checked pasted files. " + App.summaryLine(report) + " Hosting checks need a live URL.");
    return report;
  }

  /** Follow peer links one hop and check each peer too: the map of who you connect to. */
  static async walkPeers(report) {
    const peers = (report.peers || []).slice(0, 4);
    for (const p of peers) {
      if (!(await App.consent(p, "the linked peer network"))) {
        App.peerReports.push({ url: p, skipped: true });
      } else {
        const r = await checkSite(p, App.env());
        App.peerReports.push({ url: p, report: r });
      }
      App.drawGraph(report);
    }
  }

  static summaryLine(r) {
    return `${r.count.fail} fail, ${r.count.warn} warn, ${r.count.unknown} unknown, ${r.count.pass} pass.`;
  }

  static status(t) { $("#status").textContent = t; }

  static verdictText(r) {
    return { pass: "Ready for other agents", "pass-with-warnings": "Loads, with warnings", fail: "Blocked: fix the failures", incomplete: "Could not finish" }[r.verdict];
  }

  static render(r) {
    const el = $("#report");
    el.removeAttribute("aria-busy");
    el.hidden = false;
    $("#verdict").className = "verdict v-" + r.verdict;
    $("#verdict-title").textContent = App.verdictText(r);
    $("#verdict-target").textContent = r.base || r.target;
    $("#counts").innerHTML = ["fail", "warn", "unknown", "pass"].map((k) => `<span class="count c-${k}"><b>${r.count[k] || 0}</b> ${LABEL[k]}</span>`).join("");
    const groups = {};
    for (const c of r.checks) (groups[c.section] ||= []).push(c);
    const rank = { fail: 0, unknown: 1, warn: 2, pass: 3 };
    $("#checks").innerHTML = ORDER.filter((s) => groups[s]).map((s) => `
      <section class="group"><h4><a href="${esc(specLink(s))}" target="_blank" rel="noopener">Spec ${esc(s)}</a> ${esc(SECTION_NAMES[s] || "")}</h4>
      <ul>${groups[s].sort((a, b) => rank[a.status] - rank[b.status]).map((c) => `
        <li class="check s-${c.status}" id="chk-${esc(c.id.replace(/[^a-z0-9]/gi, "-"))}">
          <span class="badge">${LABEL[c.status]}</span>
          <div><p class="t">${esc(c.title)}</p><p class="d">${esc(c.detail)}</p></div>
        </li>`).join("")}</ul></section>`).join("");
    App.drawGraph(r);
  }

  /** Draw the agent network: front agent left, agents in the middle, actions and peers right. */
  static drawGraph(r) {
    const box = $("#graph");
    const g = r.graph;
    if (!g) { box.innerHTML = `<p class="muted">No network could be read, so there is nothing to draw.</p>`; return; }
    const W = 640, rowH = 46;
    const agents = g.agents.map((a) => a.name);
    const others = agents.filter((n) => n !== g.front);
    const rightItems = [];
    for (const e of g.edges) if (e.kind !== "agent" && !rightItems.find((x) => x.label === e.to)) rightItems.push({ label: e.to, kind: e.kind, url: e.url });
    for (const a of g.actions) rightItems.push({ label: "website_" + a, kind: "action" });
    const rows = Math.max(others.length, rightItems.length, 1);
    const H = Math.max(rows * rowH + 40, 140);
    const pos = {};
    pos[g.front] = { x: 20, y: H / 2 };
    others.forEach((n, i) => { pos[n] = { x: 210, y: 30 + i * ((H - 60) / Math.max(others.length - 1, 1)) + (others.length === 1 ? (H - 60) / 2 : 0) }; });
    rightItems.forEach((it, i) => { pos["R:" + it.label] = { x: 420, y: 30 + i * ((H - 60) / Math.max(rightItems.length - 1, 1)) + (rightItems.length === 1 ? (H - 60) / 2 : 0) }; });
    const peerState = (url) => {
      const pr = App.peerReports.find((p) => p.url === url);
      if (!pr) return "pending";
      return pr.skipped ? "skipped" : pr.report.verdict;
    };
    let lines = "", nodes = "";
    for (const e of g.edges) {
      const a = pos[e.from], b = e.kind === "agent" ? pos[e.to] : pos["R:" + e.to];
      if (!a || !b) continue;
      lines += `<path d="M${a.x + 150} ${a.y} C ${a.x + 175} ${a.y}, ${b.x - 25} ${b.y}, ${b.x} ${b.y}" class="edge e-${e.kind}"/>`;
    }
    if (g.actions.length) {
      const owner = pos[others[0]] || pos[g.front];
      for (const a of g.actions) { const b = pos["R:website_" + a]; lines += `<path d="M${owner.x + 150} ${owner.y} C ${owner.x + 175} ${owner.y}, ${b.x - 25} ${b.y}, ${b.x} ${b.y}" class="edge e-action"/>`; }
    }
    const node = (p, label, cls, sub, w = 150) => `<g class="node ${cls}" transform="translate(${p.x},${p.y - 16})"><rect width="${w}" height="32" rx="6"/><text x="10" y="${sub ? 14 : 20}">${esc(label.length > Math.floor(w / 7.4) ? label.slice(0, Math.floor(w / 7.4) - 1) + "..." : label)}</text>${sub ? `<text class="sub" x="10" y="26">${esc(sub)}</text>` : ""}</g>`;
    nodes += node(pos[g.front], g.front, "n-front", "front agent");
    for (const n of others) nodes += node(pos[n], n, "n-agent");
    for (const it of rightItems) {
      const sub = it.kind === "peer" ? "peer site: " + peerState(it.url || it.label) : it.kind === "action" ? "site action" : it.kind;
      nodes += node(pos["R:" + it.label], it.label, "n-" + it.kind + (it.kind === "peer" ? " p-" + peerState(it.url || it.label) : ""), sub, 210);
    }
    box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Agent network graph of ${esc(r.networks[0]?.name || "")}">${lines}${nodes}</svg>
      <p class="legend"><span class="lg l-agent"></span>agent <span class="lg l-action"></span>site action <span class="lg l-peer"></span>peer on another origin</p>`;
  }

  static compact(r) {
    if (!r) return null;
    return { target: r.target, base: r.base, verdict: r.verdict, count: r.count,
      checks: r.checks.map((c) => ({ id: c.id, section: c.section, status: c.status, title: c.title, detail: c.detail })),
      network: r.networks[0] || null, peers: App.peerReports.map((p) => ({ url: p.url, verdict: p.skipped ? "not contacted" : p.report.verdict })) };
  }

  static focusCheck(id) {
    const el = document.getElementById("chk-" + String(id).replace(/[^a-z0-9]/gi, "-"));
    if (!el) return { ok: false, reason: "No check with id " + id + " on the page." };
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.add("flash");
    setTimeout(() => el.classList.remove("flash"), 2400);
    return { ok: true, id };
  }

  static markdown(r) {
    const lines = [`# Doorframe report`, ``, `Target: ${r.base || r.target}`, `Verdict: ${r.verdict} (${App.summaryLine(r)})`, ``];
    for (const c of r.checks) lines.push(`- ${LABEL[c.status].toUpperCase()} [spec ${c.section}] ${c.title}: ${c.detail}`);
    lines.push("", "Checked with Doorframe, " + location.origin + location.pathname);
    return lines.join("\n");
  }

  static init() {
    $("#check-form").addEventListener("submit", (e) => { e.preventDefault(); App.runCheck($("#url").value); });
    for (const b of document.querySelectorAll("[data-sample]")) {
      b.addEventListener("click", () => {
        const v = b.dataset.sample === "self" ? new URL("./", location.href).href : b.dataset.sample;
        $("#url").value = v; App.runCheck(v);
      });
    }
    $("#paste-form").addEventListener("submit", (e) => { e.preventDefault(); App.runPasted(); });
    for (const t of document.querySelectorAll("[role=tab]")) {
      t.addEventListener("click", () => {
        for (const o of document.querySelectorAll("[role=tab]")) { o.setAttribute("aria-selected", o === t); $("#" + o.getAttribute("aria-controls")).hidden = o !== t; }
      });
    }
    $("#copy-md").addEventListener("click", async () => { if (App.last) { await navigator.clipboard.writeText(App.markdown(App.last)); App.status("Report copied as Markdown."); } });
    $("#dl-json").addEventListener("click", () => {
      if (!App.last) return;
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([JSON.stringify(App.last, null, 2)], { type: "application/json" }));
      a.download = "doorframe-report.json"; a.click();
    });
    $("#ask-desk").addEventListener("click", () => {
      const input = document.querySelector("#ns-input");
      document.querySelector("#desk").scrollIntoView({ behavior: "smooth" });
      if (input && App.last) { input.value = "Read the report on the page and tell me what to fix first, with the exact snippet."; input.focus(); }
    });
    $("#self-url").textContent = new URL("./doorframe_desk", location.href).href;
  }
}
