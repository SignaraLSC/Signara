export const TRANSLATE_TUTORIAL_STEPS = [
  {
    target: null,
    title: 'Modo Traducir',
    body: 'Convierte lo que escribes o dices en lengua de señas. Un avatar interpretará cada seña por ti.',
    icon: 'sign',
  },
  {
    target: 'translate-language',
    title: 'Idioma de entrada',
    body: 'Elige en qué idioma hablas o escribes. Signara lo pasa a español y luego a señas.',
    icon: 'globe',
  },
  {
    target: 'translate-input',
    title: 'Escribe o habla',
    body: 'Elige la pestaña Escribir o Hablar. Con voz, el avatar señará palabra a palabra en tiempo real.',
    icon: 'pencil',
  },
  {
    target: 'translate-examples',
    title: 'Prueba al instante',
    body: 'Toca un ejemplo para ver cómo funciona sin escribir nada.',
    icon: 'zap',
  },
  {
    target: 'translate-avatar',
    title: 'Mira las señas aquí',
    body: 'A la derecha, el avatar reproduce cada seña en orden.',
    icon: 'eye',
  },
]

export const INTERPRET_TUTORIAL_STEPS = [
  {
    target: null,
    title: 'Modo Interpretar',
    body: 'Muestra señas a la cámara y Signara las convertirá en texto (y voz, si lo activas).',
    icon: 'camera',
  },
  {
    target: 'interpret-camera',
    title: 'Tu cámara',
    body: 'Signara te pedirá permiso antes de usar la cámara. Si lo concedes, colócate con buena luz y manos visibles.',
    icon: 'bulb',
  },
  {
    target: 'interpret-language',
    title: 'Selecciona el idioma',
    body: 'A la derecha, encima de «Última seña», elige el idioma de salida. La seña se reconoce en español y luego se traduce.',
    icon: 'globe',
  },
  {
    target: 'interpret-start',
    title: 'Empieza la detección',
    body: 'Pulsa «Empezar a interpretar» cuando estés listo. Activa «Voz alta» si quieres escuchar cada seña en el idioma elegido.',
    icon: 'play',
  },
  {
    target: 'interpret-results',
    title: 'Última seña detectada',
    body: 'Aquí aparece la seña reconocida (ya traducida al idioma que elegiste) con su nivel de confianza.',
    icon: 'target',
  },
  {
    target: 'interpret-history',
    title: 'Historial y conversación',
    body: 'Aquí verás la lista de señas que hayas hecho durante la sesión.',
    icon: 'pencil',
  },
]
