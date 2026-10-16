import { useState } from 'react'
import { useAuth } from '../auth/useAuth.js'

function loginErrorMessage(err) {
  switch (err?.status) {
    case 401:
      return 'Invalid email or password.'
    case 400:
      return 'Please enter your email and password.'
    default:
      return "Couldn't sign in right now. Please try again."
  }
}

export default function LoginPage() {
  const { login } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    if (loading) return
    setError('')
    setLoading(true)
    try {
      await login(email.trim(), password)
      // Success: RedirectIfAuthed sends the user on.
    } catch (err) {
      setError(loginErrorMessage(err))
      setLoading(false)
    }
  }

  return (
    <main className="page">
      <form className="card" onSubmit={handleSubmit}>
        <h1>SCMTS sign in</h1>
        <label>
          Email
          <input
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            disabled={loading}
          />
        </label>
        <label>
          Password
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            disabled={loading}
          />
        </label>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" disabled={loading}>
          {loading ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </main>
  )
}
