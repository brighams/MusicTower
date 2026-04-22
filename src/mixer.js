const MEDIA_CLASSES = ['music', 'effects', 'voice', 'book']
let _count = 0

const make_mixer = () => {
  const n = ++_count
  const cascade = (n - 1) % 8

  const el = document.createElement('div')
  el.className = 'mixer-window'
  el.style.left = `${Math.round(window.innerWidth  / 2 - 150) + cascade * 28}px`
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
      <div class="mixer-art-row">
        <img src="/assets/mixer.png" class="mixer-record" alt="">
        <input type="range" class="mixer-volume" min="0" max="1" step="0.01" value="1"
          orient="vertical" title="Injected volume">
      </div>
      <div class="mixer-pill-row">
        <span class="mixer-pill"></span>
      </div>
    </div>
  `

  const record  = el.querySelector('.mixer-record')
  const body    = el.querySelector('.mixer-body')
  const vol_inp = el.querySelector('.mixer-volume')
  const pill    = el.querySelector('.mixer-pill')

  // ── audio setup (lazy — needs user gesture) ──────────────────────────────────

  let _setup = null
  const get_setup = () => {
    if (_setup) return _setup
    const { ctx, analyser } = window.get_audio_ctx()
    if (ctx.state === 'suspended') ctx.resume()
    const gain = ctx.createGain()
    gain.gain.value = parseFloat(vol_inp.value)
    gain.connect(analyser)
    _setup = { ctx, gain }
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

  // ── play random track (each call layers a new source; old ones play to end) ───

  const play_random = async () => {
    const cls = active_class()
    const r = await fetch(`/api/random/track?class=${encodeURIComponent(cls)}`)
    if (!r.ok) return
    const track = await r.json()
    const file_id = track?.file_id
    if (!file_id) return

    const { ctx, gain } = get_setup()
    const audio = new Audio()
    audio.crossOrigin = 'anonymous'
    const source = ctx.createMediaElementSource(audio)
    source.connect(gain)
    audio.src = `/media/${file_id}`
    audio.play()

    audio.addEventListener('ended', () => { source.disconnect(); audio.src = '' })

    const name = (track.file_name || track.title || `track ${file_id}`).replace(/\.[^.]+$/, '')
    pill.textContent = name
    pill.classList.remove('pop')
    void pill.offsetWidth
    pill.classList.add('pop')
  }

  record.addEventListener('click', e => {
    e.stopPropagation()
    play_random()
  })

  // ── close ────────────────────────────────────────────────────────────────────

  el.querySelector('.mixer-close').addEventListener('click', () => {
    if (_setup) _setup.gain.disconnect()
    el.remove()
  })

  // ── drag (body only — exclude buttons, images, inputs) ───────────────────────

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

  body.addEventListener('mousedown', e => {
    if (e.target.closest('button, img, input')) return
    drag = { ox: e.clientX - el.offsetLeft, oy: e.clientY - el.offsetTop }
    document.addEventListener('mousemove', on_move)
    document.addEventListener('mouseup', on_drag_up)
    e.preventDefault()
  })

  document.body.appendChild(el)
}

window.open_mixer = make_mixer
