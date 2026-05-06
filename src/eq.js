const EQ_BANDS = 6
const EQ_BIN_RANGES = [
  [2,    10],
  [10,   30],
  [30,   90],
  [90,   280],
  [280,  800],
  [800,  2000],
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
