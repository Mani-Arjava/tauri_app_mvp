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

## 7. Where This Fits in the App Architecture

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

## 8. Comparison: All Three Patterns

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

## 9. ReAct Loop — Deeper Explanation

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

## 10. Open Questions for Future Development

1. **Max loop limit** — How many ReAct rounds before forcing termination? (prevent infinite loops)
2. **Parallel sub-calls** — Can the Orchestrator issue multiple `CALL_AGENT` at once? (fan-out within orchestration)
3. **Error recovery** — If a sub-agent fails, does the Orchestrator retry or pick a different agent?
4. **Structured output** — Should `CALL_AGENT` be JSON instead of a custom format? More reliable parsing.
5. **Orchestrator visibility** — Show the full reasoning trace in the UI so the user can follow what the Orchestrator is thinking.
