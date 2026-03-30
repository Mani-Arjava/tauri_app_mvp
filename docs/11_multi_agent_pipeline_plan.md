# Multi-Agent Pipeline System — Planning Document

## 1. Overview

This document plans a **multi-agent pipeline** feature for Agent Creator. Instead of running one agent per task, users will be able to define a **pipeline** — a directed graph of agents where each agent's output feeds into the next. This enables complex workflows like: research → summarize → translate, or plan → code → review.

---

## 2. Core Problem & Goals

| Problem | Goal |
|---------|------|
| Currently only one agent can run per task | Allow chaining N agents together |
| No way to compose agents | Define reusable pipelines with CRUD |
| Single ACP session at a time | Run multiple ACP sessions concurrently |
| No inter-agent data passing | Route agent outputs as inputs downstream |
| No validation of agent relationships | Detect and prevent cyclic dependencies |

### Problem 1: Only one agent can run per task

**Current state:** The app has one global `AcpState` holding a single `Option<AcpInner>`. When you run a task, one agent spawns one `claude-code-acp` process. There is no concept of "also run agent B at the same time."

**Why it's limiting:** Real workflows need specialization. You wouldn't want one agent to research, summarize, translate, and format — that's too broad. You want dedicated agents with focused system prompts doing one thing well.

### Problem 2: No way to compose agents

**Current state:** Each agent is an isolated config. There's no relationship between agents — no concept of "after agent A finishes, hand its output to agent B."

**Why it's limiting:** You'd have to manually copy agent A's response, paste it into a new task for agent B. This is tedious and not automatable. A pipeline lets you define these relationships once and reuse them.

### Problem 3: Single ACP session at a time

**Current state:** The Rust backend holds `Arc<RwLock<Option<AcpInner>>>` — a single optional session. If you want a different agent, the old session is killed and a new one starts. Two agents literally cannot coexist.

**Why it's limiting:** Even if you wanted to run agents A and B in parallel, there is no infrastructure for it. The fix requires changing the state from one optional session → a map of sessions keyed by ID.

### Problem 4: No inter-agent data passing

**Current state:** `acp_send_prompt` just sends a string. There is no mechanism for one agent's response to automatically become another agent's input. The `_turns` conversation history in `useTaskRunner.ts` is only for the same agent across multiple messages.

**Why it's limiting:** For a pipeline to work, Agent B must know what Agent A produced. This requires a structured way to collect outputs and inject them as context into the next agent's prompt.

### Problem 5: No validation of agent relationships

**Current state:** Agents are independent — there's nothing to validate. But once you introduce edges between agent nodes, invalid configurations become possible. For example:

```
Agent A → Agent B → Agent C → Agent A   ← infinite loop
```

If this ran, Agent A would wait for Agent C, Agent C waits for B, B waits for A — **deadlock**. Or if execution is naive, it would loop forever consuming memory and API credits.

**Why cycle detection matters:** A pipeline must be a DAG (acyclic) to have a clear start, clear end, and a deterministic execution order. Cycle detection catches this at edit time — before any execution happens — giving the user immediate feedback to fix the graph.

---

## 3. Data Structure: Directed Acyclic Graph (DAG)

A pipeline is modeled as a **DAG** — the most natural structure for ordered, dependency-aware workflows.

### Why DAG and Not Other Data Structures?

Before settling on DAG, here are all the candidates evaluated:

#### Option A: Simple Array / List
```
[AgentA] → [AgentB] → [AgentC] → [AgentD]
```
- Supports sequential pipelines only
- Cannot support branching (A's output going to both B and C)
- Cannot support merging/fan-in (C waiting for both A and B)
- Cannot support parallel execution
- **Verdict: Too limiting. Breaks the moment a user wants anything beyond a simple chain.**

#### Option B: Tree
```
         [A: Research]
        ↙             ↘
[B: Summarize]    [C: Analyze]
     ↓                  ↓
[D: Translate]      [E: Format]
```
- Supports fan-out (one agent feeds many)
- Every node has exactly one parent — cannot express fan-in
- Diamond patterns are impossible: D cannot receive output from both B and C
- **Verdict: Better than a list but still insufficient. Real pipelines often need multiple agents to feed one final agent.**

#### Option C: General Graph (cycles allowed)
- Supports everything a DAG supports plus cycles
- Cycles mean no clear execution order — topological sort is impossible on a cyclic graph
- Cycles mean potential infinite execution — agents keep feeding each other forever
- Requires explicit termination conditions (loop counters, convergence checks) adding significant complexity
- ACP sessions would never shut down without explicit loop management
- **Verdict: Too dangerous for v1. Cycle support is a liability, not a feature here.**

#### Option D: State Machine
```
[Idle] → [Researching] → [Summarizing] → [Done]
                      ↗
               [Error] → [Retrying]
```
- Models one entity's lifecycle moving through states
- Great for control flow — what happens next based on outcome
- Wrong abstraction: state machines model "what state am I in?", DAGs model "who depends on whom?"
- Cannot naturally express parallel agents or data flow between agents
- **Verdict: Wrong abstraction for agent orchestration. Could complement a DAG but not replace it.**

#### Option E: DAG (chosen)
- Supports fan-out (A → B and A → C)
- Supports fan-in (B and C → D)
- Supports parallel execution (B and C have no dependency on each other)
- Topological sort gives unambiguous execution order
- Acyclic constraint guarantees termination — every pipeline has a clear start and end
- Covers every real topology: linear, branching, merging, diamond
- **Verdict: Best fit. The minimum structure that satisfies all requirements.**

#### Comparison Table

| Data Structure | Fan-out | Fan-in | Parallel | Cycle-free | Topo Sort | Complexity |
|----------------|---------|--------|----------|------------|-----------|------------|
| Array/List     | No      | No     | No       | Yes        | Trivial   | Very Low   |
| Tree           | Yes     | No     | Yes      | Yes        | Easy      | Low        |
| General Graph  | Yes     | Yes    | Yes      | No         | Impossible| High       |
| State Machine  | Cond.   | No     | No       | Yes        | N/A       | Medium     |
| **DAG**        | **Yes** | **Yes**| **Yes**  | **Yes**    | **Yes**   | **Medium** |

### Why DAG (Summary)
- **Directed:** Data flows in one direction (A's output → B's input)
- **Acyclic:** No infinite loops — Agent A cannot eventually depend on itself
- **Graph:** Supports branching (one agent feeds two) and merging (two agents feed one)

### Fan-Out and Fan-In

These are terms describing how data **splits** and **merges** as it flows through the graph.

#### Fan-Out — One splits into Many

One agent's output goes to **multiple downstream agents simultaneously**.

```
         [A: Researcher]
               ↓
        ┌──────┴──────┐
        ↓             ↓
[B: Summarizer]  [C: Fact-Checker]
```

Agent A finishes → its output is sent to **both** B and C at the same time → B and C run in parallel.

**Real example:** A research agent produces a long report. You fan-out to a Summarizer (for a short brief) AND a Fact-Checker (for accuracy review) simultaneously — no need to do them one after the other.

#### Fan-In — Many merge into One

**Multiple agents' outputs** are collected and fed into one downstream agent.

```
[B: Summarizer]    [C: Fact-Checker]
        ↓             ↓
        └──────┬──────┘
               ↓
         [D: Publisher]
```

Agent D **waits** for both B and C to finish → receives both outputs as context → produces a final result combining both.

**Real example:** The Publisher agent gets the summary from B and the fact-check report from C, then writes a final polished article using both.

#### Fan-Out + Fan-In together (Diamond Pattern)

The most common real-world pattern — one agent feeds many, then many feed one:

```
         [A: Researcher]
               ↓
        ┌──────┴──────┐
        ↓             ↓
[B: Summarizer]  [C: Fact-Checker]
        ↓             ↓
        └──────┬──────┘
               ↓
         [D: Publisher]
```

- A → fans out → B and C run in parallel
- B and C → fan in → D waits for both, then runs

**Why this matters for data structures:**
- A simple **Array** cannot express this at all
- A **Tree** handles fan-out but not fan-in (each node can only have one parent)
- A **DAG** handles both naturally — that is the core reason it was chosen

---

### Core Entities

```
Pipeline
├── id, name, description, createdAt
├── nodes[]        ← agent instances in this pipeline
│     ├── id       ← unique within pipeline
│     └── agentId  ← references an existing AgentConfig
└── edges[]        ← directed connections
      ├── from     ← source node id
      └── to       ← destination node id
```

### Visual Example

```
      [NodeA: Researcher]
           ↓
      [NodeB: Summarizer]
       ↙           ↘
[NodeC: Translator]  [NodeD: Formatter]
       ↘           ↙
      [NodeE: Publisher]
```

This is a valid DAG (diamond pattern). All outputs flow forward, no cycles.

---

## 4. Cycle Detection

Cycle detection runs **every time an edge is added** to a pipeline, preventing invalid graphs from being saved.

### Algorithm: DFS with 3-Color Marking

Each node is colored during traversal:
- **White** — not yet visited
- **Gray** — currently being explored (on the current path)
- **Black** — fully explored

**Rule:** If DFS reaches a **Gray** node, a cycle exists (we've looped back to a node on the current path).

### Example

```
A → B → C → A   ← cycle: when exploring A→B→C, we reach A which is still Gray

A → B → C → D   ← no cycle: all nodes go from White → Gray → Black cleanly
```

### When to Run It
- In the pipeline editor UI: live, on every edge addition (instant feedback)
- Before saving a pipeline: final validation
- Before executing a pipeline: safety check

### User Feedback
- Edge that would create a cycle is visually rejected (red highlight)
- Save button is disabled with message: "Remove the cycle before saving"

---

## 5. Execution Order: Topological Sort

Once a valid DAG is confirmed, the execution order is derived via **topological sort** (Kahn's algorithm).

### Why is Topological Sort Needed Here?

#### What is actually stored

When a user builds a pipeline, what gets saved to disk is just **two lists** — nodes and edges:

```
Pipeline JSON file:
{
  "nodes": [
    { "id": "node_1", "agentId": "agent_abc", "label": "Researcher" },
    { "id": "node_2", "agentId": "agent_def", "label": "Summarizer" },
    { "id": "node_3", "agentId": "agent_ghi", "label": "Publisher" }
  ],
  "edges": [
    { "from": "node_1", "to": "node_2" },
    { "from": "node_1", "to": "node_3" },
    { "from": "node_2", "to": "node_3" }
  ]
}
```

That's it. Just nodes (agent instances) and edges (connections). **No execution order is stored. No sequence numbers. No "run this first" instruction.**

The edges only express **relationships** — "node_1 feeds into node_2". They do NOT say "node_1 runs at step 1, node_2 runs at step 2."

#### The Problem

When it's time to execute, the runner gets handed this raw list of nodes and edges and must answer: **in what order do I start these agents?**

Looking at the edges:
```
node_1 → node_2
node_1 → node_3
node_2 → node_3
```

The runner must figure out:
- node_1 has no dependencies → run it first
- node_2 depends on node_1 → run it after node_1
- node_3 depends on BOTH node_1 and node_2 → run it last

The edges only tell you **who depends on whom**. They do NOT give a ready-made execution sequence. Topological sort is the algorithm that **derives the execution sequence from the dependency relationships**.

#### Why not just store the order?

**1. The user thinks in connections, not sequences.**
When a user says "Summarizer should use Researcher's output", they are expressing a relationship, not a position in a queue. The system should derive the order automatically.

**2. One graph has many valid orderings.**
```
node_1 → node_3
node_2 → node_3
```
Both `[node_1, node_2, node_3]` and `[node_2, node_1, node_3]` are valid. The runner can pick either — and can even run node_1 and node_2 in **parallel**. Hardcoding one order in the JSON would unnecessarily lose this parallelism opportunity.

#### Summary

| Question | Answer |
|----------|--------|
| What is stored? | Raw nodes + edges (relationships only) |
| What is NOT stored? | Execution order |
| Why not store order? | Relationships are what the user defines; order is derived |
| What derives the order? | Topological sort |
| What does it produce? | A sequence (and layers) that respects all dependencies |

---

### What is Topological Sort?

An algorithm that takes a DAG and produces a **linear ordering of nodes** such that for every edge A → B, node A always appears **before** node B in the result.

In simple terms: **it figures out the correct order to execute things when some things depend on others.**

It is impossible on a cyclic graph — if A → B → C → A, there is no valid starting point. Every node is waiting for another. This is the core reason cycles must be prevented.

### How It Works (Kahn's Algorithm)

Given pipeline: `A → C, B → C, C → D`

**Step 1 — Calculate in-degree** (how many edges point into each node):

| Node | In-degree |
|------|-----------|
| A    | 0         |
| B    | 0         |
| C    | 2 (from A and B) |
| D    | 1 (from C) |

**Step 2 — Queue nodes with in-degree = 0** (no dependencies): `Queue: [A, B]`

**Step 3 — Process A:** add to result, reduce C's in-degree (2 → 1). `Result: [A]`

**Step 4 — Process B:** add to result, reduce C's in-degree (1 → 0), enqueue C. `Result: [A, B]`

**Step 5 — Process C:** add to result, reduce D's in-degree (1 → 0), enqueue D. `Result: [A, B, C]`

**Step 6 — Process D:** add to result. `Result: [A, B, C, D]` ✓

Final execution order: **A → B → C → D**

### Execution Layers

Topological sort gives a flat list, but nodes at the same "level" can run in **parallel** — grouped into layers:

```
Pipeline:  A → C, B → C, C → D

Layer 0:  [A, B]     ← both are roots, no dependency between them → run in parallel
Layer 1:  [C]        ← waits for A AND B to finish
Layer 2:  [D]        ← waits for C
```

This maximizes throughput — parallel within a layer, sequential across layers.

---

## 6. ACP Session Management

### Current State
The app has **one global ACP session** at a time. A session is a child process (`npx claude-code-acp`) with its own stdin/stdout. When a different agent is selected, the old session is destroyed and a new one is created.

### Required Change: Session Map
For multi-agent pipelines, multiple agents must run **simultaneously**. The backend needs to hold a **map of sessions** keyed by a unique session identifier.

```
Session Map:
  "nodeA|run123"  →  AcpProcess(AgentResearcher, model=opus)
  "nodeB|run123"  →  AcpProcess(AgentSummarizer, model=sonnet)
  "nodeC|run123"  →  AcpProcess(AgentTranslator, model=haiku)
```

### Session Lifecycle Per Node
```
1. Initialize   → spawn child process for this agent config
2. Send prompt  → inject context + task, stream response
3. Receive      → collect streaming chunks tagged with session_key
4. Shutdown     → kill process after node completes
```

### Event Identification
All streaming events must carry which session they belong to so the UI can update the right node's output:
```
Event: { session_key: "nodeA|run123", text: "...", done: false }
Event: { session_key: "nodeB|run123", text: "...", done: true  }
```

### Backward Compatibility
The existing single-agent `TaskRunner` continues to use the current single-session commands unchanged. New multi-session commands are added alongside (not replacing) existing ones.

---

## 7. Inter-Agent Context Passing

When a node has upstream dependencies, it receives their outputs as context.

### Root Node (no incoming edges)
Receives the user's initial task input directly.

### Downstream Node (one upstream)
```
=== Context from [Researcher] ===
{researcher's full output}

=== Your Task ===
{original user task}
```

### Downstream Node (multiple upstreams — fan-in)
```
=== Context from [Researcher] ===
{researcher output}

=== Context from [Analyst] ===
{analyst output}

=== Your Task ===
{original user task}
```

Each agent still has its own **system prompt** (from its AgentConfig) which is injected at session initialization — so each agent retains its persona/specialization while also receiving upstream context.

---

## 8. Pipeline CRUD

Pipelines are stored as JSON files on disk (same pattern as agent configs).

| Operation | Details |
|-----------|---------|
| **Create** | Name, description, add nodes (pick from existing agents), add edges (pick from/to nodes), validate no cycle |
| **Read** | List all pipelines; load single pipeline by ID |
| **Update** | Edit name/description/nodes/edges with live cycle validation |
| **Delete** | Remove pipeline file; does not affect the referenced agents |

Storage location: `{app_data_dir}/pipelines/{id}.json`

---

## 9. UI Plan

### New Tab: "Pipelines"
Added alongside "My Agents" and "Run Task" tabs.

### Pipeline List View
- Grid of pipeline cards (mirrors agent list layout)
- Each card shows: name, description, node count, agent names involved
- Actions: Edit, Delete, Run

### Pipeline Editor (Create/Edit)
- Form fields: name, description
- **Node section:** Add agents from a dropdown → each becomes a named node
- **Edge section:** Pick a source node → pick a destination node → Add edge
  - Live cycle detection: if edge would create cycle, show error and block addition
  - Visual representation: ordered list with directional arrows (no canvas needed)
- Save disabled until pipeline has at least 2 nodes and at least 1 edge, and no cycles

### Pipeline Runner
- Shows pipeline graph (static view of nodes + edges)
- Input field: initial task/prompt for the pipeline
- "Run" button starts execution
- Each node shows a status indicator: `pending → running → done / error`
- Each node's streaming output appears in real time as it runs
- Final state: all nodes done, outputs visible

---

## 10. Handling Edge Cases

| Case | Handling |
|------|---------|
| Agent deleted but still in pipeline | Show warning in editor; disable Run until resolved |
| Node times out or errors | Mark node as errored; stop dependent downstream nodes; mark run as failed |
| User cancels mid-run | Shut down all active sessions for this run |
| Single-node pipeline | Valid; executes like a normal single-agent task |
| Disconnected node (no edges) | Valid as isolated entry/exit; runs independently |
| Empty pipeline (0 nodes) | Cannot save; "Add at least one agent" |

---

## 11. System Architecture Summary

```
User (UI)
  │
  ├── PipelineList ──────────── CRUD pipelines (usePipelines hook)
  │         │                         │
  │         └── PipelineFormDialog    └── Tauri: pipeline_create/update/delete/list
  │                                              (JSON files in app_data_dir/pipelines/)
  │
  └── PipelineRunner ─────────── usePipelineRunner hook
            │
            ├── 1. cycle detection (client-side, instant)
            ├── 2. topological sort → execution layers
            └── 3. For each layer:
                    ├── invoke acp_initialize_session(nodeKey, agentConfig)
                    ├── invoke acp_send_prompt_session(nodeKey, contextPrompt)
                    ├── listen to acp:message-chunk { session_key, text, done }
                    └── invoke acp_shutdown_session(nodeKey) on completion
```

---

## 12. What Does NOT Change

- Existing agent CRUD (AgentList, AgentFormDialog, AgentCard)
- Existing single-agent TaskRunner and its ACP session management
- ACP Rust backend read/write logic (reader.rs, permission auto-approval)
- MCP server configuration pattern (settings.local.json workaround)
- Data storage format for agents and tasks

---

## 13. Open Questions / Future Considerations

1. **Pipeline run history** — Should completed pipeline runs be persisted to disk like single-agent task results?
2. **Conditional branching** — Future: allow edges to be conditional (only follow edge if output matches a pattern)
3. **Max parallelism limit** — Should we cap concurrent ACP sessions (e.g. max 5) to avoid resource exhaustion?
4. **Loop agents** — Intentional loops (not cycles) like "retry until quality passes" — out of scope for v1
5. **Visual graph editor** — A canvas-based drag-and-drop editor (e.g. React Flow) for v2
