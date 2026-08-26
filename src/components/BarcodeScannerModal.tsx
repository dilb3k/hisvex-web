'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, Camera, Check, Keyboard, Lightbulb, RotateCw, Scan, SwitchCamera, X } from 'lucide-react'
import { useEscapeToClose } from '@/lib/useEscapeKey'

type Props = {
  open: boolean
  onClose: () => void
  // In autoConfirm mode this return value drives the feedback flash:
  // null/undefined = accepted (green flash), a string = rejected (red
  // flash showing that message). Ignored when autoConfirm is off.
  onBarcodeDetected: (data: string) => string | null | void
  conflictCheck?: (barcode: string) => { conflictName?: string } | null
  onManualInput?: () => void
  closeOnDetect?: boolean
  // POS-speed mode: skip the "tap to accept" confirmation card entirely.
  // Every plausible decode is applied immediately (via onBarcodeDetected's
  // return value for accept/reject feedback) and the camera keeps scanning
  // for the next item — a same-code cooldown prevents one held-up barcode
  // from firing repeatedly while the cashier repositions it.
  autoConfirm?: boolean
  // Optional running total shown in the header while autoConfirm is on,
  // so the cashier gets confidence without having to leave the camera view.
  cartCount?: number
}

const SAME_CODE_COOLDOWN_MS = 1200

// Polling beats requestAnimationFrame here: decoding is the expensive part and
// 60 attempts a second buys nothing a cashier can perceive, while costing
// battery and heating the phone during a long scanning session.
const DECODE_INTERVAL_MS = 120

// Only formats realistically used on retail/product barcodes and price-gun
// labels. Excludes QR, Data Matrix, PDF417, Aztec, etc. so scanning a poster's
// URL QR code doesn't get silently accepted as a product barcode.
const NATIVE_FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39']

/** Why the camera could not start. Each one needs different advice, which is
 *  the whole reason this isn't a single boolean — "kamera ruxsati kerak" is
 *  actively misleading when the real problem is that the page isn't on HTTPS
 *  or another app is holding the camera. */
type CameraError =
  | 'insecure'      // getUserMedia is unavailable outside a secure context
  | 'unsupported'   // browser has no camera API at all
  | 'denied'        // user (or policy) refused permission
  | 'notfound'      // no camera on this device
  | 'inuse'         // camera held by another app/tab
  | 'unknown'

type ScannedCode = { rawValue: string }
type NativeDetector = { detect: (source: CanvasImageSource) => Promise<ScannedCode[]> }
type DetectorCtor = {
  new (opts: { formats: string[] }): NativeDetector
  getSupportedFormats?: () => Promise<string[]>
}

// Basic sanity check on the decoded text, independent of the format hint -
// rejects anything that looks like a URL or is an unreasonable length.
function isPlausibleBarcode(text: string): boolean {
  const trimmed = text.trim()
  if (trimmed.length < 4 || trimmed.length > 48) return false
  if (/^[a-z]+:\/\//i.test(trimmed) || /^www\./i.test(trimmed) || /\s/.test(trimmed)) return false
  return true
}

function classifyCameraError(err: unknown): CameraError {
  const name = (err as { name?: string } | null)?.name ?? ''
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'denied'
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'OverconstrainedError') return 'notfound'
  if (name === 'NotReadableError' || name === 'TrackStartError') return 'inuse'
  return 'unknown'
}

const ERROR_COPY: Record<CameraError, { title: string; body: string; canRetry: boolean }> = {
  insecure: {
    title: 'Kamera faqat HTTPS orqali ishlaydi',
    body: "Brauzer xavfsiz bo'lmagan manzilda kameraga ruxsat bermaydi. Saytni https:// bilan oching yoki shtrixkodni qo'lda kiriting.",
    canRetry: false,
  },
  unsupported: {
    title: "Brauzer kamerani qo'llab-quvvatlamaydi",
    body: "Chrome yoki Safari'ning yangi versiyasidan foydalaning, yoki shtrixkodni qo'lda kiriting.",
    canRetry: false,
  },
  denied: {
    title: 'Kameraga ruxsat berilmagan',
    body: "Brauzer manzil satridagi qulf belgisini bosing → Kamera → Ruxsat berish, so'ng qayta urinib ko'ring.",
    canRetry: true,
  },
  notfound: {
    title: 'Kamera topilmadi',
    body: "Bu qurilmada kamera yo'q yoki u o'chirilgan. Shtrixkodni qo'lda kiritishingiz mumkin.",
    canRetry: true,
  },
  inuse: {
    title: 'Kamera band',
    body: "Kamerani boshqa dastur yoki brauzer oynasi ishlatmoqda. O'shani yopib, qayta urinib ko'ring.",
    canRetry: true,
  },
  unknown: {
    title: 'Kamerani ochib bo\'lmadi',
    body: "Kutilmagan xatolik yuz berdi. Qayta urinib ko'ring yoki shtrixkodni qo'lda kiriting.",
    canRetry: true,
  },
}

export function BarcodeScannerModal({
  open,
  onClose,
  onBarcodeDetected,
  conflictCheck,
  onManualInput,
  closeOnDetect = true,
  autoConfirm = false,
  cartCount,
}: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const zxingStopRef = useRef<(() => void) | null>(null)
  const pausedRef = useRef(false)
  const runIdRef = useRef(0)

  // The camera-owning effect must not depend on these: they are recreated on
  // most parent renders (conflictCheck closes over the product list,
  // onBarcodeDetected over the cart), and depending on them tore the camera
  // down and restarted it mid-session — which looks exactly like "it doesn't
  // work". Reading them through refs keeps the effect stable while still
  // calling the latest version.
  const onDetectRef = useRef(onBarcodeDetected)
  useEffect(() => { onDetectRef.current = onBarcodeDetected }, [onBarcodeDetected])
  const conflictRef = useRef(conflictCheck)
  useEffect(() => { conflictRef.current = conflictCheck }, [conflictCheck])

  const [cameraError, setCameraError] = useState<CameraError | null>(null)
  const [starting, setStarting] = useState(false)
  const [scanned, setScanned] = useState<string | null>(null)
  const [conflict, setConflict] = useState<{ conflictName?: string } | null>(null)
  const [rejectMessage, setRejectMessage] = useState<string | null>(null)
  const [flash, setFlash] = useState<{ ok: boolean; message?: string } | null>(null)
  const [torchOn, setTorchOn] = useState(false)
  const [torchSupported, setTorchSupported] = useState(false)
  const [canSwitch, setCanSwitch] = useState(false)
  // Bumped by "retry" and by the camera-switch button to re-run the effect
  // in place — the old code reloaded the whole page here, which threw away
  // the cart the cashier was in the middle of building.
  const [attempt, setAttempt] = useState(0)
  const [preferFront, setPreferFront] = useState(false)
  // getUserMedia stays pending for as long as the browser's permission prompt
  // is unanswered, and a prompt is easy to miss — especially on a phone where
  // it can sit behind the keyboard or at the top of a tall screen. Without
  // this the user just watches "Kamera ochilmoqda…" forever with no idea what
  // is being waited on.
  const [slowStart, setSlowStart] = useState(false)

  const rejectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const flashTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastCodeRef = useRef<string | null>(null)
  const lastCodeAtRef = useRef(0)

  const teardown = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
    try { zxingStopRef.current?.() } catch { /* already stopped */ }
    zxingStopRef.current = null
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    const video = videoRef.current
    if (video) video.srcObject = null
  }, [])

  const handleDecoded = useCallback((text: string) => {
    if (pausedRef.current) return
    if (!isPlausibleBarcode(text)) {
      setRejectMessage("Bu kod mahsulot shtrixkodiga o'xshamaydi")
      if (rejectTimeoutRef.current) clearTimeout(rejectTimeoutRef.current)
      rejectTimeoutRef.current = setTimeout(() => setRejectMessage(null), 1800)
      return
    }

    if (autoConfirm) {
      // The same code sitting in front of the lens decodes on every frame —
      // debounce it instead of adding it to the cart repeatedly while the
      // cashier repositions the item.
      const now = Date.now()
      if (text === lastCodeRef.current && now - lastCodeAtRef.current < SAME_CODE_COOLDOWN_MS) return
      lastCodeRef.current = text
      lastCodeAtRef.current = now

      const err = onDetectRef.current(text)
      setRejectMessage(null)
      if (flashTimeoutRef.current) clearTimeout(flashTimeoutRef.current)
      setFlash({ ok: !err, message: err ?? undefined })
      flashTimeoutRef.current = setTimeout(() => setFlash(null), err ? 1100 : 500)
      if (navigator.vibrate) navigator.vibrate(err ? [40, 60, 40] : 30)
      return
    }

    pausedRef.current = true
    setRejectMessage(null)
    setScanned(text)
    setConflict(conflictRef.current ? conflictRef.current(text) : null)
    if (navigator.vibrate) navigator.vibrate(30)
  }, [autoConfirm])

  useEffect(() => {
    if (!open) return

    const runId = ++runIdRef.current
    const alive = () => runId === runIdRef.current

    setCameraError(null)
    setScanned(null)
    setConflict(null)
    setRejectMessage(null)
    setFlash(null)
    setTorchOn(false)
    setTorchSupported(false)
    setStarting(true)
    setSlowStart(false)
    lastCodeRef.current = null
    pausedRef.current = false

    const slowTimer = setTimeout(() => { if (alive()) setSlowStart(true) }, 6000)

    const start = async () => {
      // Checked before touching the API so the user gets the actual reason.
      // getUserMedia is simply absent outside a secure context, which the old
      // code surfaced as "kamera ruxsati kerak" — advice that can never work.
      if (typeof window !== 'undefined' && !window.isSecureContext) {
        clearTimeout(slowTimer); setCameraError('insecure'); setStarting(false); return
      }
      if (!navigator.mediaDevices?.getUserMedia) {
        clearTimeout(slowTimer); setCameraError('unsupported'); setStarting(false); return
      }

      let stream: MediaStream
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: preferFront ? 'user' : { ideal: 'environment' },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        })
      } catch (err) {
        // A laptop has no rear camera, so an `environment` request can fail
        // outright on some browsers. Retry unconstrained before giving up —
        // this alone is why the scanner appeared dead on desktop.
        try {
          stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false })
        } catch (err2) {
          clearTimeout(slowTimer)
          if (alive()) { setCameraError(classifyCameraError(err2 ?? err)); setStarting(false) }
          return
        }
      }

      if (!alive()) { stream.getTracks().forEach((t) => t.stop()); return }
      streamRef.current = stream

      const video = videoRef.current
      if (!video) {
        // Previously this silently returned, leaving a black rectangle and no
        // way forward. It is a genuine failure, so it is reported as one.
        stream.getTracks().forEach((t) => t.stop())
        clearTimeout(slowTimer)
        if (alive()) { setCameraError('unknown'); setStarting(false) }
        return
      }

      video.srcObject = stream
      try {
        await video.play()
      } catch {
        // Autoplay rejection is recoverable — the stream is attached, and the
        // browser starts it on the first interaction. Not worth an error card.
      }
      if (!alive()) return
      clearTimeout(slowTimer)
      setStarting(false)
      setSlowStart(false)

      const track = stream.getVideoTracks()[0]
      const caps = (track?.getCapabilities?.() ?? {}) as MediaTrackCapabilities & { torch?: boolean }
      setTorchSupported(Boolean(caps.torch))

      // Only offer the switch when there is actually more than one camera.
      try {
        const devices = await navigator.mediaDevices.enumerateDevices()
        if (alive()) setCanSwitch(devices.filter((d) => d.kind === 'videoinput').length > 1)
      } catch { /* enumeration is a nicety, not a requirement */ }

      // ── decoding ────────────────────────────────────────────────────────
      // The native detector is hardware-accelerated and costs no bundle at
      // all; ZXing is the fallback and is loaded only if we actually need it,
      // which keeps it off the products/sales pages' first load.
      const Detector = (window as unknown as { BarcodeDetector?: DetectorCtor }).BarcodeDetector
      let nativeOk = false
      if (Detector) {
        try {
          const supported = (await Detector.getSupportedFormats?.()) ?? NATIVE_FORMATS
          const formats = NATIVE_FORMATS.filter((f) => supported.includes(f))
          if (formats.length) {
            const detector = new Detector({ formats })
            let busy = false
            timerRef.current = setInterval(async () => {
              if (busy || !alive() || pausedRef.current) return
              if (video.readyState < 2) return
              busy = true
              try {
                const codes = await detector.detect(video)
                const value = codes?.[0]?.rawValue
                if (value) handleDecoded(value)
              } catch { /* a dropped frame is not an error worth surfacing */ }
              busy = false
            }, DECODE_INTERVAL_MS)
            nativeOk = true
          }
        } catch { /* fall through to ZXing */ }
      }

      if (!nativeOk) {
        const [{ BrowserMultiFormatReader }, { BarcodeFormat, DecodeHintType }] = await Promise.all([
          import('@zxing/browser'),
          import('@zxing/library'),
        ])
        if (!alive()) return
        const hints = new Map<number, unknown>([[
          DecodeHintType.POSSIBLE_FORMATS,
          [
            BarcodeFormat.EAN_13, BarcodeFormat.EAN_8,
            BarcodeFormat.UPC_A, BarcodeFormat.UPC_E,
            BarcodeFormat.CODE_128, BarcodeFormat.CODE_39,
          ],
        ]])
        const reader = new BrowserMultiFormatReader(hints as never)
        const controls = await reader.decodeFromVideoElement(video, (result) => {
          if (!alive()) return
          const text = result?.getText?.()
          if (text) handleDecoded(text)
        })
        if (!alive()) { controls.stop(); return }
        zxingStopRef.current = () => controls.stop()
      }
    }

    start()

    return () => {
      runIdRef.current++
      clearTimeout(slowTimer)
      teardown()
      if (rejectTimeoutRef.current) { clearTimeout(rejectTimeoutRef.current); rejectTimeoutRef.current = null }
      if (flashTimeoutRef.current) { clearTimeout(flashTimeoutRef.current); flashTimeoutRef.current = null }
    }
  }, [open, attempt, preferFront, autoConfirm, handleDecoded, teardown])

  useEscapeToClose([[open, onClose]])

  const toggleTorch = useCallback(async () => {
    const track = streamRef.current?.getVideoTracks()[0]
    if (!track) return
    const next = !torchOn
    try {
      // `torch` is a real, widely-shipped constraint on mobile, but it is not
      // in the DOM typings yet — hence the cast rather than a type assertion
      // TypeScript would reject outright.
      await track.applyConstraints({ advanced: [{ torch: next }] } as unknown as MediaTrackConstraints)
      setTorchOn(next)
    } catch {
      setTorchSupported(false)
    }
  }, [torchOn])

  if (!open) return null

  const rescan = () => {
    setScanned(null)
    setConflict(null)
    pausedRef.current = false
  }

  const confirm = () => {
    if (!scanned) return
    onDetectRef.current(scanned)
    if (closeOnDetect) onClose()
    else rescan()
  }

  const iconBtn = (active = false): React.CSSProperties => ({
    width: 44,
    height: 44,
    borderRadius: '50%',
    border: 'none',
    background: active ? '#7c3aed' : 'rgba(255,255,255,0.15)',
    color: '#fff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    flexShrink: 0,
    transition: 'background 0.15s',
  })

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 2000, background: '#000', display: 'flex', flexDirection: 'column' }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: 10, padding: '14px 16px', position: 'relative', zIndex: 10,
      }}>
        <button onClick={onClose} aria-label="Yopish" style={iconBtn()}>
          <X size={22} />
        </button>
        <span style={{
          color: '#fff', fontSize: 14, fontWeight: 600, flex: 1, minWidth: 0,
          textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {autoConfirm && typeof cartCount === 'number'
            ? `Savatda: ${cartCount} ta`
            : 'Shtrixkodni skaner qilish'}
        </span>
        <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
          {torchSupported && (
            <button onClick={toggleTorch} aria-label="Chiroq" title="Chiroq" style={iconBtn(torchOn)}>
              <Lightbulb size={20} />
            </button>
          )}
          {canSwitch && (
            <button
              onClick={() => setPreferFront((v) => !v)}
              aria-label="Kamerani almashtirish"
              title="Kamerani almashtirish"
              style={iconBtn()}
            >
              <SwitchCamera size={20} />
            </button>
          )}
          {onManualInput && (
            <button onClick={onManualInput} aria-label="Qo'lda kiritish" title="Qo'lda kiritish" style={iconBtn()}>
              <Keyboard size={20} />
            </button>
          )}
        </div>
      </div>

      {cameraError ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <div style={{
            background: '#18181e', borderRadius: 18, padding: 'clamp(20px, 6vw, 28px)',
            maxWidth: 360, width: '100%', textAlign: 'center', boxSizing: 'border-box',
          }}>
            <Scan size={40} color="#7c3aed" style={{ margin: '0 auto 12px' }} />
            <div style={{ color: '#fff', fontSize: 17, fontWeight: 700, marginBottom: 8 }}>
              {ERROR_COPY[cameraError].title}
            </div>
            <div style={{ color: '#8888a0', fontSize: 14, lineHeight: 1.55, marginBottom: 18 }}>
              {ERROR_COPY[cameraError].body}
            </div>
            {ERROR_COPY[cameraError].canRetry && (
              <button
                // Restarts the camera pipeline in place. This used to call
                // window.location.reload(), which threw away an in-progress cart.
                onClick={() => setAttempt((n) => n + 1)}
                style={{
                  width: '100%', padding: 12, borderRadius: 10, border: 'none',
                  background: '#7c3aed', color: '#fff', fontSize: 14, fontWeight: 700,
                  cursor: 'pointer', marginBottom: 8,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                }}
              >
                <RotateCw size={16} />
                Qayta urinish
              </button>
            )}
            {onManualInput && (
              <button
                onClick={onManualInput}
                style={{
                  width: '100%', padding: 12, borderRadius: 10,
                  border: '1px solid rgba(255,255,255,0.18)', background: 'transparent',
                  color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer', marginBottom: 8,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                }}
              >
                <Keyboard size={16} />
                Qo&apos;lda kiritish
              </button>
            )}
            <button
              onClick={onClose}
              style={{ background: 'none', border: 'none', color: '#8888a0', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}
            >
              Bekor qilish
            </button>
          </div>
        </div>
      ) : (
        <>
          <div style={{ position: 'relative', flex: 1, overflow: 'hidden' }}>
            <video
              ref={videoRef}
              muted
              playsInline
              autoPlay
              style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
            />

            {starting && (
              <div style={{
                position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24,
                background: '#000', color: 'rgba(255,255,255,0.7)', textAlign: 'center',
              }}>
                <Camera size={34} />
                <span style={{ fontSize: 14, fontWeight: 600 }}>Kamera ochilmoqda…</span>
                {slowStart && (
                  <>
                    <span style={{ fontSize: 13, lineHeight: 1.5, maxWidth: 300, color: 'rgba(255,255,255,0.55)' }}>
                      Brauzer kameraga ruxsat so&apos;rayotgan bo&apos;lishi mumkin — so&apos;rovni tasdiqlang.
                    </span>
                    {onManualInput && (
                      <button
                        onClick={onManualInput}
                        style={{
                          marginTop: 4, padding: '10px 18px', borderRadius: 10,
                          border: '1px solid rgba(255,255,255,0.18)', background: 'transparent',
                          color: '#fff', fontSize: 13.5, fontWeight: 700, cursor: 'pointer',
                          display: 'flex', alignItems: 'center', gap: 8,
                        }}
                      >
                        <Keyboard size={15} />
                        Qo&apos;lda kiritish
                      </button>
                    )}
                  </>
                )}
              </div>
            )}

            {flash && (
              <div style={{
                position: 'absolute', inset: 0,
                border: `4px solid ${flash.ok ? '#22c55e' : '#ef4444'}`,
                pointerEvents: 'none',
              }}>
                <div style={{
                  position: 'absolute', top: 16, left: '50%', transform: 'translateX(-50%)',
                  display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px',
                  borderRadius: 999, background: flash.ok ? 'rgba(34,197,94,0.92)' : 'rgba(239,68,68,0.92)',
                  color: '#fff', fontSize: 13, fontWeight: 700,
                  maxWidth: 'calc(100% - 32px)', textAlign: 'center',
                }}>
                  {flash.ok ? <Check size={16} /> : <AlertTriangle size={16} />}
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {flash.ok ? "Qo'shildi" : flash.message}
                  </span>
                </div>
              </div>
            )}

            {scanned ? (
              <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
                <div style={{
                  background: 'rgba(0,0,0,0.78)', borderRadius: 18, padding: 24,
                  width: '100%', maxWidth: 360, minWidth: 0, textAlign: 'center',
                  border: '1px solid rgba(255,255,255,0.12)', boxSizing: 'border-box',
                }}>
                  {conflict
                    ? <AlertTriangle size={26} color="#f59e0b" style={{ margin: '0 auto 10px' }} />
                    : <Check size={26} color="#22c55e" style={{ margin: '0 auto 10px' }} />}
                  <div style={{ color: '#fff', fontSize: 15, fontWeight: 700, marginBottom: 4 }}>
                    {conflict ? 'Bu kod band' : 'Kod aniqlandi'}
                  </div>
                  {conflict?.conflictName ? (
                    <div style={{ color: '#f59e0b', fontSize: 13, marginBottom: 10 }}>
                      &quot;{conflict.conflictName}&quot; allaqachon shu kodni ishlatmoqda
                    </div>
                  ) : null}
                  <div style={{
                    color: conflict ? '#f59e0b' : '#a78bfa', fontSize: 24, fontWeight: 800,
                    letterSpacing: 2, wordBreak: 'break-all',
                  }}>
                    {scanned}
                  </div>
                </div>
              </div>
            ) : !starting && (
              <div style={{
                position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center',
              }}>
                {/* Darkened surround so the frame reads as the target area
                    rather than a decoration floating over the picture. */}
                <div style={{ position: 'relative', width: 'min(78vw, 300px)', aspectRatio: '16 / 10' }}>
                  <div style={{
                    position: 'absolute', inset: 0, borderRadius: 16,
                    boxShadow: '0 0 0 100vmax rgba(0,0,0,0.45)',
                  }} />
                  {[
                    { top: -2, left: -2, borderTopWidth: 4, borderLeftWidth: 4, borderTopLeftRadius: 16 },
                    { top: -2, right: -2, borderTopWidth: 4, borderRightWidth: 4, borderTopRightRadius: 16 },
                    { bottom: -2, left: -2, borderBottomWidth: 4, borderLeftWidth: 4, borderBottomLeftRadius: 16 },
                    { bottom: -2, right: -2, borderBottomWidth: 4, borderRightWidth: 4, borderBottomRightRadius: 16 },
                  ].map((c, i) => (
                    <div key={i} style={{
                      position: 'absolute',
                      width: 'clamp(24px, 8vw, 30px)',
                      height: 'clamp(24px, 8vw, 30px)',
                      borderStyle: 'solid',
                      borderColor: '#a78bfa',
                      ...c,
                    }} />
                  ))}
                  {/* Sweeping line — the clearest possible signal that the
                      scanner is live and waiting, versus simply frozen. */}
                  <div style={{
                    position: 'absolute', left: 10, right: 10, height: 2, borderRadius: 2,
                    background: 'linear-gradient(90deg, transparent, #a78bfa, transparent)',
                    boxShadow: '0 0 12px rgba(167,139,250,0.9)',
                    animation: 'scanSweep 2s ease-in-out infinite',
                  }} />
                </div>
                <div style={{
                  color: rejectMessage ? '#f59e0b' : 'rgba(255,255,255,0.92)',
                  fontSize: 14, fontWeight: 600, marginTop: 22, textAlign: 'center', padding: '0 24px',
                }}>
                  {rejectMessage ?? 'Shtrixkodni ramka ichiga joylashtiring'}
                </div>
              </div>
            )}
          </div>

          <div style={{ padding: 20, display: 'flex', gap: 10, justifyContent: 'center' }}>
            {scanned ? (
              <>
                <button
                  onClick={rescan}
                  style={{
                    flex: 1, maxWidth: 200, padding: '14px 0', borderRadius: 12, border: 'none',
                    background: 'rgba(255,255,255,0.15)', color: '#fff', fontSize: 14, fontWeight: 700,
                    cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                  }}
                >
                  <RotateCw size={18} />
                  Qayta skaner
                </button>
                <button
                  onClick={confirm}
                  disabled={!!conflict}
                  style={{
                    flex: 1, maxWidth: 200, padding: '14px 0', borderRadius: 12, border: 'none',
                    background: conflict ? 'rgba(255,255,255,0.15)' : '#7c3aed',
                    color: '#fff', fontSize: 14, fontWeight: 700,
                    cursor: conflict ? 'not-allowed' : 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                  }}
                >
                  <Check size={18} />
                  Qabul qilish
                </button>
              </>
            ) : (
              <span style={{ color: 'rgba(255,255,255,0.6)', fontSize: 13, textAlign: 'center', padding: '6px 0' }}>
                Kamera orqali avtomatik aniqlanadi
              </span>
            )}
          </div>
        </>
      )}

      <style>{`
        @keyframes scanSweep {
          0%, 100% { top: 8%; opacity: 0.35; }
          50%      { top: 88%; opacity: 1; }
        }
      `}</style>
    </div>
  )
}
