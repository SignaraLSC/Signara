export const FLOATING_TUTORIAL_KEY = 'signara-floating-avatar-guide-v1'

export const FLOATING_TUTORIAL_STEPS = [
  { title: 'Elige qué escuchar', body: 'Micrófono: una persona que habla cerca. Play: videos, Teams o Meet que suenan en el PC. Solo se activa una fuente a la vez.' },
  { title: 'Espera a que se ponga rosado', body: 'Play morado y parpadeando: está preparando el reconocimiento. Cuando se ponga rosado, ya escucha. Empieza a hablar o reproduce el video después de ese cambio.' },
  { title: 'Mira la interpretación', body: 'El avatar reproduce las señas disponibles y conserva el contexto de frases como «cómo estás» y «tengo sed». Puede haber un desfase de procesamiento. Evita música o varias voces a la vez.' },
  { title: 'Muévela y cambia su tamaño', body: 'Arrastra el título Signara para moverla sobre otras aplicaciones. Arrastra cualquier borde o esquina para hacerla más grande o más pequeña: el avatar se adapta.' },
  { title: 'Controles de la ventana', body: '— minimiza y permite seguir escuchando. □ abre Signara completa y detiene la entrada de audio. × oculta el widget y detiene la escucha. Puedes recuperarlo desde el icono de Signara en la bandeja de Windows.' },
  { title: 'Pausa cuando quieras', body: 'Pulsa de nuevo el botón activo para detener la escucha. Cambiar de fuente apaga la anterior. Play escucha la salida predeterminada de Windows; comprueba que tu llamada use esa misma salida. El botón ? abre esta guía otra vez.' },
]

export function needsFloatingTutorial() {
  try { return window.localStorage.getItem(FLOATING_TUTORIAL_KEY) !== 'done' } catch { return true }
}

export function rememberFloatingTutorial() {
  try { window.localStorage.setItem(FLOATING_TUTORIAL_KEY, 'done') } catch { /* Almacenamiento opcional. */ }
}
