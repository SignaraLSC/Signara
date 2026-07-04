import { Component } from 'react'

/**
 * Última barrera ante errores de render no capturados. Sin esto, cualquier
 * excepción en un componente (p. ej. un fallo de Three.js o MediaPipe)
 * deja la pantalla en blanco sin explicación para el usuario.
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch(error, info) {
    console.error('[ErrorBoundary]', error, info?.componentStack)
  }

  handleReload = () => {
    this.setState({ hasError: false })
    window.location.hash = ''
    window.location.reload()
  }

  render() {
    if (!this.state.hasError) return this.props.children

    return (
      <div className="flex min-h-screen w-full items-center justify-center bg-pastel-cream p-6">
        <div className="max-w-sm rounded-2xl border-2 border-pastel-blue-line bg-white p-6 text-center shadow-xl">
          <p className="text-3xl">😵</p>
          <p className="mt-3 text-lg font-extrabold text-pastel-ink">Algo salió mal</p>
          <p className="mt-2 text-sm font-semibold text-pastel-sub">
            Ocurrió un error inesperado. Intenta recargar la página.
          </p>
          <button
            type="button"
            onClick={this.handleReload}
            className="mt-4 inline-flex h-11 items-center justify-center rounded-xl bg-pastel-grape px-5 text-sm font-bold text-white transition hover:brightness-110"
          >
            Recargar
          </button>
        </div>
      </div>
    )
  }
}
