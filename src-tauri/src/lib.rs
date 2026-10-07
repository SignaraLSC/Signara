use tauri::{
  menu::{Menu, MenuItem},
  tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
  Manager,
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }

      let show_overlay = MenuItem::with_id(app, "show_overlay", "Mostrar avatar", true, None::<&str>)?;
      let show_interpret = MenuItem::with_id(app, "show_interpret", "Mostrar cámara", true, None::<&str>)?;
      let interact = MenuItem::with_id(app, "interact", "Volver a interactuar", true, None::<&str>)?;
      let open_main = MenuItem::with_id(app, "open_main", "Abrir Signara", true, None::<&str>)?;
      let hide_overlay = MenuItem::with_id(app, "hide_overlay", "Ocultar avatar", true, None::<&str>)?;
      let hide_interpret = MenuItem::with_id(app, "hide_interpret", "Ocultar cámara", true, None::<&str>)?;
      let quit = MenuItem::with_id(app, "quit", "Salir", true, None::<&str>)?;
      let menu = Menu::with_items(app, &[&show_overlay, &show_interpret, &interact, &open_main, &hide_overlay, &hide_interpret, &quit])?;

      TrayIconBuilder::new()
        .icon(app.default_window_icon().expect("Signara necesita un icono").clone())
        .tooltip("Signara — avatar LSC")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
          "show_overlay" | "interact" => {
            if let Some(window) = app.get_webview_window("overlay") {
              let _ = window.set_ignore_cursor_events(false);
              let _ = window.show();
              let _ = window.set_focus();
            }
          }
          "hide_overlay" => {
            if let Some(window) = app.get_webview_window("overlay") {
              let _ = window.hide();
            }
          }
          "show_interpret" => {
            if let Some(window) = app.get_webview_window("interpret-overlay") {
              let _ = window.set_ignore_cursor_events(false);
              let _ = window.show();
              let _ = window.set_focus();
            }
          }
          "hide_interpret" => {
            if let Some(window) = app.get_webview_window("interpret-overlay") {
              let _ = window.hide();
            }
          }
          "open_main" => {
            if let Some(window) = app.get_webview_window("main") {
              let _ = window.unminimize();
              let _ = window.show();
              let _ = window.set_focus();
            }
          }
          "quit" => app.exit(0),
          _ => {}
        })
        .on_tray_icon_event(|tray, event| {
          if let TrayIconEvent::Click {
            button: MouseButton::Left,
            button_state: MouseButtonState::Up,
            ..
          } = event
          {
            let app = tray.app_handle();
            if let Some(window) = app.get_webview_window("overlay") {
              let _ = window.set_ignore_cursor_events(false);
              let _ = window.show();
              let _ = window.set_focus();
            }
          }
        })
        .build(app)?;
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while building tauri application");
}
