use tauri::Manager;

mod acp;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(acp::state::AcpState::new())
        .invoke_handler(tauri::generate_handler![
            acp::commands::acp_initialize,
            acp::commands::acp_send_prompt,
            acp::commands::acp_cancel,
            acp::commands::acp_shutdown,
        ])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                let app = window.app_handle().clone();
                let state = app.state::<acp::state::AcpState>();
                let inner_arc = state.inner.clone();
                tauri::async_runtime::spawn(async move {
                    let mut guard = inner_arc.write().await;
                    if let Some(mut inner) = guard.take() {
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
