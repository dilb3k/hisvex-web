// Mirrors desktop's src/utils/blockCode.ts exactly — a per-device (not
// per-account) toggle that lets a user temporarily skip PIN prompts without
// deleting the saved blockCode itself. Deliberately localStorage-only, not
// synced to the backend: "temporarily disable" is a convenience for this
// browser/device, not an account-wide security setting.
const STORAGE_KEY = 'hisvex_block_disabled'

export function isBlockCodeDisabled(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

export function setBlockCodeDisabled(disabled: boolean) {
  try {
    localStorage.setItem(STORAGE_KEY, disabled ? '1' : '0')
  } catch {
    // localStorage mavjud emas
  }
}
