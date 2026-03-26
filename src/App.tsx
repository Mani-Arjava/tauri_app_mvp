import { useState } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { AgentList } from "@/components/agents/AgentList";
import { ProjectList } from "@/components/projects/ProjectList";
import { ProjectDetail } from "@/components/projects/ProjectDetail";
import { useAgents } from "@/hooks/useAgents";
import { useProjects } from "@/hooks/useProjects";

export function App(): React.JSX.Element {
  const { agents, isLoading, error, createAgent, updateAgent, deleteAgent } = useAgents();
  const { projects: registeredProjects, addProject, refreshProjects } = useProjects();

  // Merge registered projects with paths derived from existing project-scoped agents.
  // This ensures agents created before the project registry existed still appear.
  const agentProjects = agents
    .filter((a) => a.scope === "project" && a.projectPath)
    .map((a) => a.projectPath!);
  const projects = [...new Set([...registeredProjects, ...agentProjects])].sort();
  const [selectedProject, setSelectedProject] = useState<string | null>(null);

  // After creating a project-scoped agent, refresh the projects list so the
  // new project path auto-appears in the Projects tab without a page reload.
  const handleCreateAgent = async (config: Parameters<typeof createAgent>[0]) => {
    const created = await createAgent(config);
    if (created.scope === "project" && created.projectPath) {
      await refreshProjects();
    }
    return created;
  };

  return (
    <div className="h-screen flex flex-col">
      <Tabs defaultValue="agents" className="flex flex-col flex-1">
        <header className="border-b px-6 py-3 flex items-center justify-between shrink-0">
          <h1 className="text-lg font-semibold">Agent Creator</h1>
          <TabsList>
            <TabsTrigger value="agents">My Agents</TabsTrigger>
            <TabsTrigger value="projects" onClick={() => setSelectedProject(null)}>
              Projects
            </TabsTrigger>
          </TabsList>
        </header>

        <TabsContent value="agents" className="flex-1 overflow-auto p-6 mt-0">
          <AgentList
            agents={agents}
            isLoading={isLoading}
            error={error}
            createAgent={handleCreateAgent}
            updateAgent={updateAgent}
            deleteAgent={deleteAgent}
          />
        </TabsContent>

        <TabsContent value="projects" className="flex-1 overflow-auto p-6 mt-0">
          {selectedProject ? (
            <ProjectDetail
              projectPath={selectedProject}
              agents={agents}
              createAgent={handleCreateAgent}
              updateAgent={updateAgent}
              deleteAgent={deleteAgent}
              onBack={() => setSelectedProject(null)}
            />
          ) : (
            <ProjectList
              projects={projects}
              agents={agents}
              onSelect={setSelectedProject}
              onAdd={addProject}
            />
          )}
        </TabsContent>


      </Tabs>
    </div>
  );
}
