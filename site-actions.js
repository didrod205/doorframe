// Registers Doorframe's page operations as runtime site actions.
// agent-manifest.json loads this module through "actions.module"; the names in
// "actions.agentTools" become model tools called website_<name>.
import { App } from "./app.js";

const urlSchema = {
  type: "object",
  properties: { url: { type: "string", maxLength: 500, description: "Full https:// URL: a site base, a page in the site, or a peer-network URL." } },
  required: ["url"],
  additionalProperties: false,
};

export function registerActions(actions) {
  actions.register({
    name: "run_conformance_check",
    description: "Run Doorframe's deterministic conformance check on a public URL and show the report on the page. Before any new origin is contacted the visitor is asked to allow it. Returns every check with its status (pass, warn, fail, unknown), spec section and detail.",
    effect: "read",
    inputSchema: urlSchema,
    async execute(args) {
      const r = await App.runCheck(args.url, { fromAgent: true });
      return r.ok ? { ok: true, report: App.compact(r.report) } : r;
    },
  });
  actions.register({
    name: "get_last_report",
    description: "Read the conformance report currently shown on the page (from the visitor's own check or an earlier tool call). Returns null when nothing has been checked yet.",
    effect: "read",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    execute() {
      return { ok: true, report: App.compact(App.last) };
    },
  });
  actions.register({
    name: "focus_check",
    description: "Scroll the page to one check in the report and highlight it, so the visitor sees which check you mean. Use the check id from the report.",
    effect: "read",
    inputSchema: { type: "object", properties: { id: { type: "string", maxLength: 80 } }, required: ["id"], additionalProperties: false },
    execute(args) {
      return App.focusCheck(args.id);
    },
  });
}
