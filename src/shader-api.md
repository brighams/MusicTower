# Visualizer Shader API

## Vertex Shader

A full-screen quad is drawn every frame. The vertex shader passes clip-space coordinates (`-1` to `+1`) directly to `gl_Position`. Fragment shaders receive no vertex attributes — all work is done per-pixel using `gl_FragCoord` and uniforms.

## Fragment Shader Inputs

### Built-in

| Name | Type | Description |
|---|---|---|
| `gl_FragCoord` | vec4 | Pixel position in screen space. `.xy` gives pixel coordinates in pixels, origin bottom-left. Divide by `u_res` to get 0–1 UV. |

### Uniforms — Audio

| Name | Type | Range | Description |
|---|---|---|---|
| `u_bass` | float | 0–1 | Average energy of frequency bins 0–7 (roughly 0–170 Hz). Smoothed with `smoothingTimeConstant = 0.82`. |
| `u_mid` | float | 0–1 | Average energy of bins 8–47 (roughly 170 Hz–1 kHz). |
| `u_treble` | float | 0–1 | Average energy of bins 48–127 (roughly 1–5 kHz). |
| `u_beat` | float | 0–1 | Impulse fired when bass exceeds 135% of its recent average. Decays by factor 0.88 each frame (~60 fps → half-life ≈ 5 frames). |

### Uniforms — Time & Space

| Name | Type | Description |
|---|---|---|
| `u_time` | float | Elapsed seconds since visualization started. Counts up indefinitely. Never resets on track change. Use in `sin()`/`cos()` or `fract()` for animation. |
| `u_res` | vec2 | Canvas size in pixels: `(width, height)`. Use to compute aspect-corrected UVs. |

### Uniforms — Rendering

| Name | Type | Description |
|---|---|---|
| `u_alpha` | float | Layer opacity, set by the layer compositor. Typically 0.38–0.55. Multiply into the final alpha of `gl_FragColor`. |

### Texture Samplers

| Name | Type | Size | Contents |
|---|---|---|---|
| `u_palette` | sampler2D | 64×1 | RGBA color palette. Updated every ~25 seconds with a new random palette interpolated from the album art's color pool. Sample with `texture2D(u_palette, vec2(t, 0.5)).rgb` where `t` is 0–1. |
| `u_wave` | sampler2D | 256×1 | PCM waveform snapshot, updated every frame. Each texel's `.r` channel is 0–1 (128/255 = silence). Sample by mapping a 0–1 horizontal coordinate to x. |
| `u_freq` | sampler2D | 128×1 | FFT magnitude spectrum, updated every frame. Each texel's `.r` channel is 0–1 (0 = silence). Bin 0 is lowest frequency, bin 127 is highest in range. |

## Fragment Shader Output

| Name | Type | Description |
|---|---|---|
| `gl_FragColor` | vec4 | RGBA color for this pixel. RGB are linear light values 0–1. Alpha should incorporate `u_alpha` so the layer compositor can blend correctly. |

## Compositing

Three layers render on top of each other each frame using additive blending (`SRC_ALPHA + ONE`). Layers cross-fade over 1.5 seconds when switching shaders. Each layer has a fixed base alpha (`ALPHAS = [0.55, 0.45, 0.38]`) passed as `u_alpha` — shaders must preserve this in their output alpha or the layer balance breaks.

## Common Patterns

**Aspect-corrected UV centered at origin:**
```glsl
vec2 uv = (gl_FragCoord.xy / u_res - 0.5) * vec2(u_res.x / u_res.y, 1.0);
```

**Palette lookup:**
```glsl
vec3 col = texture2D(u_palette, vec2(fract(t), 0.5)).rgb;
```

**Waveform sample at horizontal position x (0–1):**
```glsl
float w = texture2D(u_wave, vec2(x, 0.5)).r * 2.0 - 1.0;  // -1 to +1
```

**Frequency bin at normalized position x (0–1):**
```glsl
float f = texture2D(u_freq, vec2(x, 0.5)).r;  // 0 to 1
```

**Output with layer alpha:**
```glsl
gl_FragColor = vec4(col * brightness, u_alpha);
```
