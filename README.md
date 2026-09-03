# Ardy

Status: Draft of the public repository's `README.md`, written 2026-09-03. Copy it to the root of the extracted repository and fill the placeholders. This draft itself stays internal.

---

Ardy is a browser application that generates human motion with a learned model on WebGPU and plays it on actors in a physical scene. A person and an agent share one timeline: prompt spans say what each actor does, a path says where it goes, bodies stand in its way, and camera cuts frame it. Through WebMCP, an agent reads the scene, changes what an actor does and where it goes, places bodies and cameras, controls playback, and captures a labeled contact sheet of the result.

Live application: `<LIVE URL>`  
Demo video: `<YOUTUBE URL>`  
Submission to the WebMCP Challenge, September 2026.

## What is new for the challenge

This project existed before August 25, 2026. Everything WebMCP was added during the submission period; the commit history in this repository carries the dates. The first commit after August 25 is the submission-period start.

| Date | Commit | Change |
| --- | --- | --- |
| 2026-08-29 | `<sha>` | WebMCP registration owner and the first tool set |
| 2026-08-31 | `<sha>` | The scene authored as composition data; editor edits admitted |
| 2026-09-01 | `<sha>` | Composition checkpoints and the temporal contact sheet capture |
| 2026-09-01 | `<sha>` | Camera timeline composition and its tools |
| 2026-09-02 | `<sha>` | Authored routes and per-actor scenarios; bodies as composition entities |
| 2026-09-02 | `<sha>` | `set_motion_span` |
| 2026-09-03 | `<sha>` | Replan on edit, `set_actor_path`, `set_body`, `remove_body`, `read_scene_summary`, agent authorship, readiness |
| 2026-09-03 | `<sha>` | Camera moves, the durable scene, the prompt library with `list_motion_prompts` and `encode_motion_prompt`, `read_scene_history` and the authorship trail, `newScene` |

The motion model runtime, the timeline substrate, and the engine existed before the period. They are licensed dependencies of this application, vendored under `vendor/`, and are not part of the open-source code here.

## The tools

All tools register from the top-level document with `document.modelContext.registerTool`; see `src/app/authoring/use-agent-tool.ts`. Each tool validates its input with an ArkType schema exported as JSON Schema, calls the same application operation the interface uses, and returns a compact structured result with the composition version.

| Tool | Kind | What it does |
| --- | --- | --- |
| `read_scene_readiness` | read | Whether the scene has opened, and the device's WebGPU support |
| `read_scene_summary` | read | Frame count, each actor's spans and route end, bodies, camera cuts, version |
| `read_scene_composition` | read | The full authored composition |
| `read_scene_at_frame` | read | What is active at one frame |
| `read_scene_window` | read | Items in a frame range |
| `read_scene_history` | read | Every authored transaction with its author (agent, editor, or the seed) and action |
| `list_motion_prompts` | read | The prompts an actor can be conditioned on, each with its route pace |
| `encode_motion_prompt` | edit | A new caption encoded by the exact text encoder and added to the library; it persists with the scene |
| `set_motion_span` | edit | One actor, one prompt, one frame range; the actor replans from the next window |
| `set_actor_path` | edit | One actor's path; its route is recomputed from its spans' paces |
| `set_body` / `remove_body` | edit | A loose or fixed box on an actor's route at a frame; it enters physics at once |
| `set_camera_timeline_item` / `remove_camera_timeline_item` | edit | Camera shots on the camera track; a shot with `to` moves to that view over its frames |
| `edit_scene_composition` | edit | Any canonical composition change, previewed and committed against the exact version |
| `undo_scene_composition` | edit | Undo or redo through the same durable history the person uses |
| `control_motion_scene` | control | Play, pause, seek, step, rate, restart, or start a new scene |
| `capture_motion_temporal_sheet` | read | A labeled contact sheet from the live renderer at exact frames |

Agent commits carry an author in their transaction identity, `agent/<tool>/<uuid>`, and the timeline header shows the last authored transactions live. The authored scene persists in the browser across reloads: a project catalog in SurrealDB WASM holds the scene document and the encoded prompts, and every open seeds a fresh Core Time run from it. Undo and the authorship trail span the page session.

## Try it

Open the live URL in Chrome 149 or later with WebMCP enabled at `chrome://flags/#enable-webmcp-testing`, or in ChatGPT's in-app browser with Site tools on and GPT-5.6 Sol or Terra selected. The scene needs WebGPU with `shader-f16`; the readiness tool reports both.

1. Wait for the model to load. The timeline and the read tools are available while it loads.
2. Ask the agent: "Read the scene."
3. Ask: "Have the second actor jog for four seconds and then kick." The timeline changes and the actor replans from the next window.
4. Ask: "Show me a contact sheet of the second actor around the kick."
5. Ask: "Undo that."

Chrome DevTools, Application panel, WebMCP pane, lists the tools and every call with its input and result.

## Run it yourself

Requirements: Node 22 or later, pnpm, a browser with WebGPU and `shader-f16`.

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

`encode_motion_prompt` needs the exact text encoder, which runs as a separate service on a GPU machine. Point the app at it with `ARDY_TEXT_ENCODER_URL` (and `ARDY_TEXT_ENCODER_AUTH` as `user:password` when the service requires a login); see `.env.example`. Without it the pinned prompts still work and the tool reports the encoder unreachable.

## License

The code in this repository is licensed under `<LICENSE>`; see `LICENSE`.

The packages under `vendor/` are proprietary and licensed only for use with this application; see the license file inside each tarball. The motion model derives from NVIDIA's ARDY, Apache-2.0, and the text encoder from McGill NLP's LLM2Vec, MIT; see `NOTICE`.
