import { lazy, Suspense, type CSSProperties } from 'react'

const SimulatorApp = lazy(() =>
  import('./components/sim/SimulatorApp').then((module) => ({
    default: module.SimulatorApp,
  })),
)

const loadingShellStyle: CSSProperties = {
  minHeight: '100vh',
  display: 'grid',
  placeItems: 'center',
  padding: '40px 24px',
  textAlign: 'center',
}

const loadingCardStyle: CSSProperties = {
  maxWidth: '40rem',
  padding: '2rem 2.25rem',
  borderRadius: '1.75rem',
  border: '1px solid var(--edge-soft)',
  background: 'rgba(251, 244, 231, 0.86)',
  boxShadow: 'var(--shadow-soft)',
}

const loadingKickerStyle: CSSProperties = {
  margin: '0 0 0.75rem',
  textTransform: 'uppercase',
  letterSpacing: '0.18em',
  fontSize: '0.72rem',
  color: 'var(--text-muted)',
}

function AppLoadingShell() {
  return (
    <main style={loadingShellStyle}>
      <section aria-busy="true" aria-live="polite" style={loadingCardStyle}>
        <p style={loadingKickerStyle}>Loading simulator</p>
        <h1>Paraglide the World</h1>
        <p>
          Preparing the flight session, world renderer, and control systems.
        </p>
      </section>
    </main>
  )
}

function App() {
  return (
    <Suspense fallback={<AppLoadingShell />}>
      <SimulatorApp />
    </Suspense>
  )
}

export default App
