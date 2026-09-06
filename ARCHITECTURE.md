# Silicore Studio: engine architecture

## Module boundaries

```text
index.html / styles.css       Desktop workspace and design tokens
src/app.js                   Commands, gestures, project state, inspectors, SVG views
src/core.js                  Browser-independent design / logic / implementation kernel
src/renderer.js              Scene builder, camera, WebGPU and Canvas renderers
src/worker.js                CPU task dispatcher and structured result protocol
build.mjs                    Dependency-free single-file bundler
examples/                    Reference control RTL and unsigned bus example
 tests/core.test.js           Node built-in unit tests
 tests/browser_smoke.py       Optional Playwright browser integration suite
```

The runtime has no framework, npm dependency, WebAssembly dependency, CDN import, or hidden service. The DOM is used for controls and accessible text. Physical geometry uses WebGPU or Canvas 2D. Schematic and waveform views are SVG, not GPU canvases. Placement, routing, logic, and analysis are CPU algorithms in JavaScript workers; they are not GPU compute kernels.

## Design model

The native schema is `silicore/1`:

```js
{
  schema: 'silicore/1',
  name, technology, units: 'µm',
  die: { x, y, w, h },
  cells: [{ id, name, kind, type, ref, x, y, w, h, fixed, layer, logicId? }],
  nets: [{ id, name, from, to: [], width, layer, segments: [] }],
  logic: { name, inputs: [], outputs: [], gates: [], positions: {}, version: 1 },
  hdl, clock, notes: [], revision
}
```

Cells and macros use axis-aligned bounds. A physical net has one source object, multiple destination objects, and geometric route segments. Endpoint positions are derived from object bounds rather than full library pin shapes. A schematic graph and a physical netlist are distinct data structures. `logicId` provides cross-probing for the mapped control portion, not a claim of complete logical/physical equivalence.

`validateProject` normalizes imported data into new objects rather than merging arbitrary input into live state. IDs and endpoint references are checked. The explicit logic graph is preserved so that manual edits survive native export/import. Source text and an uncompiled editor draft are separate; an invalid source compilation leaves the last committed graph untouched.

The initial synthetic physical network is generated independently from the control logic graph. Synthesis creates new internal physical connections for mapped gate outputs; module-port physical pin assignment is outside this implementation.

## Transactions and spatial queries

`History` holds JSON snapshots of model state, not DOM or GPU resources. `begin/commit/cancel` groups gestures into one edit. No-op edits do not consume history. A new edit invalidates redo. The default cap is 40 undo entries with a 32 MiB approximate UTF-16 history budget; at least one snapshot may exceed that budget. This is a bounded snapshot implementation, not a persistent immutable database or delta journal.

UI edits clear stale selection references, rebuild the spatial index, invalidate the scene, and mark timing/checks stale. Failed transactions restore the snapshot and rebuild spatial references; this matters because replacing the model also changes object identities. Per-task snapshots mean an implementation flow is undoable in stages, not one multi-stage atomic transaction.

The uniform spatial hash maps axis-aligned boxes into fixed-size buckets. Picking queries a small box and prefers the smallest-area candidate. Large boxes and large query regions fall back to linear filtering instead of allocating unbounded bucket-key lists. The index is rebuilt after committed edits; it is not an incremental R-tree.

## Retained rendering contract

Each rectangle instance is **32 bytes**, represented by eight contiguous `float32` values:

```text
byte  0: x          byte  4: y
byte  8: width      byte 12: height
byte 16: red        byte 20: green
byte 24: blue       byte 28: alpha
```

The vertex shader generates a unit quad from six vertices using `vertex_index`. Geometry is supplied with `stepMode: 'instance'`. One instanced draw submits the physical scene. Horizontal and vertical wires are rectangles; macro borders, rows, and power rings use the same primitive. The CPU prepares scene arrays; there is no GPU-driven indirect drawing or compute-based culling in this release.

Camera transform:

```text
screen = (world - camera.origin) * camera.zoom
clip.x =  2 * screen.x / viewport.width  - 1
clip.y =  1 - 2 * screen.y / viewport.height
```

A single uniform binding contains:

```wgsl
struct Camera {
    origin: vec2<f32>,    // offset 0
    viewport: vec2<f32>,  // offset 8
    zoom: f32,           // offset 16
    _pad: vec3<f32>      // offset 32; aligned to 16 bytes
};                       // total 48 bytes
```

The 48-byte allocation is intentional: the `vec3` member does not begin immediately after `zoom`. JS writes a 12-element `Float32Array`, with unused slots zero-filled.

The instance buffer grows geometrically to a power-of-two capacity. Scene edits rebuild/upload geometry; camera-only changes update the camera uniform and reuse the existing instance buffer. The renderer requests frames only when invalidated. `ResizeObserver` updates dimensions and the backing canvases, with device-pixel ratio capped at two. CSS coordinates are used for camera and pointer transforms; the backing canvas supplies physical pixels.

Text, selection outlines, measurement, rulers, and timing-path highlights use a separate Canvas 2D overlay. They are not included in GPU instance count. The fallback path draws the same retained scene with CPU viewport culling; WebGPU relies on clip-space clipping rather than a CPU visibility list.

WebGPU initialization checks adapter/device creation, shader compilation messages, and validation errors. Device loss switches to fallback; a canvas that has acquired a WebGPU context is replaced before acquiring a 2D context. The backend status is explicit. The CPU render duration is the time spent issuing work and drawing the overlay, not GPU completion time.

### Performance boundaries

The initial fixture is 7,112 rectangle instances. No throughput figure is asserted. The renderer does not yet have per-layer incremental buffers, LOD/tiled geometry, GPU picking, compressed routing, texture-backed glyph shaping, worker-owned offscreen rendering, GPU timestamp queries, or command-buffer reuse. DOM/SVG schematic rebuilds and JSON snapshot transactions are additional scaling boundaries. Production-scale evaluation should profile each subsystem rather than extrapolating from the small fixture.

## Worker protocol

Requests:

```js
{ id, type, revision, payload }
```

Success:

```js
{ id, revision, result, elapsed }
```

Progress and failure:

```js
{ id, progress }
{ id, error: { name, message, line, column } }
```

Supported tasks are `compile`, `simulate`, `place`, `route`, `timing`, and `check`. Structured clone isolates task inputs. Editing is disabled during a long task; navigation remains available. The application checks the revision before applying returned results.

The worker bridge keeps pending promises by ID. A 60-second timeout actually terminates the worker and rejects pending tasks, rather than merely abandoning a promise while computation continues. A subsequent task creates a new worker. Ordinary task errors are serialized without crashing the dispatcher. Posting/clone errors are caught and their timers cleared. The timeout/restart branch is implemented but not exercised by the 21-check browser suite.

The modular build uses a module worker. The standalone build concatenates the pure kernel and worker dispatcher into a Blob worker, avoiding local relative-import failures. The worker source is generated from the same files, not a separately maintained algorithm copy.

## Compiler and evaluator

The tokenizer retains line/column information and limits source/token counts. A precedence parser generates expression trees for the supported combinational subset. Elaboration resolves forward assignments from output roots and emits explicitly width-bounded primitive nodes. Assignment buffers implement named destination widths. Unsupported syntax, cycles, and invalid literal forms raise errors rather than generating a placeholder success report.

`orderedGates` uses iterative Kahn traversal, avoiding recursion depth limits for imported graph evaluation. Repeated edges are counted correctly. A residual indegree means a combinational cycle. Evaluation uses unsigned 32-bit masking; the use of JavaScript bitwise operations is explicit and output values are converted with `>>> 0`. Output ports also apply their declared widths when directly rewired to a wider source.

This is not a certified IEEE HDL front end. In particular, full context-dependent sizing/signedness rules, four-state algebra, sequential/event semantics, elaboration of all unreachable declarations, hierarchical designs, optimization passes, and technology mapping are absent. The source-to-graph and graph-to-source paths are useful within the documented subset, not a general Verilog round-trip guarantee.

The graph serializer allocates collision-free internal wire names against module ports and other generated names. Distinct IDs that sanitize to the same HDL identifier get suffixes. Constant-connected bit-select nodes serialize to a legal constant expression in this subset.

## Implementation algorithms

### Placement

Movable standard cells are sorted by current position and packed monotonically into rows. Row height accounts for the tallest movable cell. Fixed instances and macros are queried through a spatial hash; cells skip their occupied intervals. Cells that do not fit are retained and counted as failed. This is legalization, not global placement optimization. There is no wirelength objective, partitioning, analytic solver, legalization displacement constraint, or detailed placement optimization.

### Routing

A binary heap implements A* on a **16 µm** grid over the die. Macro boxes, expanded by a small margin, mark blocked grid nodes. Successful routes are reduced into Manhattan segments; horizontal segments use M1 and vertical segments M2. Multiple destinations are routed individually. Unroutable branches are counted and can leave nets partially or entirely unrouted.

This is exploratory coarse routing. It has no congestion-capacity optimization, detailed track assignment, via objects, physical pin-access rules, spacing enforcement, standard-cell obstruction geometry, electrical connectivity extraction, or repair loop. The small endpoint-to-grid connector segments are not a complete pin-access solver. A geometric check reporting zero placement overlaps does not prove routing correctness.

The congestion view is a route-segment occupancy histogram, not a foundry layer-capacity model.

### Timing

A topological traversal propagates maximum arrival values using synthetic gate delays, a Manhattan center-to-center interconnect coefficient, and a small fanout term. Sink paths are compared against the editable clock-period scalar. WNS/TNS are summaries of this model. Paths in or downstream of cycles are flagged as invalid; they are not solved by a timing engine.

No Liberty arc interpolation, parasitic RC extraction, SDC constraints, clock domains, setup/hold, slew/load analysis, corners, derates, OCV, CPPR, SI, exceptions, or signoff accuracy is claimed. Changing route shape does not itself add extracted delay; the estimator uses endpoint geometry.

### Geometry checks

Rules cover die containment, axis-aligned placement overlaps, endpoint references, empty route sets, and a demonstration minimum wire width. They do not prove that every branch of a partially routed multi-sink net is connected. These checks are deliberately not labeled as foundry DRC or LVS.

## Integration surface

`window.Silicore` exposes diagnostics and command hooks:

```js
Silicore.getSnapshot();           // Deep copy; cannot mutate the live database
Silicore.getState();              // Backend, view, history counts, primitive count, etc.
Silicore.evaluate({ req: 1 });     // Evaluate the current combinational graph
Silicore.runTask('timing');       // Runs through the same UI task machinery
Silicore.worldToScreen(100, 100);
Silicore.fit();
```

These are prototype integration hooks, not a versioned public SDK. The test suite uses them for observation while performing editing actions through actual pointer/keyboard/file controls.

## Extension boundaries

A production progression would separate logical and physical schema revisions, implement library-owned pin geometry and multi-terminal connectivity, replace snapshot history with command deltas, add incremental routing/scene updates, and introduce proper HDL and technology adapters. A real STA/DRC implementation needs independently specified numerical and semantic contracts plus reference-vector comparison, not renamed demo metrics. These are architectural boundaries, not features included in this release.
