const MEDIA_CLASSES = ['music', 'effects', 'voice', 'book']
let _count = 0

const make_mixer = () => {
  const n = ++_count
  const cascade = (n - 1) % 8

  const el = document.createElement('div')
  el.className = 'mixer-window'
  el.style.left = `${Math.round(window.innerWidth  / 2 - 170) + cascade * 28}px`
  el.style.top  = `${Math.round(window.innerHeight / 2 - 150) + cascade * 28}px`

  el.innerHTML = `
    <div class="mixer-header">
      <span class="mixer-title">Mixer</span>
      <button class="mixer-close" title="Close">✕</button>
    </div>
    <div class="mixer-body">
      <div class="mixer-class-row">
        ${MEDIA_CLASSES.map((c, i) =>
          `<button class="mixer-class-btn${i === 0 ? ' active' : ''}" data-class="${c}">${c}</button>`
        ).join('')}
      </div>
      <div class="mixer-main-row">
        <div class="mixer-left">
          <div class="mixer-record-wrap">
            <img src="/assets/mixer.png" class="mixer-record" alt="">
          </div>
          <input type="range" class="mixer-volume" min="0" max="1" step="0.01" value="1"
            orient="vertical" title="Injected volume">
        </div>
        <div class="mixer-mix-list"></div>
      </div>
    </div>
  `

  const header   = el.querySelector('.mixer-header')
  const wrap     = el.querySelector('.mixer-record-wrap')
  const record   = el.querySelector('.mixer-record')
  const vol_inp  = el.querySelector('.mixer-volume')
  const mix_list = el.querySelector('.mixer-mix-list')

  // ── audio setup (lazy — needs user gesture) ──────────────────────────────────

  let _setup = null
  const get_setup = () => {
    if (_setup) return _setup
    console.log('[mixer] initialising audio context')
    const nodes = window.get_audio_ctx?.()
    if (!nodes) { console.error('[mixer] get_audio_ctx not available'); return null }
    const { ctx, analyser } = nodes
    console.log('[mixer] ctx state:', ctx.state)
    const gain = ctx.createGain()
    gain.gain.value = parseFloat(vol_inp.value)
    gain.connect(analyser)
    _setup = { ctx, gain }
    console.log('[mixer] audio setup complete, gain →', gain.gain.value)
    return _setup
  }

  vol_inp.addEventListener('input', () => {
    if (_setup) _setup.gain.gain.value = parseFloat(vol_inp.value)
  })

  // ── class toggle ─────────────────────────────────────────────────────────────

  for (const btn of el.querySelectorAll('.mixer-class-btn')) {
    btn.addEventListener('click', () => {
      for (const b of el.querySelectorAll('.mixer-class-btn')) b.classList.remove('active')
      btn.classList.add('active')
    })
  }

  const active_class = () => el.querySelector('.mixer-class-btn.active')?.dataset.class ?? 'music'

  // ── inject a track by file_id ────────────────────────────────────────────────

  const inject = async (file_id) => {
    console.log('[mixer] inject file_id:', file_id)
    const setup = get_setup()
    if (!setup) { console.error('[mixer] no audio setup'); return }
    const { ctx, gain } = setup
    if (ctx.state === 'suspended') {
      console.log('[mixer] resuming suspended context')
      await ctx.resume()
    }
    const audio = new Audio()
    audio.crossOrigin = 'anonymous'
    try {
      const source = ctx.createMediaElementSource(audio)
      source.connect(gain)
      audio.src = `/media/${file_id}`
      console.log('[mixer] playing src:', audio.src)
      await audio.play()
      console.log('[mixer] playback started')
      audio.addEventListener('ended', () => { source.disconnect(); audio.src = ''; console.log('[mixer] track ended, cleaned up') })
    } catch (e) {
      console.error('[mixer] inject failed:', e)
    }
  }

  // ── fetch a random track, falling back to any class if none found ─────────────

  const fetch_track = async (url) => {
    console.log('[mixer] fetch_track:', url)
    try {
      const r = await fetch(url)
      console.log('[mixer] response status:', r.status)
      if (!r.ok) return null
      const data = await r.json()
      console.log('[mixer] track data:', data)
      const t = Array.isArray(data) ? data[0] : data
      return t?.file_id ? t : null
    } catch (e) { console.error('[mixer] fetch_track error:', e); return null }
  }

  // ── add item to the mix list ─────────────────────────────────────────────────

  const add_to_list = (file_id, name) => {
    const item = document.createElement('div')
    item.className = 'mixer-mix-item'
    item.textContent = name
    item.title = name
    item.addEventListener('click', () => inject(file_id))
    mix_list.prepend(item)
  }

  // ── play random track ────────────────────────────────────────────────────────

  const play_random = async () => {
    const cls = active_class()
    console.log('[mixer] play_random, class:', cls)
    const track =
      await fetch_track(`/api/random/track?class=${encodeURIComponent(cls)}`) ??
      await fetch_track('/api/random/track')
    console.log('[mixer] resolved track:', track)
    if (!track) { console.warn('[mixer] no track found'); return }
    const name = (track.file_name || track.title || String(track.file_id)).replace(/\.[^.]+$/, '')
    console.log('[mixer] injecting:', name, 'id:', track.file_id)
    inject(track.file_id)
    add_to_list(track.file_id, name)
  }

  // ── click: pulse + play ──────────────────────────────────────────────────────

  wrap.addEventListener('click', e => {
    e.stopPropagation()
    record.classList.remove('pulsing')
    void record.offsetWidth
    record.classList.add('pulsing')
    play_random()
  })

  record.addEventListener('animationend', () => record.classList.remove('pulsing'))

  // ── close ────────────────────────────────────────────────────────────────────

  el.querySelector('.mixer-close').addEventListener('click', () => {
    if (_setup) _setup.gain.disconnect()
    el.remove()
  })

  // ── drag from header only ────────────────────────────────────────────────────

  let drag = null

  const on_move = e => {
    if (!drag) return
    el.style.left = `${e.clientX - drag.ox}px`
    el.style.top  = `${e.clientY - drag.oy}px`
  }

  const on_drag_up = () => {
    drag = null
    document.removeEventListener('mousemove', on_move)
    document.removeEventListener('mouseup', on_drag_up)
  }

  header.addEventListener('mousedown', e => {
    if (e.target.closest('button')) return
    drag = { ox: e.clientX - el.offsetLeft, oy: e.clientY - el.offsetTop }
    document.addEventListener('mousemove', on_move)
    document.addEventListener('mouseup', on_drag_up)
    e.preventDefault()
  })

  document.body.appendChild(el)
}

window.open_mixer = make_mixer
