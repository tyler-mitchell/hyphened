# Ardy

Ardy is a browser application that generates human motion with a learned model on WebGPU and plays it on actors in a physical scene. A person and an agent share one timeline: prompt spans say what each actor does, a path says where it goes, bodies stand in its way, and camera cuts frame it. Through WebMCP, an agent reads the scene, writes a whole story, changes what an actor does and where it goes, adds and removes actors, places bodies and cameras, controls playback, and captures a labeled contact sheet of the result.

Live application: `<LIVE URL>`  
Demo video: `<YOUTUBE URL>`  
Submission to the WebMCP Challenge, September 2026.

## What is new for the challenge

This project existed before August 25, 2026. Everything WebMCP was added during the submission period; the commit history in this repository carries the dates. The first commit after August 25 is the submission-period start.

| Date | Commit | Change |
| --- | --- | --- |
| 2026-08-29 | `ba654d1` | WebMCP registration owner and the first tool set |
| 2026-08-31 | `2967f50` | The scene authored as composition data |
| 2026-08-31 | `c6198de` | Travel pace per prompt span; editor edits admitted through the same boundary |
| 2026-09-01 | `432999a` | Composition checkpoints and the temporal contact sheet capture |
| 2026-09-01 | `e932efb` | Camera timeline composition and its tools |
| 2026-09-02 | `c290ef4` | `set_motion_span`: one actor's prompt over a frame range on the generation grid |
| 2026-09-02 | `f730549` | One prompt library owns validity, identity, and pace; `list_motion_prompts` |
| 2026-09-02 | `f956900` | The durable scene: a project catalog in SurrealDB WASM, a journal for the run |
| 2026-09-02 | `21628f3` | `encode_motion_prompt` against the exact text encoder, rows persisted with the scene |
| 2026-09-02 | `73c12d5` | `read_scene_history` from the journal's transactions, and the live authorship trail |
| 2026-09-02 | `eabb488` | The agent authoring loop: replan on a span edit, actor paths, live bodies, scene summary |
| 2026-09-02 | `1064d8e` | Camera moves, and the WebMCP polyfill so in-page agents can list and execute tools |
| 2026-09-03 | `26214c9` | Tool schemas register; the scene opens from the catalog document |
| 2026-09-03 | `5edc604` | The in-page agent panel, for a judge whose browser has no WebMCP client |
| 2026-09-03 | `4517cad` | A tool result is bounded before it enters the agent's history |
| 2026-09-03 | `b64a1b7` | The address drives the scene; the story picker navigates |
| 2026-09-03 | `7aca538` | The agent panel reaches the browsers that cannot run the scene |

This application is developed in a private monorepo alongside its engine, so some later
application changes arrive here inside a `refresh:` or `sync:` commit rather than as their own.
Those commits carry the same dates and the same code; `git log --since=2026-08-25` lists every
one of them.

The timeline substrate and the engine existed before the period. They are licensed dependencies of this application, vendored under `vendor/`, and are not part of the open-source code here.

## The tools

All tools register from the top-level document with `document.modelContext.registerTool`; see `src/app/authoring/use-agent-tool.ts`. Each tool validates its input with an ArkType schema exported as JSON Schema, calls the same application operation the interface uses, and returns a compact structured result with the composition version.

| Tool | Kind | What it does |
| --- | --- | --- |
| `read_scene_readiness` | read | Whether the scene has opened, and the device's WebGPU support |
| `read_scene_summary` | read | Frame count, each actor's origin, spans, and route end, bodies, camera cuts, free actor rows, the transport, the built-in stories in the shape `author_scene` takes, version |
| `read_scene_composition` | read | The full authored composition |
| `read_scene_at_frame` | read | What is active at one frame |
| `read_scene_window` | read | Items in a frame range |
| `read_scene_history` | read | Every authored transaction with its author (agent, editor, or the seed) and action |
| `list_motion_prompts` | read | The prompt library by facet: with no filter it returns the counts per category, posture stance, and tag; with a filter or `all` it returns the matching prompts with pace, tags, category, laterality, and posture |
| `author_scene` | edit | A whole scene from a story: each actor's origin, path, and beats, and the coverage as preset shots; it opens in place as a new scene |
| `encode_motion_prompt` | edit | A new caption encoded by the exact text encoder and added to the library; it persists with the scene |
| `add_actor` / `remove_actor` | edit | An actor joins the running scene on a spare row with its origin, path, and beats, or leaves it at once |
| `set_motion_span` | edit | One actor, one prompt, one frame range; the actor replans from the next window |
| `set_actor_path` | edit | One actor's path; its route is recomputed from its spans' paces |
| `set_body` / `remove_body` | edit | A loose or fixed box on an actor's route at a frame; it enters physics at once |
| `set_camera_timeline_item` / `remove_camera_timeline_item` | edit | Camera shots: a named preset (establishing, tracking, follow, close-up, low-angle, crane, reveal, hero) framed off one actor's direction of travel with its own lens and move, or an explicit orbit or look-at view with `to` for an eased move and `focalLength` in millimetres |
| `edit_scene_composition` | edit | Any canonical composition change, previewed and committed against the exact version |
| `undo_scene_composition` | edit | Undo or redo through the same durable history the person uses |
| `control_motion_scene` | control | Play, pause, seek, step, rate, restart, or start a new scene on a built-in story (The Victor, The Reunion, Dance-Off) |
| `capture_motion_temporal_sheet` | read | A labeled contact sheet from the live renderer at exact frames |

The page also carries its own agent panel, so a judge whose browser has no WebMCP client still reaches this surface. It reads the registered tools from the same context and calls the same `execute` functions; it is another caller of the product's tools, not a second path to them.

Agent commits carry an author in their transaction identity, `agent/<tool>/<uuid>`, and the timeline header shows the last authored transactions live. The authored scene persists in the browser across reloads: a project catalog in SurrealDB WASM holds the scene document and the encoded prompts, and every open seeds a fresh Core Time run from it. Undo and the authorship trail span the page session.

## Try it

Open the live URL in any desktop browser with WebGPU and `shader-f16`, which desktop Chrome has. The page tells you if something is missing, and the agent panel opens either way, so you can ask it what your browser lacks.

There are two ways to reach the tools, and you do not have to configure anything for the first.

**The agent panel, no setup.** Press the robot button at the top right. The panel runs a model against the page's own registered tools and shows every call with its input and result. Bring your own Anthropic or OpenAI key; it stays in your browser, is used for that one request, and is never stored by this site.

**Your own WebMCP client.** Chrome 149 or later with `chrome://flags/#enable-webmcp-testing` enabled, or ChatGPT's in-app browser with Site tools on. The page's tools then appear to your own agent, and Chrome DevTools, Application panel, WebMCP pane lists them and records every call.

1. Wait for the model to load; it streams about 380 MB and shows its progress. The timeline and the read tools work while it loads. The scene opens on The Victor: two actors face each other, a charge, a punch, a collapse, a victory, seven cuts.
2. Ask the agent: "Read the scene."
3. Ask: "Cover the collapse with a crane shot on the second actor." The camera track changes and the stage cuts to it.
4. Ask: "Show me a contact sheet of the second actor around the collapse." The sheet is captured from the live renderer at those exact frames and renders as an image, in a WebMCP client and in the panel alike. The agent receives the capture receipt rather than the image bytes, so it can say what it captured without spending its context on pixels.
5. Ask: "Write a new scene: one actor walks in, bows, dances, and salutes, with a close-up on the bow." The agent calls `author_scene` and the scene opens on it.
6. Ask: "Undo that."

Every change an agent makes is a versioned transaction in the same history the person edits, and the timeline shows the last authored transactions live.

## Run it yourself

Requirements: Node 24 (see `.node-version`), pnpm 11.8, a browser with WebGPU and `shader-f16`.

```sh
pnpm install
```

The motion model is not in this repository. Download the f16 runtime profile (seven files, about 380 MB) from `<MODEL URL>` into `.data/models/runtime/webgpu-f16/`, or set `ARDY_MODEL_ROOT` to a directory that contains `runtime/webgpu-f16/`.

```sh
pnpm dev
```

The development server runs at `http://127.0.0.1:5193`. For a production build:

```sh
pnpm build
node .output/server/index.mjs
```

This is a TanStack Start application; the server output is a Nitro Node server and deploys to any host with a Node runtime.

`encode_motion_prompt` needs the exact text encoder, which runs as a separate service on a GPU machine. Point the app at it with `ARDY_TEXT_ENCODER_URL` (and `ARDY_TEXT_ENCODER_AUTH` as `user:password` when the service requires a login). Without it the library prompts still work and the tool reports the encoder unreachable.

## License

The code in this repository is licensed under the GNU Affero General Public License, version 3; see `LICENSE`.

The packages under `vendor/` are proprietary and licensed only for use with this application; see the license file inside each tarball. The motion model derives from NVIDIA's ARDY, Apache-2.0, and the text encoder from McGill NLP's LLM2Vec, MIT; see `NOTICE`.
