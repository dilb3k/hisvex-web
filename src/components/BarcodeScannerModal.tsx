'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { BrowserMultiFormatReader, type IScannerControls } from '@zxing/browser'
import { BarcodeFormat, DecodeHintType } from '@zxing/library'
import { AlertTriangle, Check, Keyboard, RotateCw, Scan, X } from 'lucide-react'

type Props = {
  open: boolean
  onClose: () => void
  onBarcodeDetected: (data: string) => void
  conflictCheck?: (barcode: string) => { conflictName?: string } | null
  onManualInput?: () => void
  closeOnDetect?: boolean
}

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

export function BarcodeScannerModal({ open, onClose, onBarcodeDetected, conflictCheck, onManualInput, closeOnDetect = true }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const controlsRef = useRef<IScannerControls | null>(null)
  const pausedRef = useRef(false)
  const [permissionError, setPermissionError] = useState<string | null>(null)
  const [scanned, setScanned] = useState<string | null>(null)
  const [conflict, setConflict] = useState<{ conflictName?: string } | null>(null)
  const [rejectMessage, setRejectMessage] = useState<string | null>(null)
  const rejectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

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
    }
  }, [open, conflictCheck, stopCamera])

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
          Shtrixkodni skaner qilish
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
