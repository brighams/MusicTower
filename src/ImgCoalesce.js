export const coalesce_img = (img, urls, scales = []) => {
  img.style.display = 'none'
  img.removeAttribute('src')
  delete img.dataset.srcIndex

  let i = 0
  const try_next = () => {
    while (i < urls.length && !urls[i]) i++
    if (i >= urls.length) return
    const url = urls[i]
    const idx = i
    const probe = new Image()
    probe.onload = () => {
      const scale = scales[idx] ?? 1.0
      img.src = url
      img.dataset.srcIndex = String(idx)
      img.style.width = Math.round(probe.naturalWidth * scale) + 'px'
      img.style.height = 'auto'
      img.style.display = 'block'
    }
    probe.onerror = () => { i++; try_next() }
    probe.src = url
  }
  try_next()
}

export const clear_img = (img) => {
  img.style.display = 'none'
  img.removeAttribute('src')
  delete img.dataset.srcIndex
}
