# Multi-Agent Pipeline System Design

---

## 1. System Overview

Agent Creator currently supports running a **single agent** against a task. This system design extends it with **multi-agent pipelines** — users define a directed graph of agents where each agent's output automatically becomes the next agent's input.

### Goals
- Define, store, and reuse pipelines (CRUD)
- Execute pipelines with multiple concurrent ACP sessions
- Stream each agent's output in real time
- Enforce valid pipeline structure (cycle detection)
- Derive execution order automatically (topological sort)
- Keep existing single-agent flow completely unchanged

### Non-Goals (v1)
- Conditional branching (execute edge only if output matches a condition)
- Loop/retry agents
- Visual canvas-based graph editor (drag-and-drop)
- Pipeline run history persistence

---

## 2. High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Tauri Desktop App                        │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │                     React Frontend                        │  │
│  │                                                           │  │
│  │  ┌─────────────┐  ┌──────────────┐  ┌────────────────┐  │  │
│  │  │  My Agents  │  │   Projects   │  │   Pipelines    │  │  │
│  │  │    Tab      │  │     Tab      │  │     Tab (new)  │  │  │
│  │  └─────────────┘  └──────────────┘  └────────────────┘  │  │
│  │                                                           │  │
│  │  Hooks: useAgents | useProjects | usePipelines            │  │
│  │         useTaskRunner (existing) | usePipelineRunner(new) │  │
│  └────────────────────────┬─────────────────────────────────┘  │
│                           │ Tauri invoke / events               │
│  ┌────────────────────────▼─────────────────────────────────┐  │
│  │                     Rust Backend                          │  │
│  │                                                           │  │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌────────────┐  │  │
│  │  │  agents/ │ │ projects/│ │  tasks/  │ │ pipelines/ │  │  │
│  │  │  (CRUD)  │ │  (CRUD)  │ │  (CRUD)  │ │  (new)     │  │  │
│  │  └──────────┘ └──────────┘ └──────────┘ └────────────┘  │  │
│  │                                                           │  │
│  │  ┌────────────────────────────────────────────────────┐  │  │
│  │  │              acp/ (ACP Bridge)                     │  │  │
│  │  │                                                     │  │  │
│  │  │  AcpState: HashMap<session_key, AcpInner>          │  │  │
│  │  │  Commands: initialize | send_prompt | shutdown      │  │  │
│  │  │  Reader:   streaming chunks → Tauri events          │  │  │
│  │  └───────────────────────┬────────────────────────────┘  │  │
│  └──────────────────────────┼───────────────────────────────┘  │
└─────────────────────────────┼───────────────────────────────────┘
                              │ JSON-RPC over stdio
              ┌───────────────┼───────────────┐
              │               │               │
     ┌────────▼────┐  ┌───────▼─────┐  ┌─────▼───────┐
     │ ACP Process │  │ ACP Process │  │ ACP Process │
     │  (node_1)   │  │  (node_2)   │  │  (node_3)   │
     └─────────────┘  └─────────────┘  └─────────────┘
       claude-code-acp subprocess per active pipeline node
```

---

## 3. Data Models

### 3.1 Existing Models (unchanged)

```
AgentConfig
├── id: string
├── name: string
├── description: string
├── tools: string[]
├── model: string
├── mcpServers: McpServerConfig[]
├── color: string
├── systemPrompt: string
├── createdAt: string
├── scope: "global" | "project"
└── projectPath: string | null

McpServerConfig
├── name: string
├── command: string
├── args: string[]
└── env: Record<string, string>

TaskResult
├── id: string
├── agentId: string
├── agentName: string
├── agentColor: string
├── agentModel: string
├── agentMcpServers: string[]
├── taskDescription: string
├── response: string
├── isStreaming: boolean
├── timestamp: string
└── error: string | null
```

### 3.2 New Models

#### Pipeline (stored on disk)
```
Pipeline
├── id: string                        unique identifier
├── name: string                      display name
├── description: string
├── nodes: PipelineNode[]             agent instances in this pipeline
└── edges: PipelineEdge[]             directed connections
└── createdAt: string

PipelineNode
├── id: string                        unique within this pipeline (e.g. "node_abc")
├── agentId: string                   references AgentConfig.id
└── label: string | null              optional override display name

PipelineEdge
├── from: string                      PipelineNode.id (source)
└── to: string                        PipelineNode.id (destination)
```

#### Pipeline Run (in-memory only, v1)
```
PipelineRun
├── id: string                        unique run identifier
├── pipelineId: string
├── initialInput: string              user's task prompt
├── nodeOutputs: Map<nodeId, string>  collected responses per node
├── status: "running" | "done" | "error"
└── error: string | null

PipelineNodeState
├── nodeId: string
├── status: "pending" | "running" | "done" | "error"
├── output: string                    accumulated streaming text
└── error: string | null
```

### 3.3 Entity Relationship

```
AgentConfig  ←──────────── PipelineNode (many nodes reference one agent)
                                │
                           Pipeline
                                │
                           PipelineEdge (connects two PipelineNodes)
```

A pipeline does NOT own agents. Agents are independent configs. Deleting an agent does not delete pipelines — but affected pipelines show a warning at edit/run time.

---

## 4. Storage Design

All storage follows the existing pattern — JSON files on disk, no database.

```
app_data_dir/
├── agents/
│   ├── {agentId}.json              existing
│   └── ...
├── pipelines/                       NEW
│   ├── {pipelineId}.json
│   └── ...
└── projects.json                   existing

{projectPath}/
└── .claude/
    ├── settings.local.json          written by ACP init
    ├── agents/
    │   └── {agentName}.md
    └── tasks/
        └── {taskId}.json
```

#### Pipeline JSON file example
```json
{
  "id": "pipe_1a2b3c",
  "name": "Research → Publish",
  "description": "Research a topic, summarize, then publish",
  "createdAt": "2026-03-30T10:00:00Z",
  "nodes": [
    { "id": "node_1", "agentId": "agent_abc", "label": null },
    { "id": "node_2", "agentId": "agent_def", "label": null },
    { "id": "node_3", "agentId": "agent_ghi", "label": null }
  ],
  "edges": [
    { "from": "node_1", "to": "node_2" },
    { "from": "node_1", "to": "node_3" },
    { "from": "node_2", "to": "node_3" }
  ]
}
```

---

## 5. ACP Session Layer Redesign

### 5.1 Current State (single session)

```rust
pub struct AcpState {
    pub inner: Arc<RwLock<Option<AcpInner>>>,
}
```

One optional session. Shared globally. Only one agent runs at a time.

### 5.2 New State (session map)

```rust
pub struct AcpState {
    pub sessions: Arc<RwLock<HashMap<String, AcpInner>>>,
}
```

Key: `"{nodeId}|{runId}"` — unique per node per pipeline run.
Value: `AcpInner` — same struct, one child process per entry.

### 5.3 Session Key Design

```
Single-agent (existing):    "{agentId}|{projectPath}"   e.g. "agent_abc|/projects/foo"
Multi-agent pipeline:       "{nodeId}|{runId}"           e.g. "node_1|run_xyz"
```

Both key formats coexist in the same HashMap. Single-agent commands manage their own keys. Pipeline commands manage theirs.

### 5.4 New Tauri Commands (session-keyed)

```
acp_initialize_session(session_key, mcp_servers, model, cwd)
acp_send_prompt_session(session_key, message)
acp_shutdown_session(session_key)
acp_is_active_session(session_key)
```

Existing commands (`acp_initialize`, `acp_send_prompt`, etc.) remain unchanged for backward compatibility.

### 5.5 Event Payloads (updated)

All events now carry `session_key` so the frontend knows which agent emitted a chunk:

```
Event: "acp:message-chunk"
Payload: {
  session_key: string,    ← which node/agent
  text: string,
  done: boolean
}

Event: "acp:disconnected"
Payload: {
  session_key: string
}
```

Existing single-agent events continue using the same event names — the `session_key` field allows the listener to filter.

### 5.6 Session Lifecycle Per Pipeline Node

```
1. acp_initialize_session
   └── spawn npx claude-code-acp child process
   └── write .claude/settings.local.json (permissions + mcp servers)
   └── send JSON-RPC: initialize → session/new
   └── store AcpInner in sessions HashMap under session_key

2. acp_send_prompt_session
   └── send JSON-RPC: session/prompt with full context
   └── reader emits acp:message-chunk events (tagged with session_key)
   └── final chunk has done: true

3. acp_shutdown_session
   └── abort reader task
   └── drop stdin → kill child process
   └── remove entry from sessions HashMap
```

---

## 6. Pipeline Execution Engine

### 6.1 Graph Validation (before execution)

Before any execution begins, two checks run client-side:

**Cycle Detection — DFS 3-color algorithm**
```
Color each node: WHITE (unvisited) → GRAY (on stack) → BLACK (done)
If DFS reaches a GRAY node → cycle detected → abort
```

**Topological Sort — Kahn's algorithm**
```
1. Compute in-degree for each node (count incoming edges)
2. Queue all nodes with in-degree = 0 (entry/root nodes)
3. Pop node → add to result → decrement successors' in-degrees
4. Enqueue successors whose in-degree reaches 0
5. Repeat until queue empty
6. Group result into execution layers (nodes at same depth = same layer)
```

### 6.2 Execution Layers

```
Pipeline edges:  A→C,  B→C,  C→D

In-degrees:  A=0, B=0, C=2, D=1

Layer 0:  [A, B]    ← in-degree = 0, no dependency between them
Layer 1:  [C]       ← in-degree reaches 0 after A and B complete
Layer 2:  [D]       ← in-degree reaches 0 after C completes
```

Nodes within the same layer run in **parallel** (Promise.all).
Layers execute **sequentially** — next layer starts only when all nodes in the current layer are done.

### 6.3 Context Injection (inter-agent data passing)

Each node receives a prompt built from:

**Root node** (no incoming edges):
```
{agent system prompt is sent at session init}

{user's initial task input}
```

**Downstream node** (one upstream):
```
{agent system prompt is sent at session init}

=== Output from [Upstream Agent Name] ===
{upstream node's full response}

=== Your Task ===
{user's initial task input}
```

**Downstream node** (multiple upstreams — fan-in):
```
{agent system prompt is sent at session init}

=== Output from [Agent A Name] ===
{node A's response}

=== Output from [Agent B Name] ===
{node B's response}

=== Your Task ===
{user's initial task input}
```

### 6.4 Full Execution Flow

```
User clicks "Run Pipeline"
        │
        ▼
usePipelineRunner.runPipeline(pipeline, initialInput)
        │
        ├─ 1. Validate: detectCycle(nodes, edges) → error if cycle
        │
        ├─ 2. Sort: getExecutionLayers(nodes, edges) → [[A,B], [C], [D]]
        │
        ├─ 3. Generate runId (unique per execution)
        │
        ├─ 4. Initialize PipelineRun state (all nodes: status=pending)
        │
        └─ 5. For each layer (sequential):
                │
                └─ Promise.all( nodes in layer ) → for each node:
                        │
                        ├─ a. session_key = "{nodeId}|{runId}"
                        │
                        ├─ b. Look up AgentConfig by node.agentId
                        │
                        ├─ c. invoke acp_initialize_session(
                        │         session_key,
                        │         agent.mcpServers,
                        │         agent.model,
                        │         projectPath
                        │      )
                        │
                        ├─ d. Build context prompt:
                        │       - gather outputs of all upstream nodes
                        │       - format as "=== Output from X ===" blocks
                        │       - append initialInput as "=== Your Task ==="
                        │
                        ├─ e. Mark node status = "running"
                        │
                        ├─ f. invoke acp_send_prompt_session(session_key, prompt)
                        │
                        ├─ g. Listen to acp:message-chunk where
                        │       event.session_key === session_key
                        │       → accumulate text → update node output in UI
                        │
                        ├─ h. On done: true
                        │       → mark node status = "done"
                        │       → store output in nodeOutputs map
                        │
                        └─ i. invoke acp_shutdown_session(session_key)
                               → remove session from HashMap
        │
        └─ 6. All layers complete → mark PipelineRun status = "done"
```

---

## 7. Frontend Architecture

### 7.1 New Tab: Pipelines

Added as a third tab in App.tsx alongside "My Agents" and "Projects":

```
Tabs
├── "agents"    → AgentList (existing)
├── "projects"  → ProjectList / ProjectDetail (existing)
└── "pipelines" → PipelineView (new)
                     ├── PipelineList (default view)
                     └── PipelineRunner (when a pipeline is selected to run)
```

### 7.2 New Components

```
src/components/pipelines/
├── PipelineList.tsx
│     Grid of PipelineCards
│     "Create Pipeline" button → opens PipelineFormDialog
│
├── PipelineCard.tsx
│     Shows: name, description, node count, agent names
│     Actions: Edit | Delete | Run
│
├── PipelineFormDialog.tsx
│     Fields: name, description
│     Node builder: dropdown to pick agent → add as node
│     Edge builder: pick from-node + to-node → add edge
│     Live cycle detection: shows error inline, disables Save if cycle
│     Visual: ordered node list with arrows (no canvas needed)
│
└── PipelineRunner.tsx
      Static graph view (nodes + arrows)
      Input: textarea for initial task
      Run button
      Per-node status badge: pending → running → done / error
      Per-node streaming output panel
      Overall status bar
```

### 7.3 New Hooks

```
src/hooks/usePipelines.ts
├── pipelines: Pipeline[]
├── isLoading: boolean
├── error: string | null
├── createPipeline(input): Promise<Pipeline>
├── updatePipeline(p: Pipeline): Promise<void>
├── deletePipeline(id: string): Promise<void>
└── refreshPipelines(): Promise<void>

Tauri calls: pipeline_list, pipeline_create, pipeline_update, pipeline_delete


src/hooks/usePipelineRunner.ts
├── run: PipelineRun | null
├── nodeStates: Record<nodeId, PipelineNodeState>
├── isRunning: boolean
├── error: string | null
├── runPipeline(pipeline, initialInput, projectPath): Promise<void>
└── cancelRun(): Promise<void>

Contains: cycle detection, topological sort, layer execution, ACP session management
```

### 7.4 New Utilities

```
src/utils/graph.ts
├── detectCycle(nodes, edges): boolean
│     DFS 3-color algorithm
│
├── topologicalSort(nodes, edges): string[]
│     Kahn's algorithm → flat ordered list of node IDs
│
└── getExecutionLayers(nodes, edges): string[][]
      Groups topological result into parallel layers
      [[nodeId, nodeId], [nodeId], [nodeId]]
```

### 7.5 New Types

```
src/types/pipeline.ts
├── PipelineNode
├── PipelineEdge
├── Pipeline
├── PipelineRun
└── PipelineNodeState
```

---

## 8. Backend (Rust) Architecture

### 8.1 New Module: pipelines/

```
src-tauri/src/pipelines/
├── mod.rs
├── types.rs          Rust Pipeline struct (mirrors TypeScript Pipeline)
├── storage.rs        JSON file CRUD (mirrors agents/storage.rs pattern)
└── commands.rs       Tauri commands
```

### 8.2 New Tauri Commands

```
pipeline_list()                     → Vec<Pipeline>
pipeline_create(pipeline)           → Pipeline   (generates id + createdAt)
pipeline_update(pipeline)           → Pipeline
pipeline_delete(id)                 → ()
```

### 8.3 Modified: acp/state.rs

```
Before:   Arc<RwLock<Option<AcpInner>>>
After:    Arc<RwLock<HashMap<String, AcpInner>>>
```

### 8.4 Modified: acp/commands.rs

New session-keyed commands added (existing commands untouched):
```
acp_initialize_session(session_key, mcp_servers, model, cwd)
acp_send_prompt_session(session_key, message)
acp_shutdown_session(session_key)
acp_is_active_session(session_key)
```

### 8.5 Modified: acp/reader.rs

Reader task now accepts `session_key` parameter and includes it in all emitted events:
```
run_reader(session_key, stdout, stdin, pending, app_handle)
```

### 8.6 Modified: acp/types.rs

```
ChatChunkEvent adds session_key field:
{ session_key: String, text: String, done: bool }

New:
AcpDisconnectedEvent: { session_key: String }
```

### 8.7 Modified: lib.rs

Register new commands:
```rust
pipeline_list, pipeline_create, pipeline_update, pipeline_delete,
acp_initialize_session, acp_send_prompt_session,
acp_shutdown_session, acp_is_active_session
```

---

## 9. Complete File Change Map

### New Files

| File | Purpose |
|------|---------|
| `src/types/pipeline.ts` | TypeScript types for Pipeline system |
| `src/utils/graph.ts` | Cycle detection, topological sort, execution layers |
| `src/hooks/usePipelines.ts` | Pipeline CRUD hook |
| `src/hooks/usePipelineRunner.ts` | Pipeline execution engine |
| `src/components/pipelines/PipelineList.tsx` | Pipeline grid view |
| `src/components/pipelines/PipelineCard.tsx` | Individual pipeline card |
| `src/components/pipelines/PipelineFormDialog.tsx` | Create/Edit pipeline |
| `src/components/pipelines/PipelineRunner.tsx` | Run pipeline + live progress |
| `src-tauri/src/pipelines/mod.rs` | Rust module root |
| `src-tauri/src/pipelines/types.rs` | Rust Pipeline struct |
| `src-tauri/src/pipelines/storage.rs` | JSON CRUD for pipelines |
| `src-tauri/src/pipelines/commands.rs` | Tauri commands for pipelines |

### Modified Files

| File | Change |
|------|--------|
| `src/App.tsx` | Add Pipelines tab |
| `src-tauri/src/acp/state.rs` | `Option<AcpInner>` → `HashMap<String, AcpInner>` |
| `src-tauri/src/acp/commands.rs` | Add `*_session` command variants |
| `src-tauri/src/acp/reader.rs` | Accept + forward `session_key` in events |
| `src-tauri/src/acp/types.rs` | Add `session_key` to event structs |
| `src-tauri/src/lib.rs` | Register new pipeline + session commands |

### Untouched Files

| File | Reason |
|------|--------|
| `src/hooks/useTaskRunner.ts` | Single-agent flow unchanged |
| `src/hooks/useAgents.ts` | Agent CRUD unchanged |
| `src/components/agents/*` | Agent UI unchanged |
| `src/components/tasks/*` | Single-agent task UI unchanged |
| `src-tauri/src/agents/*` | Agent storage/commands unchanged |
| `src-tauri/src/tasks/*` | Task storage/commands unchanged |

---

## 10. Error Handling

| Scenario | Behavior |
|----------|---------|
| Cycle in pipeline | Detected at edit time; Save disabled; inline error shown |
| Agent deleted but in pipeline | Warning shown in editor and runner; Run disabled |
| Node ACP init fails | Node marked error; downstream nodes skipped; run marked failed |
| Node response errors | Node marked error; downstream nodes skipped |
| User cancels mid-run | `cancelRun()` shuts down all active sessions for this run |
| ACP process crashes mid-run | `acp:disconnected` event received; node marked error |
| Empty pipeline (0 nodes) | Save disabled; "Add at least one agent" message |
| Pipeline with 1 node, 0 edges | Valid; runs like a single-agent task |
| Disconnected node (no edges to/from it) | Runs as isolated root node with initial input |

---

## 11. Concurrency Model

```
Pipeline Run
    │
    ├── Layer 0: Promise.all([nodeA, nodeB])
    │               │             │
    │          ACP session A   ACP session B    ← run in parallel
    │          (child proc)    (child proc)
    │               │             │
    │           done           done
    │
    ├── Layer 1: Promise.all([nodeC])
    │               │
    │          ACP session C                    ← waits for Layer 0
    │          receives outputs of A and B
    │               │
    │           done
    │
    └── Layer 2: Promise.all([nodeD])
                    │
               ACP session D                   ← waits for Layer 1
                    │
                done → PipelineRun complete
```

Max concurrent ACP processes = max nodes in a single layer. In practice this is small (2–5). No cap enforced in v1.

---

## 12. What Stays the Same

- Agent CRUD (My Agents tab, AgentFormDialog, AgentCard)
- Single-agent task execution (TaskRunner, useTaskRunner)
- Existing ACP commands (`acp_initialize`, `acp_send_prompt`, etc.)
- MCP server config via `settings.local.json` workaround
- Task history storage per project
- Projects tab and project management

The multi-agent pipeline system is purely **additive** — no existing functionality is broken or replaced.
