use tauri::Manager;

mod acp;
mod agents;
mod pipelines;
mod projects;
mod tasks;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(acp::state::AcpState::new())
        .invoke_handler(tauri::generate_handler![
            // ── ACP: single-agent (existing) ──────────────────────────────
            acp::commands::acp_initialize,
            acp::commands::acp_send_prompt,
            acp::commands::acp_cancel,
            acp::commands::acp_shutdown,
            acp::commands::acp_is_active,
            // ── ACP: multi-session (pipeline) ─────────────────────────────
            acp::commands::acp_initialize_session,
            acp::commands::acp_send_prompt_session,
            acp::commands::acp_shutdown_session,
            acp::commands::acp_is_active_session,
            // ── Agents ────────────────────────────────────────────────────
            agents::commands::agent_list,
            agents::commands::agent_create,
            agents::commands::agent_update,
            agents::commands::agent_delete,
            agents::commands::agent_list_for_project,
            // ── Pipelines ─────────────────────────────────────────────────
            pipelines::commands::pipeline_list,
            pipelines::commands::pipeline_create,
            pipelines::commands::pipeline_update,
            pipelines::commands::pipeline_delete,
            // ── Tasks ─────────────────────────────────────────────────────
            tasks::commands::task_save,
            tasks::commands::task_list,
            tasks::commands::task_clear,
            // ── Projects ──────────────────────────────────────────────────
            projects::commands::project_list,
            projects::commands::project_add,
            projects::commands::project_remove,
        ])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                let app = window.app_handle().clone();
                let state = app.state::<acp::state::AcpState>();
                let sessions_arc = state.sessions.clone();
                tauri::async_runtime::spawn(async move {
                    let mut guard = sessions_arc.write().await;
                    for (_, mut inner) in guard.drain() {
                        inner.reader_handle.abort();
                        drop(inner.stdin);
                        let _ = inner.child.kill().await;
                    }
                });
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
