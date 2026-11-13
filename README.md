# Doorframe

**Can other agents walk through your door?** Doorframe is an open agentic website that checks other open agentic websites against the [Minimum Viable Specification for a Worldwide Agentic Web](https://github.com/cognizant-ai-labs/agentic-web/blob/main/docs/worldwide_agentic_web_mvp_spec.md).

Live site: https://didrod205.github.io/doorframe/

Paste a site URL. Doorframe reads its `agent-manifest.json`, network definition and `links.json` the way a peer site would, runs about 25 checks that each cite a spec section, draws the agent network, and follows the site's peer links one hop to check those too. The checker is deterministic code and needs no LLM key. The site's own agent network (the "desk") then explains the report and writes fixes, using the visitor's own key.

## Who it is for

- **Challenge entrants.** Stage one of the Open Agentic Web Challenge is pass or fail on spec conformance. Doorframe tells you, check by check, before you submit.
- **Site owners adopting the spec.** A site can work for its own visitors and still be unreadable to every other agentic website. Doorframe reads it the way a peer would.
- **Other agents.** The desk is an open agent network that other agent networks can load as a peer to get a site checked and the fix written.

## Why

The challenge's first gate is spec conformance, and the official repository's Testing section still says "TODO Run the validation script". Builders need to know, before they submit, whether a peer on another origin can actually load their network. Some failures are invisible from your own origin: a site can work perfectly for its own visitors and still be unreadable to every other agentic website because its public files send no CORS header.

## What is in this site (spec mapping)

| Spec requirement | File |
| --- | --- |
| Public `.json` describing the agent network (3.3) | [`agent-manifest.json`](agent-manifest.json), [`doorframe_desk.network.json`](doorframe_desk.network.json) |
| Peer-network link map (3.3) | [`links.json`](links.json) binds the `spec_reference` link slot to a peer network on a second origin (jsDelivr) |
| Runtime that runs the network in the browser (3) | [`runtime/`](runtime/), the reference nsDeploy browser runtime copied unmodified from the challenge repository (Apache-2.0) |
| Interface to interact with the network | "Ask the desk" section, mounted by [`site.js`](site.js) |
| Interface to configure LLM and keys (4) | BYOK / router settings in the desk; keys stay in the browser |
| Grounded capability: registered site actions (3.1, 6) | [`site-actions.js`](site-actions.js): `run_conformance_check`, `get_last_report`, `focus_check` |
| Second-origin peer network (3.2, 6) | [`peer/`](peer/), served from `cdn.jsdelivr.net`, loaded only after the visitor approves the origin |

Network: `checkup_desk` (front) delegates to `conformance_auditor` (calls the site actions), `fix_writer`, and the `spec_reference` peer network.

The site checks itself: open the live site and press "This site".

## Checks

Every check names its spec section: HTTPS (3.2), public manifest, network and links (3.3), cross-origin readability (3.3, 3.4), manifest fields `name`, `front_man`, `hocon`, router metadata and peer policy (3.3), exact peer-name match (3.2), parse and full resolution (2), the reference runtime's own structural validator (3.1), unique agent names, real front agent, descriptions, input schemas, instructions, tools lists and resolvable references (2.1), credential-shaped strings in public files (4), two-agent delegation and a grounded capability (6).

In the browser, a cross-origin read that fails is retried as an opaque request: if the server answered, Doorframe reports "no CORS header" instead of "site down". The CLI reads the `Access-Control-Allow-Origin` header directly.

A result is a technical reading of public files, not an official judgment of the challenge.

## CLI

```
node cli/doorframe.mjs https://your-site.example/agents/
node cli/doorframe.mjs https://your-site.example/agents/ --json
```

Exit code 1 when any check fails, so it can run in CI. Node 22 or newer, no dependencies.

## Call the desk from your own network

Add a link slot and bind it in your `links.json`:

```json
{ "version": 1, "networks": { "your_network": { "conformance_desk": "https://didrod205.github.io/doorframe/doorframe_desk" } } }
```

## Tests

`node test/check-core.test.mjs` runs offline checks (a good network passes; a missing reference, missing router, wrong front agent, leaked key and broken JSON all fail). GitHub Actions runs them before every Pages deploy.

## Built with Claude

This project was planned, coded and written by Claude, an AI agent (Anthropic), working for the entrant. The `runtime/` folder is the reference runtime from [cognizant-ai-labs/agentic-web](https://github.com/cognizant-ai-labs/agentic-web) (Apache-2.0), used unmodified.

## License

Apache-2.0
