'use client'

import { t } from '@/lib/i18n'

/**
 * The one loading screen for the whole app.
 *
 * There used to be three: HydrateProvider's, the dashboard layout's, and a
 * bare row of dots on a flat background in app/page.tsx. Because the route
 * guards hand off between them, a cold load could visibly step through two
 * different "loading" screens before landing anywhere — which reads as the
 * app bouncing between pages. One component means one screen, no matter which
 * guard is currently deciding.
 *
 * Deliberately painted on the same fixed dark ground as the native splashes on
 * desktop and mobile rather than on `--color-bg`: it is shown before the
 * user's theme preference has been read, so a token-driven background would
 * flash the wrong colour and then correct itself.
 */
export function AppSplash() {
  return (
    <div style={{
      height: '100dvh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: '#070512',
      position: 'relative',
      overflow: 'hidden',
    }}>
      <div style={{
        position: 'absolute', inset: 0,
        background: 'linear-gradient(180deg, #070512 0%, #100B30 32%, #0C0820 68%, #070512 100%)',
      }} />
      {/* Ambient light, kept off the edges so no glow ends on a hard arc. */}
      <div style={{
        position: 'absolute', width: 720, height: 720, borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(124,58,237,0.16) 0%, transparent 70%)',
        top: '-260px', right: '-200px',
        animation: 'pulse 3.4s ease-in-out infinite',
      }} />
      <div style={{
        position: 'absolute', width: 620, height: 620, borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(167,139,250,0.10) 0%, transparent 70%)',
        bottom: '-220px', left: '-180px',
        animation: 'pulse 3.4s ease-in-out infinite 1.7s',
      }} />

      <div style={{
        position: 'relative', zIndex: 1,
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        // Optically centred: a stacked lockup reads as sunk when its
        // geometric middle sits exactly on the container's middle.
        transform: 'translateY(-4%)',
      }}>
        <div style={{
          position: 'relative', width: 96, height: 96, marginBottom: 24,
          animation: 'scaleIn 0.5s cubic-bezier(0.16, 1, 0.3, 1)',
        }}>
          {/* Wide, soft halo — depth without a visible circle edge. */}
          <div style={{
            position: 'absolute', inset: '-70%', borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(124,58,237,0.38) 0%, transparent 68%)',
          }} />
          <img src="/logo-256.png" alt="" style={{
            position: 'relative', width: '100%', height: '100%',
            borderRadius: '50%', objectFit: 'cover',
            filter: 'drop-shadow(0 10px 34px rgba(124,58,237,0.45))',
          }} />
        </div>

        <div style={{
          display: 'flex', fontSize: 38, fontWeight: 800, letterSpacing: -1,
          lineHeight: 1, marginBottom: 12,
          animation: 'slideUp 0.5s cubic-bezier(0.16, 1, 0.3, 1) 0.1s both',
        }}>
          <span style={{ color: '#A78BFA' }}>His</span>
          <span style={{ color: '#FFFFFF' }}>vex</span>
        </div>

        {/* The only translated string that exists in the statically exported
            HTML (everything else renders after auth hydration finishes), so
            it is also the only one that can differ between the prerendered
            markup — always Uzbek — and a Russian user's first client render.
            React patches it correctly either way; this just stops it being
            reported as a hydration error in the console. */}
        <div
          suppressHydrationWarning
          style={{
            fontSize: 13, letterSpacing: 0.6, color: 'rgba(196,181,253,0.62)',
            animation: 'slideUp 0.5s cubic-bezier(0.16, 1, 0.3, 1) 0.2s both',
          }}
        >
          {t('splashTagline')}
        </div>

        {/* A single sweeping bar rather than three bouncing dots: it reads as
            "loading" without competing with the wordmark right above it. */}
        <div style={{
          position: 'relative', width: 124, height: 2, marginTop: 30,
          borderRadius: 2, overflow: 'hidden', background: 'rgba(167,139,250,0.12)',
          animation: 'slideUp 0.5s cubic-bezier(0.16, 1, 0.3, 1) 0.3s both',
        }}>
          <div style={{
            position: 'absolute', top: 0, bottom: 0, width: '40%', borderRadius: 2,
            background: 'linear-gradient(90deg, transparent, #7C3AED, #A78BFA, transparent)',
            animation: 'splashSweep 1.35s ease-in-out infinite',
          }} />
        </div>
      </div>

      <style>{`
        @keyframes splashSweep {
          0%   { transform: translateX(-120%); }
          100% { transform: translateX(360%); }
        }
      `}</style>
    </div>
  )
}
