#[tauri::command]
fn bootstrap_token() -> Option<String> {
    std::env::var("REPLY_PILOT_DESKTOP_BOOTSTRAP_TOKEN")
        .ok()
        .filter(|value| !value.is_empty())
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![bootstrap_token])
        .setup(|app| {
            eprintln!("ReplyPilot setup: creating main window");
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Regular);

            let window = tauri::WebviewWindowBuilder::new(
                app,
                "main",
                tauri::WebviewUrl::App("index.html".into()),
            )
            .title("ReplyPilot")
            .inner_size(156.0, 160.0)
            .position(80.0, 120.0)
            .decorations(false)
            .transparent(true)
            .always_on_top(true)
            .shadow(false)
            .skip_taskbar(true)
            .resizable(false)
            .visible(true)
            .build()?;
            window.show()?;
            window.set_focus()?;
            eprintln!("ReplyPilot setup: main window created");

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
