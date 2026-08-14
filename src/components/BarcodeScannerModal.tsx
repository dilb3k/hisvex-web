'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { BrowserMultiFormatReader, type IScannerControls } from '@zxing/browser'
import { BarcodeFormat, DecodeHintType } from '@zxing/library'
import { AlertTriangle, Check, Keyboard, RotateCw, Scan, X } from 'lucide-react'

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

// Only formats realistically used on retail/product barcodes and price-gun labels.
// Excludes QR, Data Matrix, PDF417, Aztec, etc. so scanning a poster/URL QR code
// doesn't get silently accepted as a product barcode.
const PRODUCT_BARCODE_FORMATS = [
  BarcodeFormat.EAN_13,
  BarcodeFormat.EAN_8,
  BarcodeFormat.UPC_A,
  BarcodeFormat.UPC_E,
  BarcodeFormat.CODE_128,
  BarcodeFormat.CODE_39,
]

const BARCODE_HINTS = new Map<DecodeHintType, unknown>([
  [DecodeHintType.POSSIBLE_FORMATS, PRODUCT_BARCODE_FORMATS],
])

// Basic sanity check on the decoded text, independent of the format hint above -
// rejects anything that looks like a URL or is an unreasonable length for a barcode.
function isPlausibleBarcode(text: string): boolean {
  const trimmed = text.trim()
  if (trimmed.length < 4 || trimmed.length > 48) return false
  if (/^[a-z]+:\/\//i.test(trimmed) || /^www\./i.test(trimmed) || /\s/.test(trimmed)) return false
  return true
}

export function BarcodeScannerModal({ open, onClose, onBarcodeDetected, conflictCheck, onManualInput, closeOnDetect = true, autoConfirm = false, cartCount }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const controlsRef = useRef<IScannerControls | null>(null)
  const pausedRef = useRef(false)
  const [permissionError, setPermissionError] = useState<string | null>(null)
  const [scanned, setScanned] = useState<string | null>(null)
  const [conflict, setConflict] = useState<{ conflictName?: string } | null>(null)
  const [rejectMessage, setRejectMessage] = useState<string | null>(null)
  const rejectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // autoConfirm-only: brief accept/reject flash instead of a confirm card.
  const [flash, setFlash] = useState<{ ok: boolean; message?: string } | null>(null)
  const flashTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastCodeRef = useRef<string | null>(null)
  const lastCodeAtRef = useRef(0)

  const stopCamera = useCallback(() => {
    try {
      controlsRef.current?.stop()
    } catch {
      // ignore
    }
    controlsRef.current = null
    const video = videoRef.current
    if (video && video.srcObject) {
      const stream = video.srcObject as MediaStream
      stream.getTracks().forEach(t => t.stop())
      video.srcObject = null
    }
  }, [])

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setPermissionError(null)
    setScanned(null)
    setConflict(null)
    setRejectMessage(null)
    setFlash(null)
    lastCodeRef.current = null
    pausedRef.current = false

    const reader = new BrowserMultiFormatReader(BARCODE_HINTS)

    const start = async () => {
      if (!videoRef.current) return
      try {
        const controls = await reader.decodeFromConstraints(
          {
            video: {
              facingMode: 'environment',
              width: { ideal: 1280 },
              height: { ideal: 720 },
            },
            audio: false,
          },
          videoRef.current,
          (result, _error, _controls) => {
            if (cancelled || pausedRef.current) return
            const text = result?.getText?.()
            if (!text) return
            if (!isPlausibleBarcode(text)) {
              setRejectMessage("Bu kod mahsulot shtrixkodiga o'xshamaydi")
              if (rejectTimeoutRef.current) clearTimeout(rejectTimeoutRef.current)
              rejectTimeoutRef.current = setTimeout(() => setRejectMessage(null), 1800)
              return
            }

            if (autoConfirm) {
              // Same code held in front of the camera decodes on every
              // frame — debounce it instead of adding it to the cart
              // repeatedly while the cashier repositions the item.
              const now = Date.now()
              if (text === lastCodeRef.current && now - lastCodeAtRef.current < SAME_CODE_COOLDOWN_MS) return
              lastCodeRef.current = text
              lastCodeAtRef.current = now

              const err = onBarcodeDetected(text)
              setRejectMessage(null)
              if (flashTimeoutRef.current) clearTimeout(flashTimeoutRef.current)
              setFlash({ ok: !err, message: err ?? undefined })
              flashTimeoutRef.current = setTimeout(() => setFlash(null), err ? 1100 : 500)
              // Camera keeps running — no pause, no tap required — so the
              // next item can be scanned immediately.
              return
            }

            pausedRef.current = true
            setRejectMessage(null)
            setScanned(text)
            setConflict(conflictCheck ? conflictCheck(text) : null)
          }
        )
        if (cancelled) {
          controls.stop()
          return
        }
        controlsRef.current = controls
      } catch {
        if (!cancelled) {
          setPermissionError('Kamera ruxsati kerak yoki kamera topilmadi')
        }
      }
    }

    start()

    return () => {
      cancelled = true
      stopCamera()
      if (rejectTimeoutRef.current) {
        clearTimeout(rejectTimeoutRef.current)
        rejectTimeoutRef.current = null
      }
      if (flashTimeoutRef.current) {
        clearTimeout(flashTimeoutRef.current)
        flashTimeoutRef.current = null
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, conflictCheck, stopCamera, autoConfirm])

  if (!open) return null

  const rescan = () => {
    setScanned(null)
    setConflict(null)
    pausedRef.current = false
  }

  const confirm = () => {
    if (!scanned) return
    onBarcodeDetected(scanned)
    if (closeOnDetect) {
      onClose()
    } else {
      rescan()
    }
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 2000,
        background: '#000',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '14px 16px',
        position: 'relative',
        zIndex: 10,
      }}>
        <button
          onClick={onClose}
          aria-label="Close"
          style={{
            width: 40,
            height: 40,
            borderRadius: '50%',
            border: 'none',
            background: 'rgba(255,255,255,0.15)',
            color: '#fff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            flexShrink: 0,
          }}
        >
          <X size={22} />
        </button>
        <span style={{
          color: '#fff',
          fontSize: 14,
          fontWeight: 600,
          flex: 1,
          minWidth: 0,
          textAlign: 'center',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          padding: '0 8px',
        }}>
          {autoConfirm && typeof cartCount === 'number'
            ? `Savatda: ${cartCount} ta`
            : 'Shtrixkodni skaner qilish'}
        </span>
        <button
          onClick={onManualInput}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            background: 'rgba(255,255,255,0.15)',
            border: 'none',
            color: '#fff',
            fontSize: 13,
            fontWeight: 600,
            padding: '10px 12px',
            borderRadius: 10,
            cursor: 'pointer',
            flexShrink: 0,
          }}
        >
          <Keyboard size={16} />
          Qo'lda kiriting
        </button>
      </div>

      {permissionError ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <div style={{
            background: '#18181e',
            borderRadius: 18,
            padding: 'clamp(20px, 6vw, 28px)',
            maxWidth: 340,
            width: '100%',
            textAlign: 'center',
            boxSizing: 'border-box',
          }}>
            <Scan size={40} color="#7c3aed" style={{ margin: '0 auto 12px' }} />
            <div style={{ color: '#fff', fontSize: 17, fontWeight: 700, marginBottom: 6 }}>
              Kamera ruxsati kerak
            </div>
            <div style={{ color: '#8888a0', fontSize: 14, lineHeight: 1.5, marginBottom: 18 }}>
              {permissionError}
            </div>
            <button
              onClick={() => { setPermissionError(null); window.location.reload() }}
              style={{
                width: '100%',
                padding: 12,
                borderRadius: 10,
                border: 'none',
                background: '#7c3aed',
                color: '#fff',
                fontSize: 14,
                fontWeight: 700,
                cursor: 'pointer',
                marginBottom: 8,
              }}
            >
              Qayta urinish
            </button>
            <button
              onClick={onClose}
              style={{
                background: 'none',
                border: 'none',
                color: '#8888a0',
                fontSize: 14,
                fontWeight: 600,
                cursor: 'pointer',
              }}
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
              style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
            />

            {/* autoConfirm mode: no tap-to-accept card — just a brief
                accept/reject flash, then the camera is already scanning
                the next item. */}
            {flash && (
              <div style={{
                position: 'absolute',
                inset: 0,
                border: `4px solid ${flash.ok ? '#22c55e' : '#ef4444'}`,
                pointerEvents: 'none',
              }}>
                <div style={{
                  position: 'absolute',
                  top: 16,
                  left: '50%',
                  transform: 'translateX(-50%)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '10px 16px',
                  borderRadius: 999,
                  background: flash.ok ? 'rgba(34,197,94,0.92)' : 'rgba(239,68,68,0.92)',
                  color: '#fff',
                  fontSize: 13,
                  fontWeight: 700,
                  maxWidth: 'calc(100% - 32px)',
                  textAlign: 'center',
                }}>
                  {flash.ok ? <Check size={16} /> : <AlertTriangle size={16} />}
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {flash.ok ? "Qo'shildi" : flash.message}
                  </span>
                </div>
              </div>
            )}

            {scanned ? (
              <div style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: 24,
              }}>
                <div style={{
                  background: 'rgba(0,0,0,0.78)',
                  borderRadius: 18,
                  padding: 24,
                  width: '100%',
                  maxWidth: 360,
                  minWidth: 0,
                  textAlign: 'center',
                  border: '1px solid rgba(255,255,255,0.12)',
                  boxSizing: 'border-box',
                }}>
                  {conflict ? (
                    <AlertTriangle size={26} color="#f59e0b" style={{ margin: '0 auto 10px' }} />
                  ) : (
                    <Check size={26} color="#22c55e" style={{ margin: '0 auto 10px' }} />
                  )}
                  <div style={{ color: '#fff', fontSize: 15, fontWeight: 700, marginBottom: 4 }}>
                    {conflict ? 'Bu kod band' : 'Kod aniqlandi'}
                  </div>
                  {conflict?.conflictName ? (
                    <div style={{ color: '#f59e0b', fontSize: 13, marginBottom: 10 }}>
                      "{conflict.conflictName}" allaqachon shu kodni ishlatmoqda
                    </div>
                  ) : null}
                  <div style={{
                    color: conflict ? '#f59e0b' : '#7c3aed',
                    fontSize: 24,
                    fontWeight: 800,
                    letterSpacing: 2,
                    wordBreak: 'break-all',
                  }}>
                    {scanned}
                  </div>
                </div>
              </div>
            ) : (
              <div style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
              }}>
                <div style={{ position: 'relative', width: 'min(72vw, 280px)', aspectRatio: '16 / 10' }}>
                  <div style={{
                    position: 'absolute', inset: 0,
                    border: '1.5px solid rgba(124,58,237,0.7)',
                    borderRadius: 14, opacity: 0.7,
                  }} />
                  {[
                    { t: -2, l: -2, bt: 4, bl: 4, btl: 16 },
                    { t: -2, r: -2, bt: 4, br: 4, btr: 16 },
                    { b: -2, l: -2, bb: 4, bl: 4, bbl: 16 },
                    { b: -2, r: -2, bb: 4, br: 4, bbr: 16 },
                  ].map((c, i) => (
                    <div key={i} style={{
                      position: 'absolute',
                      width: 'clamp(22px, 8vw, 28px)',
                      height: 'clamp(22px, 8vw, 28px)',
                      ...(c.t !== undefined ? { top: c.t } : { bottom: c.b }),
                      ...(c.l !== undefined ? { left: c.l } : { right: c.r }),
                      ...(c.bt !== undefined ? { borderTopWidth: c.bt } : { borderBottomWidth: c.bb }),
                      ...(c.bl !== undefined ? { borderLeftWidth: c.bl } : { borderRightWidth: c.br }),
                      ...(c.btl !== undefined ? { borderTopLeftRadius: c.btl } : {}),
                      ...(c.btr !== undefined ? { borderTopRightRadius: c.btr } : {}),
                      ...(c.bbl !== undefined ? { borderBottomLeftRadius: c.bbl } : {}),
                      ...(c.bbr !== undefined ? { borderBottomRightRadius: c.bbr } : {}),
                      borderStyle: 'solid',
                      borderColor: '#7c3aed',
                    }} />
                  ))}
                </div>
                <div style={{
                  color: rejectMessage ? '#f59e0b' : '#fff',
                  fontSize: 14,
                  fontWeight: 600,
                  marginTop: 20,
                  textAlign: 'center',
                  padding: '0 24px',
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
                    flex: 1,
                    maxWidth: 200,
                    padding: '14px 0',
                    borderRadius: 12,
                    border: 'none',
                    background: 'rgba(255,255,255,0.15)',
                    color: '#fff',
                    fontSize: 14,
                    fontWeight: 700,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 6,
                  }}
                >
                  <RotateCw size={18} />
                  Qayta skaner
                </button>
                <button
                  onClick={confirm}
                  disabled={!!conflict}
                  style={{
                    flex: 1,
                    maxWidth: 200,
                    padding: '14px 0',
                    borderRadius: 12,
                    border: 'none',
                    background: conflict ? 'rgba(255,255,255,0.15)' : '#7c3aed',
                    color: '#fff',
                    fontSize: 14,
                    fontWeight: 700,
                    cursor: conflict ? 'not-allowed' : 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 6,
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
    </div>
  )
}
