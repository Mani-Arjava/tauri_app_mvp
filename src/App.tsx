import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { AgentList } from "@/components/agents/AgentList";
import { TaskRunner } from "@/components/tasks/TaskRunner";
import { useAgents } from "@/hooks/useAgents";

export function App(): React.JSX.Element {
  const { agents, isLoading, error, createAgent, updateAgent, deleteAgent } = useAgents();

  return (
    <div className="h-screen flex flex-col">
      <Tabs defaultValue="agents" className="flex flex-col flex-1">
        <header className="border-b px-6 py-3 flex items-center justify-between shrink-0">
          <h1 className="text-lg font-semibold">Agent Creator</h1>
          <TabsList>
            <TabsTrigger value="agents">My Agents</TabsTrigger>
            <TabsTrigger value="tasks">Run Task</TabsTrigger>
          </TabsList>
        </header>
        <TabsContent value="agents" className="flex-1 overflow-auto p-6 mt-0">
          <AgentList
            agents={agents}
            isLoading={isLoading}
            error={error}
            createAgent={createAgent}
            updateAgent={updateAgent}
            deleteAgent={deleteAgent}
          />
        </TabsContent>
        <TabsContent value="tasks" className="flex-1 overflow-auto p-6 mt-0">
          <TaskRunner agents={agents} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
