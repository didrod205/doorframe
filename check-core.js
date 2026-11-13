// Doorframe check core: one module for the browser page and the Node CLI.
// Every check cites the section of the Minimum Viable Specification for a
// Worldwide Agentic Web that it tests:
// https://github.com/cognizant-ai-labs/agentic-web/blob/main/docs/worldwide_agentic_web_mvp_spec.md
// Structural network validation reuses the reference runtime's own validator
// (runtime/kernel.js, Apache-2.0), so a "pass" here means the same thing as
// "the reference runtime would load it".
import { AgentNetwork, validateNetwork } from "./runtime/kernel.js";
import { parseHocon } from "./runtime/hocon.js";

export const SPEC_URL = "https://github.com/cognizant-ai-labs/agentic-web/blob/main/docs/worldwide_agentic_web_mvp_spec.md";
const SECTION_ANCHORS = {
  "2.1": "#21-minimum-network-content",
  "3.1": "#31-minimum-runtime-behavior",
  "3.2": "#32-protocol-for-loading-a-peer-agent-site",
  "3.3": "#33-minimum-public-files",
  "3.4": "#34-browser-origin-requirements",
  "4": "#4-tenet-three-pluggable-inference",
};
export function specLink(section) {
  return SPEC_URL + (SECTION_ANCHORS[section] || "");
}

// Patterns that look like live credentials. Published files are public (spec 4, 5).
const SECRET_PATTERNS = [
  { label: "OpenAI style key", re: /\bsk-[A-Za-z0-9_-]{20,}/ },
  { label: "Anthropic style key", re: /\bsk-ant-[A-Za-z0-9_-]{20,}/ },
  { label: "Google API key", re: /\bAIza[0-9A-Za-z_-]{30,}/ },
  { label: "GitHub token", re: /\bgh[pousr]_[A-Za-z0-9]{30,}/ },
  { label: "Bearer header value", re: /Bearer\s+[A-Za-z0-9._-]{24,}/ },
];

/** Work out where the manifest should live for a URL a person pastes. */
export function candidateBases(input) {
  const url = new URL(input.trim());
  const out = [];
  const path = url.pathname;
  const last = path.split("/").pop();
  if (last === "agent-manifest.json") {
    out.push({ base: new URL("./", url).href, network: null, form: "manifest URL" });
    return out;
  }
  if (path.endsWith("/")) {
    out.push({ base: url.origin + path, network: null, form: "site base" });
  } else if (/\.[a-z0-9]+$/i.test(last)) {
    out.push({ base: new URL("./", url).href, network: null, form: "page in site" });
  } else {
    // Spec 3.2: final path component is the network name, the rest is the site base.
    out.push({ base: new URL("./", url).href, network: last, form: "peer-network URL" });
    out.push({ base: url.origin + path + "/", network: null, form: "site base without trailing slash" });
  }
  return out;
}

/** Fetch text with no credentials and say exactly what happened. */
async function probe(url, env) {
  const result = { url, ok: false, status: null, text: null, cors: "unknown", error: null };
  try {
    const resp = await env.fetch(url, { credentials: "omit", cache: "no-store", mode: "cors" });
    result.status = resp.status;
    result.ok = resp.ok;
    if (env.isNode) {
      const acao = resp.headers.get("access-control-allow-origin");
      result.cors = acao ? (acao === "*" ? "open" : "restricted:" + acao) : "missing";
    } else {
      result.cors = env.sameOrigin(url) ? "same-origin" : "open";
    }
    if (resp.ok) result.text = await resp.text();
  } catch (err) {
    result.error = String(err && err.message || err);
    if (!env.isNode) {
      // A CORS refusal and a dead host look the same to fetch(). An opaque
      // no-cors request tells them apart: it only succeeds if the server answered.
      try {
        await env.fetch(url, { mode: "no-cors", credentials: "omit", cache: "no-store" });
        result.cors = "missing";
      } catch {
        result.cors = "unreachable";
      }
    }
  }
  return result;
}

function parseJsonOrHocon(text) {
  try {
    return { value: JSON.parse(text), format: "JSON" };
  } catch {
    try {
      return { value: parseHocon(text), format: "HOCON" };
    } catch (err) {
      return { error: String(err.message || err) };
    }
  }
}

function add(report, id, section, status, title, detail, evidence) {
  report.checks.push({ id, section, status, title, detail, evidence: evidence || null, spec: specLink(section) });
}

/**
 * Check a site that is already in memory (pasted files). Same rules as a live check
 * except the hosting checks, which need a real host.
 */
export function checkDocuments({ manifestText, networkText, linksText }, opts = {}) {
  const report = newReport(opts.label || "pasted files");
  report.mode = "pasted";
  checkManifestAndNetworks(report, manifestText, async () => null, opts);
  return finishWith(report, networkText, linksText);
}

function newReport(target) {
  return { target, startedAt: new Date().toISOString(), checks: [], networks: [], graph: null, base: null, mode: "live" };
}

function finishWith(report, networkText, linksText) {
  const entry = report._entries && report._entries[0];
  if (entry && networkText != null) {
    analyseNetwork(report, entry, networkText, linksText);
  }
  return summarize(report);
}

function checkManifestAndNetworks(report, manifestText, _fetcher, opts) {
  const parsed = manifestText == null ? null : parseJsonOrHocon(manifestText);
  if (!parsed || parsed.error || typeof parsed.value !== "object") {
    add(report, "manifest.json", "3.3", "fail", "agent-manifest.json is valid JSON",
      parsed && parsed.error ? "It does not parse: " + parsed.error : "No manifest text.");
    report._entries = [];
    return null;
  }
  const m = parsed.value;
  report.manifest = m;
  add(report, "manifest.json", "3.3", "pass", "agent-manifest.json is valid JSON", "Parsed as " + parsed.format + ".");
  const nets = Array.isArray(m.networks) ? m.networks : [];
  if (!nets.length) {
    add(report, "manifest.networks", "3.3", "fail", "Manifest lists at least one network",
      "The manifest has no networks array, so no runtime can find an agent network here.");
  } else {
    const missing = [];
    for (const n of nets) {
      for (const f of ["name", "front_man", "hocon"]) {
        if (!n || typeof n[f] !== "string" || !n[f].trim()) missing.push((n && n.name || "?") + "." + f);
      }
    }
    add(report, "manifest.networks", "3.3", missing.length ? "fail" : "pass",
      "Each network has name, front_man and hocon",
      missing.length ? "Missing: " + missing.join(", ") : nets.length + " network(s): " + nets.map(n => n.name).join(", "));
  }
  const router = m.llm_router;
  add(report, "manifest.router", "3.3", router && typeof router === "object" ? "pass" : "fail",
    "Manifest declares top-site LLM router metadata",
    router ? "llm_router.base_url = " + (router.base_url || "(empty)") + (router.mock ? " (mock)" : "")
      : "No llm_router object. Spec 3.3 requires top-site LLM router metadata.");
  const hasPolicy = (m.peer_policy && typeof m.peer_policy === "object") || Array.isArray(m.allowed_peers);
  add(report, "manifest.peer_policy", "3.3", hasPolicy ? "pass" : "fail", "Manifest declares a peer policy",
    hasPolicy ? "peer_policy.mode = " + (m.peer_policy && m.peer_policy.mode || "(allowed_peers list)")
      : "No peer_policy or allowed_peers. Spec 3.3 requires peer policy in the manifest.");
  scanSecrets(report, "agent-manifest.json", manifestText);
  report._entries = nets.filter(n => n && n.hocon);
  if (opts.network) {
    const exact = nets.find(n => n && n.name === opts.network);
    add(report, "peer.exact_name", "3.2", exact ? "pass" : "fail", "Peer-network URL names an exact manifest entry",
      exact ? "Found network '" + opts.network + "'."
        : "No network named '" + opts.network + "'. Spec 3.2: a runtime MUST fail rather than pick another network.");
    if (exact) report._entries = [exact, ...report._entries.filter(n => n !== exact)];
  }
  return m;
}

function scanSecrets(report, file, text) {
  if (!text) return;
  const hits = SECRET_PATTERNS.filter(p => p.re.test(text)).map(p => p.label);
  add(report, "secrets." + file, "4", hits.length ? "fail" : "pass", "No credentials in " + file,
    hits.length ? "Looks like a live credential (" + hits.join(", ") + "). Published files are public; keys must never appear in manifests or networks."
      : "No key-shaped strings found.");
}

function analyseNetwork(report, entry, text, linksText) {
  const parsed = parseJsonOrHocon(text);
  if (parsed.error || !parsed.value || typeof parsed.value !== "object") {
    add(report, "network.parse", "2", "fail", "Network definition parses", parsed.error || "Not an object.");
    return;
  }
  const config = parsed.value;
  add(report, "network.parse", "2", "pass", "Network definition parses", "'" + entry.name + "' parsed as " + parsed.format + ".");
  scanSecrets(report, entry.hocon.split("/").pop(), text);
  const unresolved = /\$\{[^}]+\}|(^|\n)\s*include\s+"/.test(text);
  add(report, "network.resolved", "2", unresolved ? "fail" : "pass", "Published network is fully resolved",
    unresolved ? "Found ${...} substitutions or include lines. Spec 2: the published form must not depend on includes or substitutions."
      : "No includes or substitutions left.");

  let links = {};
  if (linksText != null) {
    const lp = parseJsonOrHocon(linksText);
    if (lp.error || typeof lp.value !== "object") {
      add(report, "links.json", "3.3", "fail", "links.json is valid", "It does not parse: " + (lp.error || "not an object"));
    } else {
      const okShape = lp.value.networks && typeof lp.value.networks === "object";
      links = okShape && lp.value.networks[entry.name] || {};
      add(report, "links.json", "3.3", okShape ? "pass" : "warn", "links.json is a peer-network link map",
        okShape ? Object.keys(links).length + " published binding(s) for '" + entry.name + "'." : "No 'networks' object, so no bindings can resolve.");
      const bad = Object.entries(links).filter(([, u]) => typeof u !== "string" || !/^https?:\/\//.test(u) && !u.startsWith("/"));
      if (bad.length) add(report, "links.urls", "3.3", "fail", "Link bindings are URLs", "Not URLs: " + bad.map(b => b[0]).join(", "));
    }
  }
  config.links = { ...(config.links || {}), ...links };

  let net = null;
  try {
    net = new AgentNetwork(config, entry.name);
    const v = validateNetwork(net);
    add(report, "network.reference_validator", "3.1", v.errors.length ? "fail" : "pass",
      "Reference runtime validator accepts the network",
      v.errors.length ? v.errors.slice(0, 6).join(" ") : "No structural errors (front agent, references, shape)." + (v.warnings.length ? " Warnings: " + v.warnings.join(" ") : ""));
  } catch (err) {
    add(report, "network.reference_validator", "3.1", "fail", "Reference runtime validator accepts the network", String(err.message || err));
  }

  const agents = Array.isArray(config.tools) ? config.tools : [];
  const names = agents.map(a => a && a.name);
  const dupes = names.filter((n, i) => names.indexOf(n) !== i);
  add(report, "agents.unique", "2.1", dupes.length ? "fail" : "pass", "Agent names are unique",
    dupes.length ? "Duplicated: " + [...new Set(dupes)].join(", ") : agents.length + " agent(s).");
  const front = entry.front_man;
  add(report, "agents.front", "2.1", names.includes(front) ? "pass" : "fail", "front_man names a real agent",
    names.includes(front) ? "Front agent: " + front : "'" + front + "' is not defined in the network.");
  const desc = (config.metadata && config.metadata.description) || entry.description;
  add(report, "network.metadata", "2.1", desc ? "pass" : "warn", "Network has a short description",
    desc ? String(desc).slice(0, 140) : "No metadata.description or manifest description.");

  const noDesc = [], noSchema = [], noInstr = [], noTools = [];
  const slots = new Set(Object.keys(config.link_slots || {}));
  const edges = [], peers = [];
  for (const a of agents) {
    if (!a || typeof a !== "object") continue;
    const fn = a.function || {};
    if (!fn.description) noDesc.push(a.name);
    const p = fn.parameters;
    const schemaOk = p == null ? a.name === front : (typeof p === "object" && (p.type === "object" || p.properties));
    if (!schemaOk) noSchema.push(a.name);
    const usesLlm = !a.class && !a.toolbox;
    if (usesLlm && !a.instructions && !config.instructions_prefix) noInstr.push(a.name);
    if (!Array.isArray(a.tools) && usesLlm) noTools.push(a.name);
    for (const ref of a.tools || []) {
      if (typeof ref !== "string") { edges.push({ from: a.name, to: "MCP", kind: "mcp" }); continue; }
      if (names.includes(ref)) edges.push({ from: a.name, to: ref, kind: "agent" });
      else if (/^https?:\/\//.test(ref) || ref.startsWith("/")) { edges.push({ from: a.name, to: ref, kind: "peer" }); peers.push(ref); }
      else if (config.links[ref]) { edges.push({ from: a.name, to: ref, kind: "peer", url: config.links[ref] }); peers.push(config.links[ref]); }
      else if (slots.has(ref)) edges.push({ from: a.name, to: ref, kind: "slot" });
      else edges.push({ from: a.name, to: ref, kind: "missing" });
    }
  }
  add(report, "agents.descriptions", "2.1", noDesc.length ? "fail" : "pass", "Every agent has a function description",
    noDesc.length ? "Missing on: " + noDesc.join(", ") : "All agents describe what they do.");
  add(report, "agents.schemas", "2.1", noSchema.length ? "warn" : "pass", "Callable agents expose JSON Schema inputs",
    noSchema.length ? "No object schema on: " + noSchema.join(", ") + ". Callers cannot see what to send." : "Every callable agent has an object schema.");
  add(report, "agents.instructions", "2.1", noInstr.length ? "fail" : "pass", "LLM agents have instructions",
    noInstr.length ? "Missing on: " + noInstr.join(", ") : "All LLM agents have instructions.");
  add(report, "agents.tools_list", "2.1", noTools.length ? "warn" : "pass", "Agents list what they may call",
    noTools.length ? "No tools list on: " + noTools.join(", ") + " (an empty list declares no downstream references)." : "Every agent declares its tools list.");
  const missingRefs = edges.filter(e => e.kind === "missing").map(e => e.from + " -> " + e.to);
  add(report, "agents.references", "2.1", missingRefs.length ? "fail" : "pass", "Every tool reference resolves",
    missingRefs.length ? "Unresolved: " + missingRefs.join(", ") : "Local agents, link slots and peer URLs all resolve.");

  const twoAgents = agents.length >= 2 && edges.some(e => e.kind === "agent");
  add(report, "interop.two_agents", "6", twoAgents ? "pass" : "warn", "Network delegates between at least two agents",
    twoAgents ? "Internal delegation found." : "Spec 6 interoperability checks start from a two-agent network.");
  const actions = report.manifest && report.manifest.actions;
  const grounded = (actions && Array.isArray(actions.agentTools) && actions.agentTools.length) || edges.some(e => e.kind === "mcp");
  add(report, "interop.grounded", "6", grounded ? "pass" : "warn", "Network has a grounded capability (site action or MCP)",
    grounded ? (actions && actions.agentTools ? "Site actions: " + actions.agentTools.join(", ") : "MCP tool reference found.")
      : "No registered site actions or MCP tools. Spec 6 asks for at least one grounded capability.");

  report.networks.push({ name: entry.name, front, agents: names });
  report.graph = { front, agents: agents.map(a => ({ name: a.name, description: (a.function && a.function.description) || "" })), edges,
    actions: actions && actions.agentTools || [] };
  report.peers = [...new Set(peers)];
}

function summarize(report) {
  const count = { pass: 0, warn: 0, fail: 0, unknown: 0 };
  for (const c of report.checks) count[c.status] = (count[c.status] || 0) + 1;
  report.count = count;
  report.verdict = count.fail ? "fail" : count.unknown ? "incomplete" : count.warn ? "pass-with-warnings" : "pass";
  report.finishedAt = new Date().toISOString();
  delete report._entries;
  return report;
}

/** Live check of a public URL. env: { fetch, isNode, sameOrigin(url) } */
export async function checkSite(input, env) {
  const report = newReport(input);
  let url;
  try {
    url = new URL(input.trim());
  } catch {
    add(report, "input.url", "3.2", "fail", "Input is a URL", "Paste a full https:// address.");
    return summarize(report);
  }
  const local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(url.hostname);
  add(report, "hosting.https", "3.2", url.protocol === "https:" || local ? "pass" : "fail", "Served over HTTPS",
    url.protocol === "https:" ? "HTTPS." : local ? "Loopback HTTP is allowed for local development only." : "Production sites must use HTTPS.");

  let found = null;
  const tried = [];
  for (const cand of candidateBases(input)) {
    const murl = new URL("agent-manifest.json", cand.base).href;
    const res = await probe(murl, env);
    tried.push({ ...cand, url: murl, res });
    if (res.ok) { found = { ...cand, murl, res }; break; }
  }
  if (!found) {
    const r = tried[0].res;
    const blocked = tried.some(t => t.res.cors === "missing");
    add(report, "hosting.manifest_get", "3.3", blocked ? "unknown" : "fail", "agent-manifest.json is publicly readable",
      blocked ? "The server answered but does not allow cross-origin reads, so this browser (and any peer site) cannot read it. Run the CLI or paste the files to check the rest. Tried: " + tried.map(t => t.url).join(", ")
        : "Not found at: " + tried.map(t => t.url + " (" + (t.res.status || t.res.error || "no answer") + ")").join(", "),
      { tried: tried.map(t => ({ url: t.url, status: t.res.status, cors: t.res.cors })) });
    if (blocked) add(report, "hosting.cors_manifest", "3.4", "warn", "Other agentic websites can load the manifest (CORS)",
      "Spec 3.3 asks for CORS enabled for callers; spec 3.4 lets a same-origin bundle skip it, but then no peer can load you. Fix: send Access-Control-Allow-Origin: * on public agent files. Tip: paste the files into 'Check pasted files' to test the rest.");
    return summarize(report);
  }
  report.base = found.base;
  add(report, "hosting.manifest_get", "3.3", "pass", "agent-manifest.json is publicly readable", found.murl + " (HTTP " + found.res.status + ", read as " + found.form + ")");
  corsCheck(report, "hosting.cors_manifest", "Other agentic websites can load the manifest (CORS)", found.res);

  checkManifestAndNetworks(report, found.res.text, null, { network: found.network });
  const entries = report._entries || [];
  if (!entries.length) return summarize(report);
  const entry = entries[0];
  const nurl = new URL(entry.hocon, found.base).href;
  const nres = await probe(nurl, env);
  add(report, "hosting.network_get", "3.3", nres.ok ? "pass" : "fail", "Network definition is publicly readable",
    nres.ok ? nurl + " (HTTP " + nres.status + ")" : nurl + " could not be read (" + (nres.status || nres.error) + ")" + (nres.cors === "missing" ? ": no CORS header." : "."));
  if (nres.ok) corsCheck(report, "hosting.cors_network", "Other agentic websites can load the network (CORS)", nres);
  const lurl = new URL("links.json", found.base).href;
  const lres = await probe(lurl, env);
  add(report, "hosting.links_get", "3.3", lres.ok ? "pass" : "warn", "links.json is published",
    lres.ok ? lurl + " (HTTP " + lres.status + ")" : "No links.json at " + lurl + ". Needed only when the network uses named peer links.");
  if (nres.ok) analyseNetwork(report, entry, nres.text, lres.ok ? lres.text : null);
  report._entries = null;
  return summarize(report);
}

function corsCheck(report, id, title, res) {
  if (res.cors === "open" || res.cors === "same-origin") {
    add(report, id, "3.4", "pass", title, res.cors === "same-origin" ? "Same origin as this checker, so CORS is not needed for this read. Check from another origin (CLI) to be sure." : "Readable from another origin.");
  } else if (res.cors && res.cors.startsWith("restricted:")) {
    add(report, id, "3.4", "warn", title, "Only " + res.cors.slice(11) + " may read it. Peers on other origins cannot load it.");
  } else if (res.cors === "missing") {
    add(report, id, "3.4", "warn", title, "No Access-Control-Allow-Origin header. Your own page still works, but agentic websites on other origins cannot load this network (spec 3.3 asks for CORS enabled for callers).");
  } else {
    add(report, id, "3.4", "unknown", title, "Could not determine.");
  }
}
