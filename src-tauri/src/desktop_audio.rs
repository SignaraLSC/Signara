use std::{
    collections::VecDeque,
    io::{BufRead, BufReader, Write},
    path::PathBuf,
    process::{Child, Command, Stdio},
    sync::{Arc, Condvar, Mutex},
    time::{Duration, Instant},
};
use tauri::{Manager, State, WebviewWindow};

#[derive(Default)]
struct Session {
    id: u64,
    worker_id: u64,
    active: bool,
    paused: u64,
    child: Option<Child>,
    sequence: u64,
    events: VecDeque<serde_json::Value>,
}

impl Session {
    fn publish(&mut self, mut event: serde_json::Value) {
        self.sequence += 1;
        event["session"] = self.id.into();
        event["sequence"] = self.sequence.into();
        self.events.push_back(event);
        // Solo memoria de la sesión activa; nunca guardar conversaciones.
        if self.events.len() > 128 { self.events.pop_front(); }
    }

    fn read_since(&self, after: u64) -> Result<Vec<serde_json::Value>, String> {
        if self.events.front().and_then(|event| event["sequence"].as_u64())
            .is_some_and(|first| after.saturating_add(1) < first) {
            return Err("La conexión con el avatar perdió resultados. Vuelve a activar play.".into());
        }
        Ok(self.events.iter().filter(|event| event["sequence"].as_u64().unwrap_or(0) > after).cloned().collect())
    }
}

fn terminate(mut child: Child) {
    // Cerrar la tubería también detiene el Python real detrás del redirector
    // de un venv Windows, no solamente su proceso lanzador.
    drop(child.stdin.take());
    let _ = child.kill();
    let _ = child.wait();
}

#[derive(Default)]
struct Shared {
    session: Mutex<Session>,
    changed: Condvar,
}

#[derive(Clone, Default)]
pub struct DesktopAudio(Arc<Shared>);

impl DesktopAudio {
    pub fn shutdown(&self) {
        if let Ok(mut session) = self.0.session.lock() {
            if let Some(child) = session.child.take() {
                terminate(child);
            }
            session.active = false;
            session.events.clear();
            self.0.changed.notify_all();
        }
    }

    pub fn stop(&self) {
        let id = self.0.session.lock().map(|session| session.id).unwrap_or(0);
        let _ = pause_worker(self, id);
    }

    pub fn prepare(&self, window: &WebviewWindow) {
        // Solo cargar el motor. No enviar START ni abrir dispositivos.
        if let Err(error) = ensure_worker(window, self) {
            log::warn!("No se pudo precargar audio local: {error}");
        }
    }
}

fn overlay_only(window: &WebviewWindow) -> Result<(), String> {
    if window.label() != "overlay" {
        return Err("El audio del PC solo está disponible en el avatar flotante.".into());
    }
    Ok(())
}

fn runtime(window: &WebviewWindow) -> Result<(PathBuf, PathBuf), String> {
    let development = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../desktop_audio");
    let bundled = window.app_handle().path().resource_dir()
        .map_err(|error| error.to_string())?.join("desktop_audio");
    let root = if cfg!(debug_assertions) { development } else { bundled };
    let worker = root.join("worker.py");
    let python = std::env::var_os("SIGNARA_AUDIO_PYTHON")
        .map(PathBuf::from).unwrap_or_else(|| root.join("venv/Scripts/python.exe"));
    if !worker.is_file() || !python.is_file() {
        return Err("Prepara el audio local ejecutando npm run desktop:audio:setup. En una instalación, configura SIGNARA_AUDIO_PYTHON con el Python del entorno de audio.".into());
    }
    Ok((python, worker))
}

#[tauri::command]
pub fn start_system_audio(
    window: WebviewWindow,
    state: State<'_, DesktopAudio>,
) -> Result<u64, String> {
    overlay_only(&window)?;
    if !cfg!(target_os = "windows") {
        return Err("La captura del PC requiere Windows.".into());
    }
    ensure_worker(&window, state.inner())?;
    let mut session = state.0.session.lock().map_err(|error| error.to_string())?;
    session.id += 1;
    let id = session.id;
    session.active = true;
    session.sequence = 0;
    session.events.clear();
    session.publish(serde_json::json!({"type":"status", "state":"loading"}));
    if let Err(error) = send_command(&mut session, "start", id) {
        session.active = false;
        return Err(error);
    }
    Ok(id)
}

fn ensure_worker(window: &WebviewWindow, state: &DesktopAudio) -> Result<u64, String> {
    let (python, worker) = runtime(window)?;
    let mut command = Command::new(python);
    command.arg("-u").arg(worker).arg("--resident")
        .arg("--parent-pid").arg(std::process::id().to_string());
    spawn_worker(state, command)
}

fn send_command(session: &mut Session, action: &str, id: u64) -> Result<(), String> {
    let input = session.child.as_mut().and_then(|child| child.stdin.as_mut())
        .ok_or("El motor local de audio no está disponible.")?;
    let message = format!("{}\n", serde_json::json!({"action":action, "session":id}));
    input.write_all(message.as_bytes()).and_then(|_| input.flush())
        .map_err(|error| format!("No se pudo controlar la captura: {error}"))
}

fn pause_worker(state: &DesktopAudio, id: u64) -> Result<(), String> {
    let mut session = state.0.session.lock().map_err(|error| error.to_string())?;
    if session.id != id || !session.active { return Ok(()); }
    // Descartar resultados tardíos inmediatamente; PAUSED confirma cierre real.
    session.active = false;
    session.events.clear();
    if let Err(error) = send_command(&mut session, "pause", id) {
        if let Some(child) = session.child.take() { terminate(child); }
        return Err(error);
    }
    let deadline = Instant::now() + Duration::from_secs(4);
    while session.id == id && session.child.is_some() && session.paused < id {
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            // Fallo seguro: nunca mantener el dispositivo abierto sin acuse.
            if let Some(child) = session.child.take() { terminate(child); }
            return Err("La captura no confirmó el cierre; se detuvo el motor por seguridad.".into());
        }
        session = state.0.changed.wait_timeout(session, remaining)
            .map_err(|error| error.to_string())?.0;
    }
    Ok(())
}

fn spawn_worker(state: &DesktopAudio, mut command: Command) -> Result<u64, String> {
    let mut session = state.0.session.lock().map_err(|error| error.to_string())?;
    if let Some(child) = session.child.as_mut() {
        if matches!(child.try_wait(), Ok(None)) { return Ok(session.worker_id); }
    }
    if let Some(previous) = session.child.take() {
        terminate(previous);
        if session.active {
            session.publish(serde_json::json!({"type":"error", "message":"Se interrumpió el motor de audio. Vuelve a pulsar play."}));
            session.active = false;
        }
    }
    command.env("PYTHONIOENCODING", "utf-8")
        .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null());
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }
    let mut child = command.spawn().map_err(|error| format!("No se pudo iniciar el audio: {error}"))?;
    let stdout = child.stdout.take().ok_or("No se pudo conectar la transcripción.")?;
    session.worker_id += 1;
    let worker_id = session.worker_id;
    session.child = Some(child);
    log::info!("Audio PC: motor {worker_id} precargando, sin captura");
    let shared = state.clone();
    std::thread::spawn(move || {
        let mut reported_error = false;
        for line in BufReader::new(stdout).lines() {
            let Ok(line) = line else { break };
            let Ok(event) = serde_json::from_str::<serde_json::Value>(&line) else { continue };
            if !event.is_object() { continue; }
            let Ok(mut session) = shared.0.session.lock() else { break };
            if session.worker_id != worker_id || session.child.is_none() { break; }
            reported_error |= event["type"] == "error";
            if event["state"] == "paused" {
                session.paused = session.paused.max(event["session"].as_u64().unwrap_or(0));
                shared.0.changed.notify_all();
                continue;
            }
            let request = event["session"].as_u64().unwrap_or(0);
            if !session.active || (request != session.id && event["type"] != "error") { continue; }
            // Un error de captura vieja no debe apagar una sesión nueva.
            if request != 0 && request != session.id { continue; }
            // El resultado permanece hasta ser leído por el widget, aunque
            // WebView2 retrase sus callbacks al pasar a otra aplicación.
            log::info!("Audio PC: sesión {}, evento {}, estado {}", session.id, event["type"], event["state"]);
            session.publish(event);
        }
        if let Ok(mut session) = shared.0.session.lock() {
            if session.worker_id == worker_id {
                if let Some(child) = session.child.take() {
                    terminate(child);
                    if session.active && !reported_error {
                        session.publish(serde_json::json!({
                            "type": "error",
                            "message": "Se interrumpió el audio del PC. Vuelve a pulsar play."
                        }));
                    }
                    session.active = false;
                    shared.0.changed.notify_all();
                }
            }
        }
    });
    Ok(worker_id)
}

#[tauri::command]
pub fn read_system_audio_events(window: WebviewWindow, state: State<'_, DesktopAudio>, session_id: u64, after_sequence: u64) -> Result<serde_json::Value, String> {
    overlay_only(&window)?;
    let session = state.0.session.lock().map_err(|error| error.to_string())?;
    if session.id != session_id {
        return Err("La sesión de audio cambió. Vuelve a activar play.".into());
    }
    Ok(serde_json::json!({
        "events": session.read_since(after_sequence)?,
        "running": session.child.is_some() && session.active,
    }))
}

#[tauri::command]
pub fn stop_system_audio(window: WebviewWindow, state: State<'_, DesktopAudio>, session_id: u64) -> Result<(), String> {
    overlay_only(&window)?;
    pause_worker(state.inner(), session_id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn events_are_replayable_and_ordered_without_a_webview_callback() {
        let mut session = Session { id: 7, ..Default::default() };
        session.publish(serde_json::json!({"type":"status", "state":"listening"}));
        session.publish(serde_json::json!({"type":"transcript", "id":1, "text":"hola", "final":true}));
        let events = session.read_since(0).unwrap();
        assert_eq!(events.len(), 2);
        assert_eq!(events[1]["session"], 7);
        assert_eq!(events[1]["sequence"], 2);
        assert_eq!(session.read_since(0).unwrap(), events); // Retry no pierde resultados.
        assert_eq!(session.read_since(1).unwrap().len(), 1);
        assert!(session.read_since(2).unwrap().is_empty());
    }

    #[test]
    fn slow_consumers_fail_explicitly_instead_of_skipping_speech() {
        let mut session = Session::default();
        for _ in 0..129 { session.publish(serde_json::json!({"type":"status"})); }
        assert_eq!(session.events.len(), 128);
        assert!(session.read_since(0).is_err());
        assert_eq!(session.read_since(1).unwrap().len(), 128);
    }

    #[test]
    #[ignore = "Prueba local de tuberías Windows; requiere desktop_audio/venv"]
    fn windows_child_protocol_reaches_the_same_session_buffer_used_by_the_widget() {
        let state = DesktopAudio::default();
        let python = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../desktop_audio/venv/Scripts/python.exe");
        let mut command = Command::new(python);
        command.arg("-u").arg("-c").arg("import json,sys; print(json.dumps({'type':'status','session':0,'state':'prepared'}));\nfor line in sys.stdin:\n c=json.loads(line); s=c['session']; a=c['action']; print(json.dumps({'type':'status','session':s,'state':'listening' if a=='start' else 'paused'}));\n if a=='start': print(json.dumps({'type':'transcript','session':s,'id':1,'text':'Hola, como estas. Bien. Gracias.','final':True}))");
        let worker_id = spawn_worker(&state, command).unwrap();
        let id = 1;
        {
            let mut session = state.0.session.lock().unwrap();
            session.id = id;
            session.active = true;
            send_command(&mut session, "start", id).unwrap();
        }
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(4);
        loop {
            let session = state.0.session.lock().unwrap();
            let events = session.read_since(0).unwrap();
            if events.len() >= 2 {
                assert_eq!(session.id, id);
                assert_eq!(events[1]["type"], "transcript");
                assert_eq!(events[1]["text"], "Hola, como estas. Bien. Gracias.");
                break;
            }
            drop(session);
            assert!(std::time::Instant::now() < deadline, "El protocolo nativo no entregó la frase");
            std::thread::sleep(std::time::Duration::from_millis(20));
        }
        state.stop();
        {
            let session = state.0.session.lock().unwrap();
            assert!(!session.active);
            assert!(session.child.is_some());
            assert_eq!(session.worker_id, worker_id); // Pausar NO recarga el motor.
            assert!(session.events.is_empty());
        }
        {
            let mut session = state.0.session.lock().unwrap();
            session.id = 2;
            session.active = true;
            session.sequence = 0;
            send_command(&mut session, "start", 2).unwrap();
        }
        let deadline = Instant::now() + Duration::from_secs(2);
        loop {
            let session = state.0.session.lock().unwrap();
            if session.events.len() >= 2 {
                assert_eq!(session.worker_id, worker_id);
                assert_eq!(session.events[1]["session"], 2);
                assert_eq!(session.events[1]["id"], 1);
                break;
            }
            drop(session);
            assert!(Instant::now() < deadline, "El motor no reanudó la captura");
            std::thread::sleep(Duration::from_millis(10));
        }
        state.shutdown();
        assert!(state.0.session.lock().unwrap().child.is_none());
    }
}
