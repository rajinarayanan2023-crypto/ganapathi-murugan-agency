import { Component } from 'react'
import { AlertTriangle, RotateCcw } from 'lucide-react'

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error('Page crashed:', error, info)
  }

  componentDidUpdate(prevProps) {
    if (this.state.error && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ error: null })
    }
  }

  render() {
    if (this.state.error) {
      const card = (
        <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-rose-200 bg-rose-50 px-6 py-16 text-center">
          <AlertTriangle size={28} className="text-rose-500" />
          <p className="text-sm font-semibold text-slate-800">This page hit an unexpected error.</p>
          <p className="max-w-sm text-xs text-slate-500">{this.state.error.message || 'Something went wrong while rendering this page.'}</p>
          <button
            onClick={() => this.setState({ error: null })}
            className="mt-1 inline-flex items-center gap-1.5 rounded-lg border border-rose-200 bg-white px-3 py-1.5 text-xs font-semibold text-rose-600 transition-colors hover:bg-rose-100"
          >
            <RotateCcw size={13} /> Try again
          </button>
        </div>
      )
      // Only set by the app-root boundary in main.jsx, whose crash means the
      // sidebar/header are gone too — nothing left on screen to give this
      // card room, unlike a per-page boundary, which sits inside `main`
      // where the rest of the shell is already providing that.
      if (this.props.fullScreen) {
        return <div className="flex min-h-screen items-center justify-center bg-white p-6">{card}</div>
      }
      return card
    }
    return this.props.children
  }
}
