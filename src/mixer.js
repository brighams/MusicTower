const MEDIA_CLASSES    = ['music', 'effect', 'voice', 'audiobook']
const STORAGE_PREFIX   = 'mixer.'
let _count = 0

const WAVE_DRAW_PTS = 80
const WAVE_SMOOTH_A = 0.15

const make_wave_draw = (analyser, canvas, ctx2d) => {
  const wave_data  = new Uint8Array(analyser.frequencyBinCount)
  const smooth_buf = new Float32Array(WAVE_DRAW_PTS).fill(128)
  let raf_id = null

  const draw = () => {
    raf_id = requestAnimationFrame(draw)
    analyser.getByteTimeDomainData(wave_data)
    const stride = Math.floor(wave_data.length / WAVE_DRAW_PTS)
    for (let i = 0; i < WAVE_DRAW_PTS; i++) {
      let s = 0
      for (let j = 0; j < stride; j++) s += wave_data[i * stride + j]
      smooth_buf[i] = smooth_buf[i] * (1 - WAVE_SMOOTH_A) + (s / stride) * WAVE_SMOOTH_A
    }
    ctx2d.clearRect(0, 0, canvas.width, canvas.height)
    ctx2d.strokeStyle = '#ff0088'
    ctx2d.lineWidth = 1.5
    ctx2d.beginPath()
    for (let i = 0; i < WAVE_DRAW_PTS; i++) {
      const x = (i / (WAVE_DRAW_PTS - 1)) * canvas.width
      const y = (smooth_buf[i] / 255) * canvas.height
      if (i === 0) ctx2d.moveTo(x, y)
      else         ctx2d.lineTo(x, y)
    }
    ctx2d.stroke()
  }

  const start = () => {
    canvas.width  = canvas.offsetWidth  || 200
    canvas.height = canvas.offsetHeight || 28
    if (!raf_id) draw()
  }

  const stop = () => {
    if (raf_id) { cancelAnimationFrame(raf_id); raf_id = null }
    smooth_buf.fill(128)
    ctx2d.clearRect(0, 0, canvas.width, canvas.height)
  }

  return { start, stop }
}

window.make_wave_draw = make_wave_draw

const EQ_BANDS = 6
// fftSize 4096 @ 44.1kHz -> ~10.77 Hz per bin. Roughly log-spaced bands.
const EQ_BIN_RANGES = [
  [2,    10],   // ~22-108 Hz   sub/bass
  [10,   30],   // ~108-323 Hz  low-mid
  [30,   90],   // ~323-970 Hz  mid
  [90,   280],  // ~970-3010 Hz upper-mid
  [280,  800],  // ~3-8.6 kHz   presence
  [800,  2000], // ~8.6-21.5kHz brilliance
]
const EQ_SMOOTH_A = 0.5
const EQ_SEG_H    = 2
const EQ_SEG_GAP  = 1

const make_eq_draw = (analyser, canvas, ctx2d) => {
  const freq_data = new Uint8Array(analyser.frequencyBinCount)
  const smooth    = new Float32Array(EQ_BANDS).fill(0)
  let raf_id = null

  const draw = () => {
    raf_id = requestAnimationFrame(draw)
    analyser.getByteFrequencyData(freq_data)

    const w = canvas.width
    const h = canvas.height
    const slot_w = w / EQ_BANDS
    const bar_w  = Math.max(1, slot_w - 2)
    const pitch  = EQ_SEG_H + EQ_SEG_GAP
    const segs   = Math.max(1, Math.floor((h + EQ_SEG_GAP) / pitch))

    ctx2d.clearRect(0, 0, w, h)

    for (let i = 0; i < EQ_BANDS; i++) {
      const [lo, hi] = EQ_BIN_RANGES[i]
      let s = 0
      for (let j = lo; j < hi; j++) s += freq_data[j]
      const v = s / ((hi - lo) * 255)
      smooth[i] = smooth[i] * (1 - EQ_SMOOTH_A) + v * EQ_SMOOTH_A

      const lit = Math.min(segs, Math.round(smooth[i] * segs * 1.4))
      const x   = i * slot_w + 1

      for (let k = 0; k < lit; k++) {
        const t  = k / Math.max(1, segs - 1)
        const sy = h - k * pitch - EQ_SEG_H
        ctx2d.fillStyle = t < 0.55 ? '#40d8e8' : (t < 0.82 ? '#c060f0' : '#ff0088')
        ctx2d.fillRect(x, sy, bar_w, EQ_SEG_H)
      }
    }
  }

  const start = () => {
    canvas.width  = canvas.offsetWidth  || 72
    canvas.height = canvas.offsetHeight || 24
    if (!raf_id) draw()
  }

  const stop = () => {
    if (raf_id) { cancelAnimationFrame(raf_id); raf_id = null }
    smooth.fill(0)
    ctx2d.clearRect(0, 0, canvas.width, canvas.height)
  }

  return { start, stop }
}

window.make_eq_draw = make_eq_draw

const esc = (s) => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')

const make_mixer = (config = null) => {
  const n       = ++_count
  const cascade = (n - 1) % 8

  let _name  = config?.name ?? 'Untitled'
  let _saved = !!config

  const el = document.createElement('div')
  el.className = 'mixer-window'
  el.style.left = `${Math.round(window.innerWidth  / 2 - 230) + cascade * 28}px`
  el.style.top  = `${Math.round(window.innerHeight / 2 - 230) + cascade * 28}px`

  el.innerHTML = `
    <div class="mixer-header">
      <span class="mixer-title" title="Double-click to rename">M${n}: ${esc(_name)}</span>
      <div class="mixer-header-actions">
        <button class="mixer-minimize" title="Minimize">–</button>
        <button class="mixer-trash" title="Delete saved mixer" style="display:none">🗑</button>
        <button class="mixer-save"  title="Save mixer">💾</button>
        <button class="mixer-close" title="Close">✕</button>
      </div>
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

  const header      = el.querySelector('.mixer-header')
  const wrap        = el.querySelector('.mixer-record-wrap')
  const record      = el.querySelector('.mixer-record')
  const vol_inp     = el.querySelector('.mixer-volume')
  const mixin_list  = el.querySelector('.mixer-mixin-list')
  const title_el    = el.querySelector('.mixer-title')
  const trash_btn   = el.querySelector('.mixer-trash')
  const save_btn    = el.querySelector('.mixer-save')
  const minimize_btn = el.querySelector('.mixer-minimize')
  const search_inp  = el.querySelector('.mixer-search-input')
  const search_res  = el.querySelector('.mixer-search-results')

  if (_saved) trash_btn.style.display = ''

  // ── dirty / save visibility ───────────────────────────────────────────────────

  let _dirty = !config

  const set_dirty = (d) => {
    _dirty = d
    save_btn.style.display = d ? '' : 'none'
  }
  set_dirty(_dirty)

  // ── title editing ─────────────────────────────────────────────────────────────

  title_el.addEventListener('dblclick', () => {
    const inp = document.createElement('input')
    inp.className = 'mixer-title-input'
    inp.value = _name
    title_el.replaceWith(inp)
    inp.select()

    const commit = () => {
      const val = inp.value.trim()
      if (val && val !== _name) {
        _name = val
        _saved = false
        trash_btn.style.display = 'none'
        set_dirty(true)
      }
      title_el.textContent = `M${n}: ${_name}`
      inp.replaceWith(title_el)
    }

    inp.addEventListener('blur', commit)
    inp.addEventListener('keydown', e => {
      if (e.key === 'Enter')  inp.blur()
      if (e.key === 'Escape') inp.replaceWith(title_el)
    })
  })

  // ── save / delete ─────────────────────────────────────────────────────────────

  const get_mixin_state = () =>
    [...mixin_list.querySelectorAll('.mixer-mixin')].map(item => ({
      file_id: parseInt(item.dataset.fileId),
      name:    item.querySelector('.mixin-name').title,
      vol:     parseFloat(item.querySelector('.mixin-vol').value),
    }))

  save_btn.addEventListener('click', () => {
    const state = { name: _name, master_vol: parseFloat(vol_inp.value), mixins: get_mixin_state() }
    localStorage.setItem(`${STORAGE_PREFIX}${_name}`, JSON.stringify(state))
    _saved = true
    trash_btn.style.display = ''
    set_dirty(false)
  })

  let _trash_confirm = false
  trash_btn.addEventListener('click', () => {
    if (!_trash_confirm) {
      _trash_confirm = true
      trash_btn.textContent = '✓'
      trash_btn.title = 'Confirm delete'
      setTimeout(() => {
        if (_trash_confirm) {
          _trash_confirm = false
          trash_btn.textContent = '🗑'
          trash_btn.title = 'Delete saved mixer'
        }
      }, 2500)
    } else {
      localStorage.removeItem(`${STORAGE_PREFIX}${_name}`)
      _saved = false
      _trash_confirm = false
      trash_btn.textContent = '🗑'
      trash_btn.title = 'Delete saved mixer'
      trash_btn.style.display = 'none'
    }
  })

  // ── audio setup ──────────────────────────────────────────────────────────────

  let _setup   = null
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
    const new_count = Math.min(6, (window.get_vis_count?.() ?? 1) + 1)
    window.set_vis_count?.(new_count)
    return _setup
  }

  vol_inp.addEventListener('input', () => {
    if (_setup) _setup.gain.gain.value = parseFloat(vol_inp.value)
    set_dirty(true)
  })

  // ── class toggle ─────────────────────────────────────────────────────────────

  for (const btn of el.querySelectorAll('.mixer-class-btn')) {
    btn.addEventListener('click', () => {
      for (const b of el.querySelectorAll('.mixer-class-btn')) b.classList.remove('active')
      btn.classList.add('active')
    })
  }

  const active_class = () => el.querySelector('.mixer-class-btn.active')?.dataset.class ?? 'music'

  // ── inject a track ───────────────────────────────────────────────────────────

  const inject = async (file_id) => {
    const setup = get_setup()
    if (!setup) return null
    const { ctx, gain } = setup
    if (ctx.state === 'suspended') await ctx.resume()
    const audio = new Audio()
    audio.crossOrigin = 'anonymous'
    try {
      const source        = ctx.createMediaElementSource(audio)
      const item_analyser = ctx.createAnalyser()
      item_analyser.fftSize = 4096
      item_analyser.smoothingTimeConstant = 0
      const item_gain = ctx.createGain()
      item_gain.gain.value = 1.0
      source.connect(item_analyser)
      item_analyser.connect(item_gain)
      item_gain.connect(gain)
      audio.src = `/media/${file_id}`
      return { audio, item_gain, item_analyser }
    } catch(e) {
      console.error('[mixer] inject failed:', e)
      return null
    }
  }

  // ── add item to the mix list ─────────────────────────────────────────────────

  const add_to_list = async (file_id, name, initial_vol = 1) => {
    const result = await inject(file_id)
    if (!result) return
    const { audio, item_gain, item_analyser } = result

    item_gain.gain.value = initial_vol

    const item = document.createElement('div')
    item.className = 'mixer-mixin'
    item.dataset.fileId = file_id
    item.innerHTML = `
      <canvas class="mixin-canvas"></canvas>
      <button class="mixin-play"   title="Play / Pause">▶</button>
      <span   class="mixin-name"   title="${esc(name)}">${esc(name)}</span>
      <input  type="range" class="mixin-vol" min="0" max="1" step="0.01" value="${initial_vol}">
      <button class="mixin-remove" title="Remove">✕</button>
    `

    const remove_btn = item.querySelector('.mixin-remove')
    const play_btn   = item.querySelector('.mixin-play')
    const vol_slider = item.querySelector('.mixin-vol')
    const canvas = item.querySelector('.mixin-canvas')
    const ctx2d  = canvas.getContext('2d')
    const { start: start_wave, stop: stop_wave } = make_wave_draw(item_analyser, canvas, ctx2d)

    remove_btn.addEventListener('click', e => {
      e.stopPropagation()
      audio.pause()
      stop_wave()
      item_gain.disconnect()
      item.remove()
      set_dirty(true)
    })

    play_btn.addEventListener('click', e => {
      e.stopPropagation()
      if (audio.paused) audio.play()
      else              audio.pause()
    })

    audio.addEventListener('play',  () => { play_btn.textContent = '⏸'; start_wave(); _playing++; update_spin(); window.start_vsvis?.() })
    audio.addEventListener('pause', () => { play_btn.textContent = '▶';  stop_wave();  _playing = Math.max(0, _playing - 1); update_spin() })
    audio.addEventListener('ended', () => {                                             _playing = Math.max(0, _playing - 1); update_spin() })

    vol_slider.addEventListener('input', () => {
      item_gain.gain.value = parseFloat(vol_slider.value)
      set_dirty(true)
    })

    mixin_list.prepend(item)
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
    set_dirty(true)
  }

  // ── click: pulse + random ────────────────────────────────────────────────────

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
    if (_setup) {
      _setup.gain.disconnect()
      window.set_vis_count?.(Math.max(1, (window.get_vis_count?.() ?? 1) - 1))
    }
    el.remove()
  })

  // ── minimize / restore ────────────────────────────────────────────────────────

  const TILE_W = 200
  const TILE_H = 36
  let _minimized = false

  const restore_mixer = () => {
    _minimized = false
    el.classList.remove('minimized')
    el.style.width  = ''
    el.style.height = ''
    el.style.left   = el.dataset.restoreLeft || el.style.left
    el.style.top    = el.dataset.restoreTop  || el.style.top
    el.style.resize = ''
  }

  minimize_btn.addEventListener('click', () => {
    if (_minimized) { restore_mixer(); return }
    _minimized = true
    el.dataset.restoreLeft = el.style.left
    el.dataset.restoreTop  = el.style.top
    const slot = document.querySelectorAll('.mixer-window.minimized').length
    el.classList.add('minimized')
    el.style.width  = `${TILE_W}px`
    el.style.height = `${TILE_H}px`
    el.style.left   = `${window.innerWidth - TILE_W - slot * (TILE_W + 4) - 4}px`
    el.style.top    = `${window.innerHeight - TILE_H - 4}px`
    el.style.resize = 'none'
  })

  header.addEventListener('click', e => {
    if (!_minimized || e.target.closest('button')) return
    restore_mixer()
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
    document.removeEventListener('mouseup',   on_drag_up)
  }

  header.addEventListener('mousedown', e => {
    if (e.target.closest('button, input')) return
    drag = { ox: e.clientX - el.offsetLeft, oy: e.clientY - el.offsetTop }
    document.addEventListener('mousemove', on_move)
    document.addEventListener('mouseup',   on_drag_up)
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
    const lookup = album.install_key || album.title
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
      const params = new URLSearchParams({ title: lookup, scan_type: album.scan_type })
      if (media_class) params.set('class', media_class)
      const tracks = await fetch(`/api/album/tracks?${params}`).then(r => r.json()).catch(() => [])
      track_wrap.innerHTML = ''
      for (const t of tracks) {
        const name = (t.file_name || String(t.file_id)).replace(/\.[^.]+$/, '')
        const item = document.createElement('div')
        item.className = 'mixer-result-item'
        item.innerHTML = `<button class="mixin-play" title="Add to mix">▶</button><span class="mixin-name" title="${esc(name)}">${esc(name)}</span>`
        item.querySelector('.mixin-play').addEventListener('click', e => {
          e.stopPropagation()
          add_to_list(t.file_id, name)
          set_dirty(true)
        })
        track_wrap.appendChild(item)
      }
    })

    return [row, track_wrap]
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
      const ql     = q.toLowerCase()
      const albums = await load_albums()
      if (search_inp.value.trim() !== q || active_class() !== cls) return
      search_res.innerHTML = ''

      const seen    = new Set()
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
      const [row, track_wrap] = make_album_row({ title: t.title, install_key: t.install_key, scan_type: 'files' }, cls)
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

  // ── load saved config ─────────────────────────────────────────────────────────

  if (config) {
    vol_inp.value = config.master_vol ?? 1
    for (const m of config.mixins ?? []) {
      add_to_list(m.file_id, m.name, m.vol ?? 1)
    }
  }

  document.body.appendChild(el)
}

// ── open saved mixer popup ────────────────────────────────────────────────────

const open_mixer_list = () => {
  const existing = document.getElementById('mixer-open-popup')
  if (existing) { existing.remove(); return }

  const keys = Object.keys(localStorage).filter(k => k.startsWith(STORAGE_PREFIX)).sort()

  const popup = document.createElement('div')
  popup.id = 'mixer-open-popup'
  popup.className = 'mixer-open-popup'
  popup.innerHTML = `
    <div class="mixer-open-header">
      <span>Saved Mixers</span>
      <button class="mixer-open-close" title="Close">✕</button>
    </div>
    <div class="mixer-open-list"></div>
    <div class="mixer-open-footer">
      <button class="mixer-open-btn">Open</button>
    </div>
  `

  const list_el = popup.querySelector('.mixer-open-list')
  if (!keys.length) {
    list_el.innerHTML = '<div class="mixer-no-results">No saved mixers</div>'
  } else {
    for (const key of keys) {
      const name = key.slice(STORAGE_PREFIX.length)
      const row = document.createElement('label')
      row.className = 'mixer-open-item'
      row.innerHTML = `<input type="checkbox" value="${esc(key)}"><span>${esc(name)}</span>`
      list_el.appendChild(row)
    }
  }

  popup.querySelector('.mixer-open-close').addEventListener('click', () => popup.remove())

  popup.querySelector('.mixer-open-btn').addEventListener('click', () => {
    for (const cb of popup.querySelectorAll('input[type=checkbox]:checked')) {
      const raw = localStorage.getItem(cb.value)
      if (!raw) continue
      try { make_mixer(JSON.parse(raw)) } catch(e) { console.error('[mixer] load failed:', e) }
    }
    popup.remove()
  })

  document.body.appendChild(popup)
}

document.addEventListener('keydown', e => {
  if (e.key !== 'o' && e.key !== 'O') return
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return
  open_mixer_list()
})

window.open_mixer      = make_mixer
window.open_mixer_list = open_mixer_list
