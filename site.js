// Boots the page and mounts the reference browser runtime (runtime/, Apache-2.0)
// in the "Ask the desk" section. The checker works without the runtime or a key.
import { App } from "./app.js";

App.init();

const status = document.querySelector("#assistant-status");
try {
  const siteBase = new URL("./", import.meta.url).href;
  const { boot } = await import("./runtime/index.js");
  const booted = await boot("#agent-app", {
    originUrl: siteBase,
    sandboxWorkerUrl: new URL("runtime/sandbox-worker.js", siteBase).href,
  });
  const engine = booted.engine;
  const needsKey = !engine.mockLLM && (!engine.byokKey || engine.byokKey === "demo");
  status.textContent = needsKey
    ? "The desk is loaded but has no LLM key yet. Add your own key in the settings below: it stays in this browser and goes only to the router you choose. The checker above needs no key."
    : "The desk is connected to this page. Try: \u201cCheck the official guesthouse example and tell me what to fix first.\u201d";
  window.doorframeEngine = engine;
} catch (error) {
  status.textContent = "The desk could not load. The checker above still works without it.";
  console.error("Runtime boot failed", error);
}
