# Coordinator & Orchestrator — Concepts and Implementation

---

## 1. The Problem With Static Pipelines

The current pipeline system works like this:

```
You (human) → define connections → pipeline runs in fixed order
```

You decide at **design time**: "Researcher goes first, then Summarizer, then Publisher." The agents just follow the hardcoded flow.

But what if:
- The task is complex and you don't know upfront which agents are needed?
- A task needs retrying if the output quality is poor?
- Some tasks need 2 agents, others need 5?
- The order should change based on the task content?

Static pipelines cannot handle this. This is where **Coordinator** and **Orchestrator** patterns come in.

---

## 2. What is an Orchestrator?

An **Orchestrator** is a **Claude agent itself** that decides the execution plan dynamically at runtime.

Instead of you hardcoding the flow, the Orchestrator reads the task, reasons about it, and decides which agents to call, in what order, with what inputs.

```
You (human) → give task to Orchestrator
                     ↓
              Orchestrator thinks:
              "This needs research first,
               then a fact-check,
               then publishing"
                     ↓
         Calls Researcher → gets output
                     ↓
         Calls Fact-Checker → gets output
                     ↓
         Calls Publisher → final result
                     ↓
              Returns answer to you
```

### Key Difference from Static Pipeline

| Static Pipeline | Orchestrator |
|----------------|--------------|
| Flow fixed at design time | Flow decided at runtime |
| You define connections | Orchestrator decides connections |
| Same order every run | Order can change per task |
| Cannot skip agents | Can skip unnecessary agents |
| No retry logic | Can retry a failed step |
| Static | Adaptive |

### Real-World Example

Task: *"Write an article about quantum computing"*

- Simple task → Orchestrator calls: `Researcher → Publisher` (skips Fact-Checker)
- Controversial claims → Orchestrator calls: `Researcher → Fact-Checker → Researcher again → Publisher`
- Quick summary task → Orchestrator calls: `Summarizer → Publisher` (skips Researcher entirely)

The Orchestrator **reasons** about what is needed. A static pipeline cannot do this.

---

## 3. What is a Coordinator?

A **Coordinator** is specifically about **managing parallel agents and synthesizing their combined results**.

Where an Orchestrator is sequential and adaptive, a Coordinator is parallel and aggregating.

```
         Coordinator
        ↙      ↓      ↘
   Agent A   Agent B   Agent C    ← all run IN PARALLEL
        ↘      ↓      ↙
         Coordinator              ← collects all 3 results
              ↓
         Synthesizes into one final answer
```

### Real-World Example

Task: *"Analyze this business proposal from 3 angles"*

Coordinator sends the SAME task to:
- `Legal Agent` — checks legal risks
- `Financial Agent` — checks financial viability
- `Market Agent` — checks market opportunity

All 3 run at the same time. Coordinator collects all 3 reports and synthesizes a final verdict.

The Coordinator does not need to know a sequence. It just fans out work and fans in results.

---

## 4. Orchestrator vs Coordinator — Key Differences

| Aspect | Orchestrator | Coordinator |
|--------|-------------|-------------|
| **Role** | Decides what to do next | Manages parallel work |
| **Flow** | Sequential, adaptive | Parallel, fixed |
| **Decides** | Which agent, when, with what input | Distributes same task to many |
| **Output** | One chain result | Synthesis of parallel results |
| **Intelligence** | High — reasons about the task | Low — just distributes and collects |
| **Analogy** | Project Manager | Team Lead running a stand-up |

---

## 5. Why Are They Needed?

The current static pipeline has these limitations:

**1. Fixed topology** — You must know the agent flow before running. Real tasks are unpredictable.

**2. No feedback loops** — If Researcher gives poor output, the pipeline cannot ask it to try again.

**3. No decision making** — The pipeline cannot say "this task is simple, skip 3 agents."

**4. No task decomposition** — Complex tasks need to be broken into sub-tasks dynamically.

| Pattern | Solves |
|---------|--------|
| **Orchestrator** | Dynamic routing, retry logic, adaptive flow, task decomposition |
| **Coordinator** | Parallel analysis, multi-perspective gathering, result synthesis |

---

## 6. How to Develop These Here

### 6.1 Coordinator (Already Built)

The Coordinator pattern is **already implemented** in `usePipelineRunner.ts` via execution layers.

Nodes at the same layer (no dependency between them) run in parallel via `Promise.all`. The next layer waits for all of them to finish, then a downstream node receives all their outputs as context — acting as the synthesizer.

```
Pipeline edges: A→C, B→C

Layer 0: [A, B]   ← Promise.all — run in parallel
Layer 1: [C]      ← receives output from both A and B — acts as synthesizer
```

This is the Coordinator pattern. You already have it.

**Example setup in the app:**

1. Create `Legal Agent`, `Financial Agent`, `Market Agent`, `Synthesis Agent`
2. Create pipeline with edges:
   - `Legal → Synthesis`
   - `Financial → Synthesis`
   - `Market → Synthesis`
3. Run with task: *"Evaluate this business proposal: [details]"*
4. Legal, Financial, Market all run in parallel → Synthesis gets all 3 outputs

### 6.2 Orchestrator (Future Implementation)

The Orchestrator is a special `AgentConfig` with a system prompt that knows about the other available agents. It runs in a **ReAct loop** (Reason + Act).

#### Step 1: Orchestrator System Prompt

```
You are an Orchestrator agent. You have access to these sub-agents:
- Researcher: deep research on any topic
- Summarizer: condenses long text into bullet points
- Fact-Checker: verifies claims for accuracy
- Publisher: writes polished final articles

When given a task:
1. Analyze what is needed
2. Decide which agents to call and in what order
3. Issue calls using this exact format: CALL_AGENT(AgentName, "your instruction")
4. Wait for the result of each call before deciding the next step
5. Return a final synthesized answer when done

Example:
Task: Write a verified article about climate change

Step 1: CALL_AGENT(Researcher, "research climate change causes and effects in 2025")
[receives research output]
Step 2: CALL_AGENT(Fact-Checker, "verify these claims: [research output]")
[receives fact-check output]
Step 3: CALL_AGENT(Publisher, "write an article using: [research] and [fact-check]")
[receives final article]
Done.
```

#### Step 2: Response Parser

The Orchestrator's response is parsed to extract `CALL_AGENT(...)` instructions:

```typescript
function parseOrchestratorResponse(text: string): OrchestratorAction | null {
  const match = text.match(/CALL_AGENT\((\w+),\s*"([^"]+)"\)/);
  if (!match) return null;
  return { agentName: match[1], instruction: match[2] };
}
```

#### Step 3: ReAct Loop

```typescript
async function runOrchestrator(task: string, agents: AgentConfig[]) {
  const orchestrator = agents.find(a => a.name === "Orchestrator");
  let conversationHistory = task;

  while (true) {
    // Ask the Orchestrator what to do next
    const response = await runAgent(orchestrator, conversationHistory);

    // Check if it issued a CALL_AGENT instruction
    const action = parseOrchestratorResponse(response);
    if (!action) {
      // No more calls — Orchestrator is done, return final response
      return response;
    }

    // Find the requested sub-agent and run it
    const subAgent = agents.find(a => a.name === action.agentName);
    const subOutput = await runAgent(subAgent, action.instruction);

    // Feed the result back to the Orchestrator for next decision
    conversationHistory += `\n\nOrchestrator called ${action.agentName}.\nResult: ${subOutput}`;
  }
}
```

This loop continues until the Orchestrator stops issuing `CALL_AGENT(...)` calls and returns a final answer.

---

## 7. Who Creates the Coordinator & How It Knows Your Agents

### There Is No "Coordinator Agent"

This is the most important thing to understand: **there is no single Coordinator agent to create**. The coordinator is a **pipeline topology** — a specific shape of connections between your agents.

Three things work together:

| Role | What It Is | Who Creates It |
|------|-----------|----------------|
| **Specialist agents** | Regular `AgentConfig` with a focused system prompt | You (in "My Agents") |
| **Synthesizer agent** | Regular `AgentConfig` that combines reports | You (in "My Agents") |
| **Pipeline** | Fan-out edges connecting all specialists → synthesizer | You (in "Pipelines") |

The `usePipelineRunner.ts` execution engine **is** the coordinator mechanism. It detects the fan-out topology, runs all specialists in parallel via `Promise.all`, and feeds all their outputs into the synthesizer. You don't write any coordinator logic — you just draw the right edges.

---

### How the Synthesizer "Knows" the Other Agents

**It doesn't need to know in advance.** `buildNodePrompt()` in `src/hooks/usePipelineRunner.ts` automatically injects each upstream agent's output as a labeled context block before calling the synthesizer:

```
=== Output from [LegalAgent] ===
[legal analysis text]

=== Output from [FinancialAgent] ===
[financial analysis text]

=== Output from [MarketAgent] ===
[market analysis text]

=== Your Task ===
[original user task]
```

The synthesizer receives all of this as its prompt. It does not need to name the upstream agents or know how many there are — it just processes whatever labeled reports arrive.

---

### Synthesizer System Prompt — Best Practice

**Generic (reusable for any number of upstream agents, any topic):**

```
You are a synthesis agent. You will receive analysis reports from multiple specialist agents.
Each report is labeled with the name of the agent that produced it.

Your job:
1. Read all provided reports carefully
2. Identify key findings, points of agreement, and conflicts between them
3. Produce a single unified conclusion with clear recommendations

Synthesise everything into one coherent final answer.
```

**Task-specific (clearer structured output for a fixed domain):**

```
You are a business proposal evaluator. You will receive three specialist reports:
a Legal risk analysis, a Financial viability analysis, and a Market opportunity analysis.

Combine all three into one executive summary with:
- Overall recommendation (Proceed / Proceed with conditions / Reject)
- Top 3 risks and Top 3 opportunities
- Suggested next steps
```

**Which to use:** Generic is more reusable and works with any pipeline. Task-specific gives more structured, predictable output when the domain is fixed.

---

### Specialist Agent System Prompts — Best Practice

Each specialist agent should be **tightly focused on one domain**:

```
You are a Legal Risk Analyst. When given a business proposal or task, identify:
- Regulatory compliance issues
- Contractual risks and liability exposure
- Intellectual property concerns

Output a structured legal risk report. Be concise and specific.
```

The specialist **does NOT need to know** about the other specialists or the synthesizer. It just does its job and returns output. The pipeline handles everything else.

---

### Step-by-Step: Create a Coordinator Setup

**1. Create each specialist agent in "My Agents":**
- Focused system prompt for one domain (Legal, Financial, Market, etc.)
- Clear name — this appears as the label in `=== Output from [Name] ===` context blocks
- Clear description — what domain it covers

**2. Create a synthesizer agent in "My Agents":**
- System prompt that expects multiple labeled reports as input
- Generic phrasing — does NOT hard-code the upstream agent names
- Name it clearly: `SynthesisAgent`, `Evaluator`, `FinalReporter`, etc.

**3. Create a pipeline in "Pipelines":**
- Add all specialist nodes + the synthesizer node
- Draw edges: each specialist → synthesizer
- No edges between specialists (they run in parallel)

```
LegalAgent ──┐
              ├──→ SynthesisAgent
FinancialAgent┤
              │
MarketAgent ──┘
```

**4. Run the pipeline:**
- All specialists run simultaneously (Layer 0)
- Synthesizer runs after all specialists finish (Layer 1)
- Synthesizer receives all outputs automatically — no extra configuration needed

---

### What the Agent's `name` Field Does Here

In the Coordinator pattern, each agent's `name` becomes the label in the context injection:

```
=== Output from [LegalAgent] ===
```

The synthesizer sees this label and can use it to understand the source. Name your specialist agents clearly and descriptively — it directly affects the quality of the synthesizer's context.

---

### Coordinator vs Orchestrator — Agent Discovery Comparison

| | Coordinator | Orchestrator |
|---|---|---|
| How it learns about agents | Context injection — outputs arrive labeled automatically | `{{AGENT_ROSTER}}` in system prompt, injected at runtime |
| Who decides which agents run | You (pipeline edges, fixed at design time) | Claude (at runtime, adapts to the task) |
| Does synthesizer need agent names? | No — labels come from `buildNodePrompt` automatically | Yes — must call `CALL_AGENT(name, ...)` by name |
| Setup | Create agents + pipeline topology | Create agents + one Orchestrator agent |
| Already built? | Yes — `usePipelineRunner.ts` | Future implementation |

---

## 8. Who Creates the Orchestrator & How It Knows Your Agents

### Who Creates the Orchestrator

The Orchestrator is **not a built-in component of the app**. You create it yourself as a regular agent in the "My Agents" tab — the same way you create any other `AgentConfig`. The only difference is its system prompt: instead of doing a specific job, it describes the available sub-agents and tells Claude how to coordinate them.

No special UI, no special Rust code — just a well-written system prompt.

---

### Two Approaches for Telling the Orchestrator About Your Agents

#### Option A — Static (simple, manual)

When creating the Orchestrator agent in the UI, you type the names and descriptions of all your other agents directly into the system prompt:

```
You are an Orchestrator agent. You have access to these sub-agents:
- CodeReviewer: reviews TypeScript/React code for bugs and best practices
- DocWriter: writes clear Markdown documentation for any function or module
- TestGenerator: generates Jest unit tests for TypeScript functions

When given a task:
1. Analyse what is needed
2. Decide which agents to call and in what order
3. Issue calls using: CALL_AGENT(AgentName, "your instruction")
4. Wait for each result before deciding the next step
5. Return a final synthesised answer
```

**Drawback:** Every time you add, remove, or rename an agent, you must manually edit the Orchestrator's system prompt.

---

#### Option B — Dynamic Injection (Best Practice)

Store only a **template** in the Orchestrator's system prompt with the placeholder `{{AGENT_ROSTER}}`. The runner replaces this placeholder with the live agent list at runtime, before the first Claude call.

**Orchestrator system prompt stored in the app:**

```
You are an Orchestrator agent.

{{AGENT_ROSTER}}

When given a task:
1. Analyse what is needed
2. Decide which agents to call and in what order
3. Issue calls using: CALL_AGENT(AgentName, "your instruction")
4. Wait for each result before deciding the next step
5. Return a final synthesised answer when done
```

**`useOrchestratorRunner` builds and injects the roster at runtime (`src/utils/orchestrator.ts`):**

```typescript
function buildAgentRoster(agents: AgentConfig[], orchestratorId: string): string {
  const subAgents = agents.filter(a => a.id !== orchestratorId);
  const lines = subAgents.map(a => {
    // Use description if set, fall back to first line of systemPrompt
    const desc = a.description.trim() || a.systemPrompt.split('\n')[0].trim();
    return `- ${a.name}: ${desc}`;
  });
  return `You have access to these sub-agents:\n${lines.join('\n')}`;
}

// In useOrchestratorRunner, before the first ACP call:
const finalSystemPrompt = orchestrator.systemPrompt.replace(
  '{{AGENT_ROSTER}}',
  buildAgentRoster(agents, orchestrator.id)
);
```

**Why this is best practice:**

| Benefit | Explanation |
|---------|------------|
| Auto-updates | Any new agent you create automatically appears in the roster on the next run |
| No manual edits | You never need to touch the Orchestrator's system prompt after setup |
| Works for any scale | One Orchestrator handles 3 agents or 30 agents without changes |
| Single source of truth | Agent names and descriptions live in `AgentConfig`, not repeated in the prompt |

---

### Which `AgentConfig` Fields Are Used

From `src/types/agent.ts`:

| Field | Role in Orchestration |
|-------|-----------------------|
| `id` | Excludes the Orchestrator itself from its own roster |
| `name` | What the Orchestrator uses in `CALL_AGENT(name, ...)` — **must be unique** |
| `description` | Shown in the roster — keep it short and action-oriented |
| `systemPrompt` | First line used as fallback if `description` is empty |

**Important:** The agent's `name` in `AgentConfig` must exactly match the name used in `CALL_AGENT(...)`. If your agent is named `"Code Reviewer"` but the Orchestrator calls `CALL_AGENT(CodeReviewer, ...)`, it will fail to find the agent.

---

### Step-by-Step: Create Your Orchestrator

1. Go to **My Agents → Create Agent**
2. **Name:** `Orchestrator`
3. **Description:** `Routes tasks to the right sub-agents and synthesises the results`
4. **System Prompt:** paste the Option B template with `{{AGENT_ROSTER}}`
5. **Save** — it is now a standard agent in your app
6. When `useOrchestratorRunner` runs, it replaces `{{AGENT_ROSTER}}` with the live list of all other agents automatically

All of your other custom agents (CodeReviewer, DocWriter, etc.) need only two things filled in:
- A clear **Name** (used in `CALL_AGENT`)
- A clear **Description** (shown in the roster so the Orchestrator knows when to use them)

---

## 9. Where This Fits in the App Architecture

```
Current (Static Pipeline):
  You define graph → usePipelineRunner executes → fixed order

Coordinator Pattern (already built):
  You define fan-out edges → usePipelineRunner runs parallel layer → synthesizer collects

Orchestrator Pattern (future):
  useOrchestratorRunner → ACP session for Orchestrator agent
       ↓ (parse CALL_AGENT response)
  ACP session for sub-agent
       ↓ (feed output back)
  ACP session for Orchestrator again
       ↓ (repeat until done)
  Final answer
```

### New Files Needed for Orchestrator

| File | Purpose |
|------|---------|
| `src/utils/orchestrator.ts` | `parseOrchestratorResponse()` — extract CALL_AGENT instructions |
| `src/hooks/useOrchestratorRunner.ts` | ReAct loop — Orchestrator ↔ sub-agent sessions |
| `src/components/pipelines/OrchestratorRunner.tsx` | UI showing the reasoning steps live |

The `AgentConfig` and ACP session infrastructure is already fully reusable — no Rust changes needed.

---

## 10. Comparison: All Three Patterns

```
Static Pipeline:
  [A] → [B] → [C]               fixed, predictable, you control the flow

Coordinator:
  [A] ↘
  [B] → [Synthesizer]            parallel, same task, collect and merge
  [C] ↗

Orchestrator:
  [Orchestrator] → thinks → calls [A]
                 → thinks → calls [B]
                 → thinks → calls [A] again (retry)
                 → done                      adaptive, Claude controls the flow
```

| Pattern | Best For |
|---------|---------|
| **Static Pipeline** | Known workflows, reproducible steps |
| **Coordinator** | Multi-perspective analysis, parallel research |
| **Orchestrator** | Complex unknown tasks, adaptive workflows, research agents |

---

## 11. ReAct Loop — Deeper Explanation

ReAct stands for **Reason + Act**. It is the core mechanism that makes Orchestrators intelligent.

```
Round 1:
  Input:  "Write a verified article about AI"
  Reason: "I need research first"
  Act:    CALL_AGENT(Researcher, "AI trends 2025")

Round 2:
  Input:  [original task] + [Researcher output]
  Reason: "The research has some claims I should verify"
  Act:    CALL_AGENT(Fact-Checker, "verify: [claims]")

Round 3:
  Input:  [original task] + [Researcher output] + [Fact-Checker output]
  Reason: "I have enough. Time to write the article."
  Act:    CALL_AGENT(Publisher, "write article using [all context]")

Round 4:
  Input:  [original task] + [all outputs]
  Reason: "The article is ready."
  Act:    (none — return final answer)
```

Each round the Orchestrator sees the full conversation history and decides the next step. This is exactly how humans manage complex projects — one step at a time, using previous results to inform next actions.

---

## 12. Open Questions for Future Development

1. **Max loop limit** — How many ReAct rounds before forcing termination? (prevent infinite loops)
2. **Parallel sub-calls** — Can the Orchestrator issue multiple `CALL_AGENT` at once? (fan-out within orchestration)
3. **Error recovery** — If a sub-agent fails, does the Orchestrator retry or pick a different agent?
4. **Structured output** — Should `CALL_AGENT` be JSON instead of a custom format? More reliable parsing.
5. **Orchestrator visibility** — Show the full reasoning trace in the UI so the user can follow what the Orchestrator is thinking.
