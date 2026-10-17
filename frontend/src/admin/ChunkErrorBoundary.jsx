import { Component } from 'react'
import AdminLayout from './AdminLayout.jsx'

// Catches only failed page-chunk loads (errors named 'ChunkLoadError' by the lazy
// imports in App.jsx) and shows them inside the admin header + nav.
// Any other error is rethrown, so it behaves as before.
export default class ChunkErrorBoundary extends Component {
  state = { error: null }

  static getDerivedStateFromError(error) {
    return { error }
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children
    if (error.name !== 'ChunkLoadError') throw error

    return (
      <AdminLayout title={this.props.title}>
        <div className="admin-page" role="alert">
          <p className="admin-notice admin-notice--error">Could not load this page. Check your connection and reload.</p>
          <div className="admin-actions">
            <button type="button" onClick={() => window.location.reload()}>
              Reload
            </button>
          </div>
        </div>
      </AdminLayout>
    )
  }
}
