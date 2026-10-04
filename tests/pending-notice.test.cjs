const { test } = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')

const source = ts.transpileModule(readFileSync('src/components/AppLayout.tsx', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText

// Exercise the actual component effects with a controlled clock and queue.
function layout() {
  const states = [], effects = [], timers = new Map(), events = new Map(), toasts = []
  let cursor = 0, dirty = false, now = 0, timerId = 0, count = 0, listener, tree
  let auth = { user: { scope: undefined }, isOffline: false }, flush = async () => {}
  const Sidebar = () => null, PendingOperations = () => null
  const hooks = {
    useState(initial) {
      const index = cursor++
      if (!(index in states)) states[index] = initial
      return [states[index], value => {
        const next = typeof value === 'function' ? value(states[index]) : value
        if (!Object.is(next, states[index])) { states[index] = next; dirty = true }
      }]
    },
    useRef(initial) { const index = cursor++; return states[index] ??= { current: initial } },
    useEffect(work, deps) {
      const index = cursor++, previous = effects[index]
      if (!previous || deps.some((dep, n) => !Object.is(dep, previous.deps[n]))) {
        effects[index] = { deps, work, cleanup: previous?.cleanup, pending: true }
      }
    },
  }
  class ClockDate extends Date { static now() { return now } }
  const context = { exports: {}, Date: ClockDate, navigator: { onLine: true },
    setTimeout: (work, delay) => { const id = ++timerId; timers.set(id, { at: now + delay, work }); return id },
    clearTimeout: id => timers.delete(id), setInterval: () => ++timerId, clearInterval: () => {},
    window: { addEventListener: (name, work) => events.set(name, work), removeEventListener: name => events.delete(name) },
    require(name) {
      if (name === 'react') return hooks
      if (name === 'react/jsx-runtime') return require(name)
      if (name === './Sidebar') return { Sidebar }
      if (name === './PendingOperations') return { PendingOperations }
      if (name === './TelegramSetup') return { TelegramSetup: () => null }
      if (name === '@/lib/sessionHeartbeat') return { startSessionHeartbeat: () => ({ ping: async () => {}, stop() {} }) }
      if (name === '@/lib/authStore') return { useAuthStore: select => select(auth) }
      if (name === '@/lib/appStore') return { useAppStore: () => ({ error: null, clearError() {}, toast: { visible: false }, hideToast() {}, showToast: (...args) => toasts.push(args) }) }
      if (name === '@/lib/offlineQueue') return { getQueueOwner: () => 'A', getQueueCount: async () => count, retryAllReviewedWrites: async () => 0,
        subscribeOfflineQueueCount(work) { listener = work; work(count); return () => { listener = null } } }
      if (name === '@/lib/api') return { flushOfflineQueueOnStartup: () => flush() }
      if (name === 'lucide-react') return new Proxy({}, { get: () => () => null })
      throw Error(name)
    },
  }
  vm.runInNewContext(source, context)
  function render() {
    for (let pass = 0; pass < 20; pass++) {
      cursor = 0; dirty = false; tree = context.exports.AppLayout({ children: 'page contents' })
      for (const effect of effects.filter(Boolean)) if (effect.pending) {
        effect.pending = false; effect.cleanup?.(); effect.cleanup = effect.work()
      }
      if (!dirty) return tree
    }
    throw Error('Render did not settle')
  }
  function find(predicate, node) {
    if (Array.isArray(node)) return node.flatMap(child => find(predicate, child))
    if (!node || typeof node !== 'object') return []
    return [...(predicate(node) ? [node] : []), ...find(predicate, node.props?.children)]
  }
  render()
  return { render, toasts,
    emit(value) { count = value; listener(value); render() },
    tick(ms) { now += ms; for (const [id, timer] of [...timers]) if (timer.at <= now) { timers.delete(id); timer.work() }; render() },
    offline(value) { events.get(value ? 'offline' : 'online')(); render() },
    scoped() { auth = { ...auth, user: { scope: 'procurement' } }; render() },
    setFlush(work) { flush = work },
    notices: () => find(node => node.type === PendingOperations, tree),
    warnings: () => find(node => node.props?.role === 'status', tree),
    unmount() { effects.filter(Boolean).forEach(effect => effect.cleanup?.()) },
  }
}

test('an online save acknowledged quickly never flashes the offline warning or pending notice', () => {
  const ui = layout(); ui.emit(1); ui.tick(300)
  assert.equal(ui.warnings().length, 0); assert.equal(ui.notices().length, 0)
  ui.emit(0); ui.tick(2000)
  assert.equal(ui.warnings().length, 0); assert.equal(ui.notices().length, 0)
  ui.unmount()
})

test('longer online pending writes use a compact notice; count changes do not postpone it indefinitely', () => {
  const ui = layout(); ui.emit(1); ui.tick(1000); ui.emit(2); ui.tick(500)
  assert.equal(ui.warnings().length, 0)
  assert.equal(ui.notices().length, 1); assert.equal(ui.notices()[0].props.count, 2)
  ui.emit(0); assert.equal(ui.notices().length, 0)
  ui.unmount()
})

test('a real offline connection shows the warning immediately, while procurement scope hides financial queue UI', () => {
  const ui = layout(); ui.offline(true); assert.equal(ui.warnings().length, 1)
  ui.emit(1); assert.equal(ui.notices().length, 1)
  ui.offline(false); assert.equal(ui.warnings().length, 0)
  ui.scoped(); ui.tick(2000)
  assert.equal(ui.notices().length, 0); assert.equal(ui.warnings().length, 0)
  ui.unmount()
})

test('manual retry stays busy until completion and never claims confirmation while a write remains queued', async () => {
  const ui = layout(); ui.emit(1); ui.tick(1500)
  let complete, started
  const beginning = new Promise(resolve => started = resolve)
  ui.setFlush(() => new Promise(resolve => { complete = resolve; started() }))
  const retry = ui.notices()[0].props.onRetry()
  await beginning; ui.render()
  assert.equal(ui.notices()[0].props.retrying, true); assert.equal(ui.toasts.length, 0)
  complete(); await retry; ui.render()
  assert.equal(ui.notices()[0].props.retrying, false)
  assert.equal(ui.toasts[0][1], 'info'); assert.match(ui.toasts[0][0], /hali tasdiqlanmadi/)
  ui.unmount()
})

test('the queue details do not falsely claim unreadable records during their initial load', () => {
  const React = require('react'), { renderToStaticMarkup } = require('react-dom/server')
  const pendingSource = ts.transpileModule(readFileSync('src/components/PendingOperations.tsx', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText
  const context = { exports: {}, require(name) {
    if (name === 'react' || name === 'react/jsx-runtime') return require(name)
    if (name === '@/lib/offlineQueue') return { getQueueOwner: () => 'A' }
    if (name === '@/lib/api') return {}
    throw Error(name)
  } }
  vm.runInNewContext(pendingSource, context)
  const markup = renderToStaticMarkup(React.createElement(context.exports.PendingOperations, { count: 1 }))
  assert.match(markup, /Server tasdig‘i kutilmoqda/)
  assert.doesNotMatch(markup, /Ayrim yozuvlar o‘qilmadi/)
})
