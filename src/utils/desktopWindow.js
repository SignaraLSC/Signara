export function isTauriDesktop() {
  return typeof window !== 'undefined' && Boolean(window.__TAURI_INTERNALS__)
}

async function currentWindow() {
  if (!isTauriDesktop()) return null
  const { getCurrentWindow } = await import('@tauri-apps/api/window')
  return getCurrentWindow()
}

async function windowByLabel(label) {
  if (!isTauriDesktop()) return null
  const { Window } = await import('@tauri-apps/api/window')
  return Window.getByLabel(label)
}

export async function setDesktopAlwaysOnTop(value) {
  const win = await currentWindow()
  if (win) await win.setAlwaysOnTop(Boolean(value))
}

export async function setDesktopClickThrough(value) {
  const win = await currentWindow()
  if (win) await win.setIgnoreCursorEvents(Boolean(value))
}

export async function startDesktopDrag() {
  const win = await currentWindow()
  if (win) await win.startDragging()
}

export async function startDesktopResize(direction) {
  const win = await currentWindow()
  if (win) await win.startResizeDragging(direction)
}

export async function hideDesktopWindow() {
  const win = await currentWindow()
  if (win) await win.hide()
}

export async function minimizeDesktopWindow() {
  const win = await currentWindow()
  if (win) await win.minimize()
}

export async function resizeDesktopWindow(width, height) {
  const win = await currentWindow()
  if (!win) return false
  const { LogicalSize } = await import('@tauri-apps/api/dpi')
  await win.setSize(new LogicalSize(width, height))
  return true
}

export async function showDesktopOverlayWindow() {
  const win = await windowByLabel('overlay')
  if (!win) return false
  // Mostrarlo siempre vuelve a habilitar la interacción. Así el modo
  // click-through nunca deja al usuario atrapado fuera del widget.
  await win.setIgnoreCursorEvents(false)
  await win.unminimize()
  await win.show()
  await win.setFocus()
  return true
}

export async function showDesktopInterpretOverlayWindow() {
  const win = await windowByLabel('interpret-overlay')
  if (!win) return false
  await win.setIgnoreCursorEvents(false)
  await win.unminimize()
  await win.show()
  await win.setFocus()
  return true
}

export async function showDesktopMainWindow() {
  const win = await windowByLabel('main')
  if (!win) return false
  await win.unminimize()
  await win.show()
  await win.setFocus()
  return true
}
