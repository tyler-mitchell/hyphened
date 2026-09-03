# Ardy

Ardy is a browser application that generates human motion with a learned model on WebGPU and plays it on actors in a physical scene. A person and an agent share one timeline: prompt spans say what each actor does, a path says where it goes, bodies stand in its way, and camera cuts frame it. Through WebMCP, an agent reads the scene, writes a whole story, changes what an actor does and where it goes, adds and removes actors, places bodies and cameras, controls playback, and captures a labeled contact sheet of the result.

Live application: `<LIVE URL>`  
Demo video: `<YOUTUBE URL>`  
Submission to the WebMCP Challenge, September 2026.

## What is new for the challenge

This project existed before August 25, 2026. Everything WebMCP was added during the submission period; the commit history in this repository carries the dates. The first commit after August 25 is the submission-period start.

| Date | Change |
| --- | --- |
| 2026-08-29 | WebMCP registration owner and the first tool set |
| 2026-08-31 | The scene authored as composition data; editor edits admitted |
| 2026-09-01 | Composition checkpoints and the temporal contact sheet capture |
| 2026-09-01 | Camera timeline composition and its tools |
| 2026-09-02 | Authored routes and per-actor scenarios; bodies as composition entities |
| 2026-09-02 | `set_motion_span` |
| 2026-09-03 | Replan on edit, `set_actor_path`, `set_body`, `remove_body`, `read_scene_summary`, agent authorship, readiness |
| 2026-09-03 | Camera moves, the durable scene, the prompt library with `list_motion_prompts` and `encode_motion_prompt`, `read_scene_history`, `newScene` |
| 2026-09-03 | Stories as data with `author_scene`, cinematography presets with real lenses, `add_actor` and `remove_actor`, the motion library of 75 captions |

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

Agent commits carry an author in their transaction identity, `agent/<tool>/<uuid>`, and the timeline header shows the last authored transactions live. The authored scene persists in the browser across reloads: a project catalog in SurrealDB WASM holds the scene document and the encoded prompts, and every open seeds a fresh Core Time run from it. Undo and the authorship trail span the page session.

## Try it

Open the live URL in Chrome 149 or later with WebMCP enabled at `chrome://flags/#enable-webmcp-testing`, or in ChatGPT's in-app browser with Site tools on. The scene needs WebGPU with `shader-f16`; the readiness tool reports both.

1. Wait for the model to load. The timeline and the read tools are available while it loads. The scene opens on The Victor: two actors face each other, a charge, a punch, a collapse, a victory, seven cuts.
2. Ask the agent: "Read the scene."
3. Ask: "Cover the collapse with a crane shot on the second actor." The camera track changes and the stage cuts to it.
4. Ask: "Show me a contact sheet of the second actor around the collapse."
5. Ask: "Write a new scene: one actor walks in, bows, dances, and salutes, with a close-up on the bow." The agent calls `author_scene` and the scene opens on it.
6. Ask: "Undo that."

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

`encode_motion_prompt` needs the exact text encoder, which runs as a separate service on a GPU machine. Point the app at it with `ARDY_TEXT_ENCODER_URL` (and `ARDY_TEXT_ENCODER_AUTH` as `user:password` when the service requires a login). Without it the library prompts still work and the tool reports the encoder unreachable.

## License

The code in this repository is licensed under the terms in `LICENSE`.

The packages under `vendor/` are proprietary and licensed only for use with this application; see the license file inside each tarball. The motion model derives from NVIDIA's ARDY, Apache-2.0, and the text encoder from McGill NLP's LLM2Vec, MIT; see `NOTICE`.
