const MEDIA_CLASSES = ['music', 'effect', 'voice', 'audiobook']
let _count = 0

const esc = (s) => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')

const make_mixer = () => {
  const n = ++_count
  const cascade = (n - 1) % 8

  const el = document.createElement('div')
  el.className = 'mixer-window'
  el.style.left = `${Math.round(window.innerWidth  / 2 - 230) + cascade * 28}px`
  el.style.top  = `${Math.round(window.innerHeight / 2 - 230) + cascade * 28}px`

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
            orient="vertical" title="Master volume">
        </div>
        <div class="mixer-mixin-list"></div>
      </div>
      <div class="mixer-search-section">
        <input class="mixer-search-input" type="text" placeholder="search by album title…" autocomplete="off">
        <div class="mixer-search-results"></div>
      </div>
    </div>
  `

  const header     = el.querySelector('.mixer-header')
  const wrap       = el.querySelector('.mixer-record-wrap')
  const record     = el.querySelector('.mixer-record')
  const vol_inp    = el.querySelector('.mixer-volume')
  const mixin_list = el.querySelector('.mixer-mixin-list')
  const title_el   = el.querySelector('.mixer-title')
  const search_inp = el.querySelector('.mixer-search-input')
  const search_res = el.querySelector('.mixer-search-results')

  // ── audio setup ──────────────────────────────────────────────────────────────

  let _setup = null
  let _playing = 0
  const update_spin = () => wrap.classList.toggle('spinning', _playing > 0)

  const get_setup = () => {
    if (_setup) return _setup
    const nodes = window.get_audio_ctx?.()
    if (!nodes) return null
    const { ctx, analyser } = nodes
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
  const class_to_scan = (cls) => cls === 'music' ? 'music' : 'files'

  // ── inject a track ───────────────────────────────────────────────────────────

  const inject = async (file_id) => {
    const setup = get_setup()
    if (!setup) return null
    const { ctx, gain } = setup
    if (ctx.state === 'suspended') await ctx.resume()
    const audio = new Audio()
    audio.crossOrigin = 'anonymous'
    try {
      const source     = ctx.createMediaElementSource(audio)
      const item_analyser = ctx.createAnalyser()
      item_analyser.fftSize = 128
      item_analyser.smoothingTimeConstant = 0
      const item_gain  = ctx.createGain()
      item_gain.gain.value = 1.0
      source.connect(item_analyser)
      item_analyser.connect(item_gain)
      item_gain.connect(gain)
      audio.src = `/media/${file_id}`
      await audio.play()

      const new_count = Math.min(6, (window.get_vis_count?.() ?? 1) + 1)
      window.set_vis_count?.(new_count)
      const inp = document.getElementById('vis-count-input')
      const val = document.getElementById('vis-count-val')
      if (inp) { inp.value = new_count; if (val) val.textContent = new_count }

      return { audio, item_gain, item_analyser }
    } catch(e) {
      console.error('[mixer] inject failed:', e)
      return null
    }
  }

  // ── add item to the mix list ─────────────────────────────────────────────────

  const add_to_list = async (file_id, name) => {
    const result = await inject(file_id)
    if (!result) return
    const { audio, item_gain, item_analyser } = result

    _playing++
    update_spin()

    const item = document.createElement('div')
    item.className = 'mixer-mixin'
    item.innerHTML = `
      <canvas class="mixin-canvas"></canvas>
      <button class="mixin-play" title="Play / Pause">⏸</button>
      <span class="mixin-name" title="${esc(name)}">${esc(name)}</span>
      <input type="range" class="mixin-vol" min="0" max="1" step="0.01" value="1">
    `

    const play_btn   = item.querySelector('.mixin-play')
    const vol_slider = item.querySelector('.mixin-vol')
    const canvas     = item.querySelector('.mixin-canvas')
    const ctx2d      = canvas.getContext('2d')
    const wave_data  = new Uint8Array(item_analyser.frequencyBinCount)
    let raf_id = null

    const draw_wave = () => {
      raf_id = requestAnimationFrame(draw_wave)
      item_analyser.getByteTimeDomainData(wave_data)
      ctx2d.clearRect(0, 0, canvas.width, canvas.height)
      ctx2d.strokeStyle = '#00e8ff'
      ctx2d.lineWidth = 1.5
      ctx2d.beginPath()
      const step = canvas.width / wave_data.length
      for (let i = 0; i < wave_data.length; i++) {
        const y = (wave_data[i] / 255) * canvas.height
        if (i === 0) ctx2d.moveTo(0, y)
        else ctx2d.lineTo(i * step, y)
      }
      ctx2d.stroke()
    }

    const start_wave = () => { if (!raf_id) draw_wave() }
    const stop_wave  = () => { if (raf_id) { cancelAnimationFrame(raf_id); raf_id = null } }

    play_btn.addEventListener('click', (e) => {
      e.stopPropagation()
      if (audio.paused) audio.play()
      else              audio.pause()
    })

    audio.addEventListener('play',  () => { play_btn.textContent = '⏸'; start_wave(); _playing++; update_spin() })
    audio.addEventListener('pause', () => { play_btn.textContent = '▶'; stop_wave(); _playing = Math.max(0, _playing - 1); update_spin() })
    audio.addEventListener('ended', () => { _playing = Math.max(0, _playing - 1); update_spin() })

    vol_slider.addEventListener('input', () => {
      item_gain.gain.value = parseFloat(vol_slider.value)
    })

    mixin_list.prepend(item)

    requestAnimationFrame(() => {
      canvas.width  = canvas.offsetWidth  || 200
      canvas.height = canvas.offsetHeight || 28
      if (!audio.paused) start_wave()
    })
  }

  // ── fetch a random track ─────────────────────────────────────────────────────

  const fetch_track = async (url) => {
    try {
      const r = await fetch(url)
      if (!r.ok) return null
      const data = await r.json()
      const t = Array.isArray(data) ? data[0] : data
      return t?.file_id ? t : null
    } catch(e) { return null }
  }

  // ── play random track ────────────────────────────────────────────────────────

  const play_random = async () => {
    const cls = active_class()
    const track =
      await fetch_track(`/api/random/track?class=${encodeURIComponent(cls)}`) ??
      await fetch_track('/api/random/track')
    if (!track?.file_id) return
    const name = (track.file_name || track.title || String(track.file_id)).replace(/\.[^.]+$/, '')
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

  // ── drag from header ─────────────────────────────────────────────────────────

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

  // ── album search ─────────────────────────────────────────────────────────────

  let _albums_promise = null

  const load_albums = () => {
    if (!_albums_promise) {
      _albums_promise = Promise.all([
        fetch('/api/albums?scan_type=music').then(r => r.json()).catch(() => []),
        fetch('/api/albums?scan_type=files').then(r => r.json()).catch(() => []),
      ]).then(([st, dm]) => [
        ...(st || []).map(a => ({ ...a, scan_type: 'music' })),
        ...(dm || []).map(a => ({ ...a, scan_type: 'files' })),
      ])
    }
    return _albums_promise
  }

  const make_album_row = (album, media_class = null) => {
    const row = document.createElement('div')
    row.className = 'mixer-result-album'
    row.innerHTML = `<span class="mixer-result-album-name">${esc(album.title)}</span><span class="mixer-result-expand">▸</span>`

    const track_wrap = document.createElement('div')
    track_wrap.className = 'mixer-result-tracks'
    track_wrap.hidden = true

    let _loaded = false
    row.addEventListener('click', async () => {
      const opening = track_wrap.hidden
      track_wrap.hidden = !opening
      row.querySelector('.mixer-result-expand').textContent = opening ? '▾' : '▸'
      if (!opening || _loaded) return
      _loaded = true
      track_wrap.innerHTML = '<div class="mixer-no-results">loading…</div>'
      const params = new URLSearchParams({ title: album.title, scan_type: album.scan_type })
      if (media_class) params.set('class', media_class)
      const tracks = await fetch(`/api/album/tracks?${params}`).then(r => r.json()).catch(() => [])
      track_wrap.innerHTML = ''
      for (const t of tracks) {
        const name = (t.file_name || String(t.file_id)).replace(/\.[^.]+$/, '')
        const item = document.createElement('div')
        item.className = 'mixer-result-item'
        item.innerHTML = `<button class="mixin-play" title="Add to mix">▶</button><span class="mixin-name" title="${esc(name)}">${esc(name)}</span>`
        item.querySelector('.mixin-play').addEventListener('click', (e) => {
          e.stopPropagation()
          title_el.textContent = name
          add_to_list(t.file_id, name)
        })
        track_wrap.appendChild(item)
      }
    })

    return [row, track_wrap]
  }

  const render_track_list = (tracks) => {
    if (!Array.isArray(tracks) || !tracks.length) {
      const msg = document.createElement('div')
      msg.className = 'mixer-no-results'
      msg.textContent = 'no tracks found'
      search_res.appendChild(msg)
      return
    }
    const frag = document.createDocumentFragment()
    for (const t of tracks) {
      const name = (t.file_name || String(t.file_id)).replace(/\.[^.]+$/, '')
      const item = document.createElement('div')
      item.className = 'mixer-result-item'
      item.innerHTML = `
        <button class="mixin-play" title="Add to mix">▶</button>
        <span class="mixin-name" title="${esc(t.full_path || name)}">${esc(name)}</span>
        <span class="mixer-result-ctx">${esc(t.title || '')}</span>
      `
      item.querySelector('.mixin-play').addEventListener('click', (e) => {
        e.stopPropagation()
        title_el.textContent = name
        add_to_list(t.file_id, name)
      })
      frag.appendChild(item)
    }
    search_res.appendChild(frag)
  }

  const show_spinner = () => {
    const s = document.createElement('div')
    s.className = 'mixer-loading'
    search_res.appendChild(s)
  }

  const render_search = async () => {
    const q   = search_inp.value.trim()
    const cls = active_class()
    search_res.innerHTML = ''
    show_spinner()

    if (cls === 'music') {
      const ql = q.toLowerCase()
      const albums = await load_albums()
      if (search_inp.value.trim() !== q || active_class() !== cls) return
      search_res.innerHTML = ''

      const seen = new Set()
      const matches = albums.filter(a => {
        if (a.scan_type !== 'music') return false
        const key = a.title?.toLowerCase() ?? ''
        if (seen.has(key)) return false
        seen.add(key)
        return !ql || key.includes(ql)
      })

      if (!matches.length) {
        const msg = document.createElement('div')
        msg.className = 'mixer-no-results'
        msg.textContent = 'no albums found'
        search_res.appendChild(msg)
        return
      }

      const frag = document.createDocumentFragment()
      for (const album of matches) {
        const [row, track_wrap] = make_album_row(album)
        frag.appendChild(row)
        frag.appendChild(track_wrap)
      }
      search_res.appendChild(frag)
      return
    }

    const params = new URLSearchParams({ class: cls })
    if (q) params.set('q', q)
    const titles = await fetch(`/api/class/titles?${params}`).then(r => r.json()).catch(() => [])
    if (search_inp.value.trim() !== q || active_class() !== cls) return
    search_res.innerHTML = ''

    if (!titles.length) {
      const msg = document.createElement('div')
      msg.className = 'mixer-no-results'
      msg.textContent = 'no results'
      search_res.appendChild(msg)
      return
    }

    const frag = document.createDocumentFragment()
    for (const t of titles) {
      const [row, track_wrap] = make_album_row({ title: t.title, scan_type: 'files' }, cls)
      frag.appendChild(row)
      frag.appendChild(track_wrap)
    }
    search_res.appendChild(frag)
  }

  search_inp.addEventListener('input', render_search)

  for (const btn of el.querySelectorAll('.mixer-class-btn')) {
    btn.addEventListener('click', render_search)
  }

  render_search()

  document.body.appendChild(el)
}

window.open_mixer = make_mixer
