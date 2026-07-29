import Link from 'next/link'

export default function NotFound() {
  return (
    <div style={{
      minHeight: '100dvh',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: '#070512', color: '#fff', textAlign: 'center', padding: 24,
    }}>
      <div>
        <div style={{
          width: 80, height: 80, borderRadius: 20,
          background: 'linear-gradient(135deg, #7c3aed 0%, #a78bfa 100%)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          margin: '0 auto 24px',
          boxShadow: '0 8px 40px rgba(124,58,237,0.4)',
        }}>
          <span style={{ fontSize: 38, fontWeight: 800, color: '#fff' }}>H</span>
        </div>
        <h1 style={{ fontSize: 64, fontWeight: 800, color: '#7c3aed', marginBottom: 8 }}>404</h1>
        <p style={{ fontSize: 18, color: 'rgba(255,255,255,0.5)', marginBottom: 32 }}>
          Sahifa topilmadi
        </p>
        <Link href="/" style={{
          display: 'inline-flex', alignItems: 'center', gap: 8,
          padding: '14px 28px', borderRadius: 12,
          background: 'linear-gradient(135deg, #7c3aed, #a78bfa)',
          color: '#fff', fontSize: 15, fontWeight: 600, textDecoration: 'none',
        }}>
          Bosh sahifaga qaytish
        </Link>
      </div>
    </div>
  )
}
