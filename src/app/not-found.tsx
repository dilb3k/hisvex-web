import Link from 'next/link'

export default function NotFound() {
  return (
    <div style={{
      minHeight: '100dvh',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: '#070512', color: '#fff', textAlign: 'center', padding: 24,
    }}>
      <div>
        <img src="/logo.png" alt="Hisvex" style={{
          width: 80, height: 80, borderRadius: '50%', objectFit: 'cover',
          margin: '0 auto 24px',
          boxShadow: '0 8px 40px rgba(124,58,237,0.4)',
        }} />
        <h1 style={{ fontSize: 64, fontWeight: 800, color: '#7c3aed', marginBottom: 8 }}>404</h1>
        <p style={{ fontSize: 18, color: 'rgba(255,255,255,0.5)', marginBottom: 32 }}>
          Sahifa topilmadi
        </p>
        <Link href="/" className="notfound-cta" style={{
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
