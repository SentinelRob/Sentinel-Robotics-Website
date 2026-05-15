/* Sentinel CRT — boot sequence, sand-dissolve splash, focused home, gated investor portal.
   2D source canvas → WebGL CRT shader (scanlines, bloom, line-noise, slot-mask, vignette). */

(function () {
  const SCREEN_W = 1280;
  const SCREEN_H = 960;

  const src = document.createElement('canvas');
  src.width = SCREEN_W;
  src.height = SCREEN_H;
  let sctx = src.getContext('2d');

  const out = document.getElementById('crt');
  const gl = out.getContext('webgl', { antialias: false, premultipliedAlpha: false });
  if (!gl) {
    document.body.innerHTML = '<div style="color:#ff8a4a;font-family:monospace;padding:20px">WebGL required.</div>';
    return;
  }

  // Idle / interaction tracking
  let lastInteractAt = performance.now();
  ['mousemove','mousedown','keydown','wheel','touchstart'].forEach(ev =>
    window.addEventListener(ev, () => { lastInteractAt = performance.now(); }, { passive: true })
  );

  // External chaos override (used by the broken pitch-deck sequence to
  // forcibly degrade the picture independent of idle state). 0..1.
  let chaosBoost = 0;

  // ── Shader ─────────────────────────────────────────────────────
  const VS = `
    attribute vec2 a;
    varying vec2 v;
    void main() { v = vec2(a.x * 0.5 + 0.5, 1.0 - (a.y * 0.5 + 0.5)); gl_Position = vec4(a, 0.0, 1.0); }
  `;

  const FS = `
    precision highp float;
    varying vec2 v;
    uniform sampler2D tex;
    uniform vec2 res;
    uniform float time;
    uniform float power;          // 0..1 power-on warmup
    uniform float glow;
    uniform float aberration;
    uniform float scanIntensity;
    uniform float lineNoise;      // 0..1 idle-degradation -> per-line jitter
    uniform float noiseCluster;   // moves vertically; lines near it twitch harder
    uniform float noiseSpread;    // half-height of cluster (uv units)
    uniform float vsync;          // 0..1 occasional vertical roll trigger
    uniform float effectsDisable; // 1.0 = clean passthrough (fullscreen mode)
    uniform float curvAmount;     // overall curvature strength
    uniform float curvBottomBias; // 0..1 — extra vertical squeeze at the bottom

    float rand(vec2 c) { return fract(sin(dot(c, vec2(12.9898, 78.233))) * 43758.5453); }
    float rand1(float x) { return fract(sin(x * 12.9898) * 43758.5453); }

    // Subtle barrel curvature with a stronger pull at the bottom.
    // Top gets eased, bottom gets squeezed more — matches the physical
    // bezel which has more curvature visible at the bottom of the tube.
    vec2 curve(vec2 uv) {
      vec2 c = uv * 2.0 - 1.0;
      // asymmetric vertical bias — y < 0 (top) eased, y > 0 (bottom) amplified
      float yBias = 1.0 + max(c.y, 0.0) * curvBottomBias;
      vec2 off = c.yx * c.yx * curvAmount;
      off.y *= yBias; // amplify the y-component near the bottom
      c += c * off;
      return c * 0.5 + 0.5;
    }

    void main() {
      // Apply curvature to the screen sample coordinates.
      vec2 uv = curve(v);
      if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
        gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
        return;
      }

      if (effectsDisable > 0.5) {
        gl_FragColor = vec4(texture2D(tex, uv).rgb, 1.0);
        return;
      }

      // Vertical roll — uses vsync as a TRIGGER (probabilistic)
      uv.y = mod(uv.y - vsync + 1.0, 1.0);

      // ── Idle line noise ─────────────────────────────────────────
      // We model two things to keep it from feeling 'uniform-noise on a slider':
      //   (a) a slowly-moving cluster — a vertical band that twitches harder,
      //       giving the effect a sense of physical location on the tube.
      //   (b) per-line randomness with non-uniform thresholds, so some lines
      //       sit still while a few neighbours go wild together.
      float lineId = floor(uv.y * res.y);
      // Base random per line, refreshed at ~24Hz
      float baseTick = floor(time * 24.0);
      float lineRand1 = rand1(lineId * 0.1731 + baseTick * 0.913);
      float lineRand2 = rand1(lineId * 0.0419 + baseTick * 0.547);

      // Cluster intensity: 0..1 falloff around noiseCluster, gaussian-ish
      float dy = abs(uv.y - noiseCluster);
      float clusterAmp = exp(-(dy * dy) / max(noiseSpread * noiseSpread, 0.0001));
      // Cluster makes some lines twitch much harder than the steady baseline
      float threshold = mix(0.92, 0.55, clusterAmp);
      float twitch = step(threshold, lineRand1);

      // Burst lines that are noticeably bigger
      float burst = step(0.985, lineRand2) * (0.6 + clusterAmp * 1.2);

      float jitter = (rand1(lineId + baseTick * 1.317) - 0.5) * twitch * lineNoise
                   * (0.012 + clusterAmp * 0.030 + burst * 0.040);
      uv.x += jitter;

      // Chromatic aberration — radial split, mild
      vec2 c = uv - 0.5;
      float dist = length(c);
      float ab = aberration * (0.45 + dist * 1.2);
      float r = texture2D(tex, uv + c * ab * 0.010).r;
      float g = texture2D(tex, uv).g;
      float b = texture2D(tex, uv - c * ab * 0.010).b;
      vec3 col = vec3(r, g, b);

      // Bloom
      float px = 1.5 / res.x;
      float py = 1.5 / res.y;
      vec3 bloom = vec3(0.0);
      bloom += texture2D(tex, uv + vec2( px, 0.0)).rgb;
      bloom += texture2D(tex, uv + vec2(-px, 0.0)).rgb;
      bloom += texture2D(tex, uv + vec2(0.0,  py)).rgb;
      bloom += texture2D(tex, uv + vec2(0.0, -py)).rgb;
      bloom += texture2D(tex, uv + vec2( px*2.5,  py*2.5)).rgb;
      bloom += texture2D(tex, uv + vec2(-px*2.5,  py*2.5)).rgb;
      bloom += texture2D(tex, uv + vec2( px*2.5, -py*2.5)).rgb;
      bloom += texture2D(tex, uv + vec2(-px*2.5, -py*2.5)).rgb;
      bloom *= 0.125;
      vec3 bb = max(bloom - 0.25, 0.0);
      col += bb * glow;

      // Scanlines — modulated by line noise (some lines dimmer, edges brighter)
      float scanPitch = res.y * 1.6;
      float scan = sin(uv.y * scanPitch) * 0.5 + 0.5;
      col *= 1.0 - scanIntensity * (1.0 - scan);

      // Per-line dropouts when noisy — clustered too. Some lines lose
      // brightness for one frame, others go bright (overshoot), and they
      // come in clumps near the cluster band.
      if (lineNoise > 0.05) {
        float dropTick = floor(time * 8.0);
        float dropRand = rand1(lineId * 0.711 + dropTick);
        float dropThresh = mix(0.93, 0.7, clusterAmp);
        float lineDim = step(dropThresh, dropRand) * lineNoise * (0.4 + clusterAmp * 0.6);
        col *= 1.0 - lineDim;
        // occasional bright streak (CRT 'snowflake') — rare, not strobey
        float spark = step(0.9995, rand1(lineId * 1.97 + dropTick * 0.31));
        col += vec3(spark * 0.25);
      }

      // Slot-mask
      float slot = mod(gl_FragCoord.x, 3.0);
      if (slot < 1.0) col.r *= 1.06;
      else if (slot < 2.0) col.g *= 1.06;
      else col.b *= 1.06;

      // Vignette
      float vig = smoothstep(0.85, 0.35, dist);
      col *= mix(0.55, 1.0, vig);

      // Static noise — base + extra when noisy
      float noiseAmt = 0.04 + lineNoise * 0.10;
      float n = (rand(uv * res + time * 60.0) - 0.5) * noiseAmt;
      col += n;

      // Power-on warm-up: thin band -> fullscreen
      float band = smoothstep(0.0, 0.5, power);
      float lineMask = smoothstep(0.0, 0.02 + band * 0.5, abs(uv.y - 0.5));
      float bootMask = mix(1.0 - lineMask, 1.0, band);
      col *= bootMask * power;

      // Phosphor afterglow shadow lift
      col.g += (1.0 - col.g) * 0.02;

      gl_FragColor = vec4(col, 1.0);
    }
  `;

  function compile(type, source) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, source);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) console.error(gl.getShaderInfoLog(sh));
    return sh;
  }
  const prog = gl.createProgram();
  gl.attachShader(prog, compile(gl.VERTEX_SHADER, VS));
  gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FS));
  gl.linkProgram(prog);
  gl.useProgram(prog);

  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
  const aLoc = gl.getAttribLocation(prog, 'a');
  gl.enableVertexAttribArray(aLoc);
  gl.vertexAttribPointer(aLoc, 2, gl.FLOAT, false, 0, 0);

  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

  const u = {
    tex: gl.getUniformLocation(prog, 'tex'),
    res: gl.getUniformLocation(prog, 'res'),
    time: gl.getUniformLocation(prog, 'time'),
    power: gl.getUniformLocation(prog, 'power'),
    glow: gl.getUniformLocation(prog, 'glow'),
    aberration: gl.getUniformLocation(prog, 'aberration'),
    scanIntensity: gl.getUniformLocation(prog, 'scanIntensity'),
    lineNoise: gl.getUniformLocation(prog, 'lineNoise'),
    noiseCluster: gl.getUniformLocation(prog, 'noiseCluster'),
    noiseSpread: gl.getUniformLocation(prog, 'noiseSpread'),
    vsync: gl.getUniformLocation(prog, 'vsync'),
    effectsDisable: gl.getUniformLocation(prog, 'effectsDisable'),
    curvAmount: gl.getUniformLocation(prog, 'curvAmount'),
    curvBottomBias: gl.getUniformLocation(prog, 'curvBottomBias'),
  };
  gl.uniform1i(u.tex, 0);

  // ── Sizing ─────────────────────────────────────────────────────
  const APERTURE = { l: 0.0477, t: 0.0435, w: 0.8976, h: 0.8986 };
  const FRAME_AR = 3125 / 2347;
  let cleanMode = false; // fullscreen deck disables CRT effects

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const vw = window.innerWidth, vh = window.innerHeight;

    if (cleanMode) {
      // fullscreen: canvas fills viewport, no frame
      out.style.left = '0';
      out.style.top = '0';
      out.style.width = vw + 'px';
      out.style.height = vh + 'px';
      out.width = vw * dpr;
      out.height = vh * dpr;
      const frame = document.getElementById('frame');
      if (frame) frame.style.display = 'none';
      gl.viewport(0, 0, out.width, out.height);
      return;
    }

    let frameW, frameH;
    if (vw / vh > FRAME_AR) {
      frameH = Math.min(vh * 0.94, vh);
      frameW = frameH * FRAME_AR;
    } else {
      frameW = Math.min(vw * 0.94, vw);
      frameH = frameW / FRAME_AR;
    }
    const frameLeft = (vw - frameW) / 2;
    const frameTop = (vh - frameH) / 2;
    const apW = frameW * APERTURE.w;
    const apH = frameH * APERTURE.h;
    const apL = frameLeft + frameW * APERTURE.l;
    const apT = frameTop + frameH * APERTURE.t;
    out.style.left = apL + 'px';
    out.style.top = apT + 'px';
    out.style.width = apW + 'px';
    out.style.height = apH + 'px';
    out.width = apW * dpr;
    out.height = apH * dpr;

    const frame = document.getElementById('frame');
    if (frame) {
      frame.style.display = '';
      frame.style.width = frameW + 'px';
      frame.style.height = frameH + 'px';
      frame.style.left = frameLeft + 'px';
      frame.style.top = frameTop + 'px';
    }
    gl.viewport(0, 0, out.width, out.height);
  }
  window.addEventListener('resize', resize);

  // ── Phosphor palette ───────────────────────────────────────────
  // Brightened text + dulled-but-still-bright logo for parity.
  const PHOSPHOR        = '#ffb070';   // brighter primary text
  const PHOSPHOR_BRIGHT = '#ffd6a8';   // hover/highlight
  const PHOSPHOR_DIM    = '#bf6438';   // labels, secondary
  const PHOSPHOR_FAINT  = '#7a3a18';   // separators
  const BG = '#0a0604';

  // ── Asset loading orchestration ────────────────────────────────
  // Important: we want everything ready before the CRT 'powers on'.
  // The HTML preloader stays up until we fire 'sentinel:ready'.
  const assets = {
    logo: new Image(),
    brand: new Image(),
    turret: new Image(),
    frame: document.getElementById('frame'),
    fontReady: false,
  };
  assets.logo.src = 'assets/SR-Full.png';
  assets.brand.src = 'assets/SRBrand.png';
  assets.turret.src = 'assets/turret.png';

  let logoProcessed = null;
  let brandProcessed = null;
  let turretProcessed = null;

  function processLogo(img) {
    // Mid blur for legibility, brighter tint, scanlines lighter so it doesn't read dull.
    const targetW = Math.round(SCREEN_W * 0.40);
    const targetH = Math.round(targetW * (img.height / img.width));
    const off = document.createElement('canvas');
    off.width = targetW; off.height = targetH;
    const octx = off.getContext('2d');

    // luma mask
    octx.fillStyle = '#000';
    octx.fillRect(0, 0, targetW, targetH);
    octx.drawImage(img, 0, 0, targetW, targetH);
    const imgData = octx.getImageData(0, 0, targetW, targetH);
    const d = imgData.data;
    for (let i = 0; i < d.length; i += 4) {
      const a = d[i + 3] / 255;
      const l = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) * a;
      d[i] = d[i + 1] = d[i + 2] = l;
      d[i + 3] = 255;
    }
    octx.putImageData(imgData, 0, 0);

    const sharp = document.createElement('canvas');
    sharp.width = targetW; sharp.height = targetH;
    sharp.getContext('2d').drawImage(off, 0, 0);

    octx.clearRect(0, 0, targetW, targetH);
    octx.fillStyle = '#000';
    octx.fillRect(0, 0, targetW, targetH);

    // bigger halo + sharper main + extra-sharp pass for legibility
    octx.globalAlpha = 0.55;
    octx.filter = 'blur(3.2px)';
    octx.drawImage(sharp, 0, 0);
    octx.globalAlpha = 0.85;
    octx.filter = 'blur(0.4px)';
    octx.drawImage(sharp, 0, 0);
    octx.globalAlpha = 1.0;
    octx.filter = 'none';
    octx.drawImage(sharp, 0, 0);

    // tint to a brighter phosphor cream so the logo reads as hot as text
    octx.globalCompositeOperation = 'multiply';
    octx.fillStyle = '#ffd098';
    octx.fillRect(0, 0, targetW, targetH);

    // very light scanline bake
    octx.globalCompositeOperation = 'multiply';
    for (let y = 0; y < targetH; y += 4) {
      octx.fillStyle = 'rgba(0,0,0,0.18)';
      octx.fillRect(0, y, targetW, 2);
    }

    octx.globalCompositeOperation = 'source-over';
    return off;
  }

  function processBrand(img) {
    // Simpler treatment: keep it more iconographic/brand-like, lighter phosphor wash
    const targetW = 200;
    const targetH = Math.round(targetW * (img.height / img.width));
    const off = document.createElement('canvas');
    off.width = targetW; off.height = targetH;
    const octx = off.getContext('2d');
    octx.fillStyle = '#000';
    octx.fillRect(0, 0, targetW, targetH);
    octx.drawImage(img, 0, 0, targetW, targetH);
    // Convert to luma * alpha
    const idata = octx.getImageData(0, 0, targetW, targetH);
    const d = idata.data;
    for (let i = 0; i < d.length; i += 4) {
      const a = d[i + 3] / 255;
      const l = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) * a;
      d[i] = d[i + 1] = d[i + 2] = l;
      d[i + 3] = 255;
    }
    octx.putImageData(idata, 0, 0);
    const sharp = document.createElement('canvas');
    sharp.width = targetW; sharp.height = targetH;
    sharp.getContext('2d').drawImage(off, 0, 0);
    octx.clearRect(0, 0, targetW, targetH);
    octx.fillStyle = '#000';
    octx.fillRect(0, 0, targetW, targetH);
    octx.globalAlpha = 0.5;
    octx.filter = 'blur(2px)';
    octx.drawImage(sharp, 0, 0);
    octx.globalAlpha = 1;
    octx.filter = 'blur(0.4px)';
    octx.drawImage(sharp, 0, 0);
    octx.filter = 'none';
    octx.globalCompositeOperation = 'multiply';
    octx.fillStyle = '#ffc68a';
    octx.fillRect(0, 0, targetW, targetH);
    for (let y = 0; y < targetH; y += 4) {
      octx.fillStyle = 'rgba(0,0,0,0.30)';
      octx.fillRect(0, y, targetW, 2);
    }
    octx.globalCompositeOperation = 'source-over';
    return off;
  }

  function processTurret(img) {
    // Center-crop the (likely 16:9) source to a square, then phosphor-treat it.
    // The result is the hero image on the home page.
    const SQ = 540;
    const off = document.createElement('canvas');
    off.width = SQ; off.height = SQ;
    const octx = off.getContext('2d');

    // 1) Center-crop into a square scratch canvas first
    const scratch = document.createElement('canvas');
    scratch.width = SQ; scratch.height = SQ;
    const sc = scratch.getContext('2d');
    const srcSize = Math.min(img.width, img.height);
    const sx = (img.width - srcSize) / 2;
    const sy = (img.height - srcSize) / 2;
    sc.drawImage(img, sx, sy, srcSize, srcSize, 0, 0, SQ, SQ);

    // 2) Convert to luma -> single channel grayscale on black
    const idata = sc.getImageData(0, 0, SQ, SQ);
    const d = idata.data;
    for (let i = 0; i < d.length; i += 4) {
      const l = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
      // Slight contrast lift so the silhouette pops on the dark CRT bg
      const v = Math.max(0, Math.min(255, (l - 30) * 1.25));
      d[i] = d[i + 1] = d[i + 2] = v;
      d[i + 3] = 255;
    }
    sc.putImageData(idata, 0, 0);

    // 3) Compose: halo + sharp pass
    octx.fillStyle = '#000';
    octx.fillRect(0, 0, SQ, SQ);
    octx.globalCompositeOperation = 'lighter';
    // bigger soft halo
    octx.globalAlpha = 0.45;
    octx.filter = 'blur(8px)';
    octx.drawImage(scratch, 0, 0);
    octx.globalAlpha = 0.7;
    octx.filter = 'blur(2.5px)';
    octx.drawImage(scratch, 0, 0);
    octx.globalAlpha = 1.0;
    octx.filter = 'blur(0.8px)';
    octx.drawImage(scratch, 0, 0);
    octx.filter = 'none';

    // 4) Phosphor tint
    octx.globalCompositeOperation = 'multiply';
    octx.fillStyle = '#ffb070';
    octx.fillRect(0, 0, SQ, SQ);

    // 5) Heavier scanline bake — reads as 'low-res sensor frame'
    octx.globalCompositeOperation = 'multiply';
    for (let y = 0; y < SQ; y += 2) {
      octx.fillStyle = 'rgba(0,0,0,0.55)';
      octx.fillRect(0, y, SQ, 1);
    }
    octx.globalCompositeOperation = 'source-over';
    return off;
  }

  async function bootAssets() {
    // Wait for images
    const ps = [];
    function waitImg(img) {
      return new Promise((res) => {
        if (img.complete && img.naturalWidth > 0) return res();
        // Safety timeout so a stuck image never wedges the boot — we'd
        // rather show a placeholder than hang the preloader forever.
        const to = setTimeout(() => res(), 4000);
        img.addEventListener('load',  () => { clearTimeout(to); res(); }, { once: true });
        img.addEventListener('error', () => { clearTimeout(to); res(); }, { once: true });
      });
    }
    ps.push(waitImg(assets.logo));
    ps.push(waitImg(assets.brand));
    ps.push(waitImg(assets.turret));
    if (assets.frame) ps.push(waitImg(assets.frame));
    if (document.fonts && document.fonts.ready) {
      // Cap font wait too — some hosts hang on fonts.ready forever
      ps.push(Promise.race([
        document.fonts.ready,
        new Promise((r) => setTimeout(r, 3000)),
      ]));
    }
    await Promise.all(ps);

    logoProcessed = processLogo(assets.logo);
    brandProcessed = processBrand(assets.brand);
    if (assets.turret.naturalWidth > 0 && assets.turret.naturalHeight > 0) {
      try { turretProcessed = processTurret(assets.turret); }
      catch (e) { console.warn('turret processing failed', e); }
    }
    assets.fontReady = true;

    // ensure a small minimum delay so the preloader doesn't flash
    await new Promise(r => setTimeout(r, 250));

    // tell the page to dismiss preloader, run resize, kick off the CRT
    document.dispatchEvent(new CustomEvent('sentinel:ready'));
  }

  // ── Phase machine ──────────────────────────────────────────────
  // States: 'preload' (canvas hidden via outer CSS), 'powerup' (warmup band -> screen),
  //         'boot' (text), 'splash' (logo), 'sand' (sand-dissolve), 'home', 'gate',
  //         'authing' (loader), 'deck'.
  let phase = 'preload';
  let phaseStart = performance.now();
  function setPhase(p) { phase = p; phaseStart = performance.now(); }
  function phaseElapsed() { return (performance.now() - phaseStart) / 1000; }

  document.addEventListener('sentinel:ready', () => {
    resize();
    setPhase('powerup');
    // Hide preloader visually (handled in HTML via CSS class on body)
    document.body.classList.add('sentinel-ready');
    requestAnimationFrame(frame);
  });

  // Brave + Chromium occasionally pause requestAnimationFrame when the tab
  // is opened in a new window with focus elsewhere. When the user comes
  // back, refire a frame so the loop catches up. Same for window resize.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      lastInteractAt = performance.now();
      requestAnimationFrame(frame);
    }
  });
  window.addEventListener('focus', () => {
    requestAnimationFrame(frame);
  });

  bootAssets();

  // ── Boot text ──────────────────────────────────────────────────
  // Slowed by ~25% from before. Total runtime ~6.5s.
  const BOOT_LINES = [
    [0.7,  'SENTINEL BIOS v3.14.02'],
    [0.85, 'Copyright (C) 2026 Sentinel Robotics'],
    [1.05, ''],
    [1.20, 'POST .................................. [ OK ]'],
    [1.50, 'CPU CLOCK CHECK ....................... [ 12.0 MHz ]'],
    [1.80, 'MEMORY ................................ [ 640K OK ]'],
    [2.10, 'EXTENDED MEMORY ....................... [ 7424K OK ]'],
    [2.40, 'CRT CONTROLLER ........................ [ MDA / EGA ]'],
    [2.70, 'AUTONOMOUS PLATFORM ................... [ MKIII ]'],
    [3.00, 'SAFETY INTERLOCK ...................... [ ENGAGED ]'],
    [3.30, 'NEURAL TARGETING DAEMON ............... [ READY ]'],
    [3.60, 'TELEMETRY UPLINK ...................... [ ON-LINE ]'],
    [3.90, ''],
    [4.20, 'Mounting /sentinel ........ ok'],
    [4.45, 'Loading species.signature.db ........ 7 entries'],
    [4.70, 'Loading engagement.doctrine ........ ok'],
    [4.95, ''],
    [5.20, 'All systems nominal.'],
    [5.55, ''],
    [5.80, '> RUN SENTINEL.EXE'],
  ];

  // ── Cursor blink ───────────────────────────────────────────────
  let cursorOn = true;
  setInterval(() => { cursorOn = !cursorOn; }, 530);

  // ── Type sizes ─────────────────────────────────────────────────
  const FONT       = '20px "VT323", "Courier New", monospace';
  const FONT_SMALL = '15px "VT323", "Courier New", monospace';
  const FONT_BIG   = '34px "VT323", "Courier New", monospace';
  const FONT_HUGE  = '48px "VT323", "Courier New", monospace';

  // ── Mouse / hit testing ────────────────────────────────────────
  let mouseScreen = { x: -1, y: -1 };
  out.addEventListener('mousemove', (e) => {
    const r = out.getBoundingClientRect();
    mouseScreen.x = ((e.clientX - r.left) / r.width) * SCREEN_W;
    mouseScreen.y = ((e.clientY - r.top) / r.height) * SCREEN_H;
  });
  out.addEventListener('mouseleave', () => { mouseScreen.x = -1; mouseScreen.y = -1; });

  // Re-check what's hit at click time, computed inside each draw.
  let hits = []; // [{x,y,w,h, action}]
  function isHover(h) {
    return mouseScreen.x >= h.x && mouseScreen.x <= h.x + h.w &&
           mouseScreen.y >= h.y && mouseScreen.y <= h.y + h.h;
  }
  out.addEventListener('click', () => {
    // boot/splash: clicking in those phases skips ahead
    if (phase === 'boot') { setPhase('splash'); return; }
    if (phase === 'splash') { startSandDissolve(); return; }
    for (const h of hits) {
      if (isHover(h)) { h.action(); return; }
    }
  });

  // ── Sand-dissolve ──────────────────────────────────────────────
  // We snapshot the splash into an offscreen canvas and progressively erase
  // pixels from it as the wind eats it from left -> right and top -> bottom.
  // The drawn frame is: [eroded splash snapshot] + [thousands of in-flight grains].
  // The home is NEVER drawn underneath — it crossfades in only after the sand
  // is fully gone. This is what gives it the "windswept destruction" feel.
  let sandSnap = null;          // {canvas, ctx, mask}  the eroding splash
  let sandParticles = null;     // active flying grains
  let sandStartedAt = 0;
  let sandFadeStart = 0;        // ms when home starts to crossfade in

  function startSandDissolve() {
    // 1) Snapshot the current source canvas (the splash) into an offscreen.
    const snap = document.createElement('canvas');
    snap.width = SCREEN_W; snap.height = SCREEN_H;
    const sctxSnap = snap.getContext('2d');
    sctxSnap.drawImage(src, 0, 0);

    // 2) Build a per-pixel "release time" map. Pixels closer to the wind
    //    front (top-left) leave earlier; pixels lower-right hold on longer.
    //    A bit of low-frequency noise breaks up the front so it looks like
    //    real wind, not a wipe.
    const W = SCREEN_W, H = SCREEN_H;
    const front = new Float32Array(W * H);
    // Generate a few sin-wave noise octaves baked into the front
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        // Diagonal sweep top-left -> bottom-right
        const sweep = (x * 0.55 + y * 0.45) / (W * 0.55 + H * 0.45);
        // Per-pixel noise so the wave edge is ragged
        const n =
          Math.sin(x * 0.018 + y * 0.022) * 0.18 +
          Math.sin(x * 0.045 - y * 0.035) * 0.10 +
          Math.sin(x * 0.090 + y * 0.060) * 0.05;
        front[y * W + x] = sweep + n; // ~0..1 with ragged edges
      }
    }
    sandSnap = { canvas: snap, ctx: sctxSnap, front, w: W, h: H, eroded: new Uint8Array(W * H) };

    // 3) Sample particles. We sample DENSELY so the flying grains feel
    //    like a sand plume, not pointillism.
    const STEP = 4;
    const imgData = sctxSnap.getImageData(0, 0, W, H);
    const d = imgData.data;
    const grains = [];
    for (let y = 0; y < H; y += STEP) {
      for (let x = 0; x < W; x += STEP) {
        const i = (y * W + x) * 4;
        const r = d[i], g = d[i + 1], b = d[i + 2];
        if (r + g + b < 50) continue;
        // particle release time = its pixel's front value, in seconds (over ~2.5s)
        const rel = front[y * W + x] * 2.5 + (Math.random() - 0.5) * 0.10;
        grains.push({
          ox: x, oy: y,
          r, g, b,
          rel,
          // strong wind base + per-grain variance — some get caught and tumble
          vx: 320 + Math.random() * 480,
          // mild lift then heavy fall — sand thrown sideways and then dropping
          vy0: -40 + Math.random() * 80,
          fall: 220 + Math.random() * 180,
          // turbulence frequency/phase per grain
          tf: 1.2 + Math.random() * 2.6,
          tp: Math.random() * Math.PI * 2,
          ta: 22 + Math.random() * 38,
          // size: most are 1px, a few are 2px, very few 3px (visual variety)
          size: Math.random() < 0.12 ? 2 : 1,
        });
      }
    }
    sandParticles = grains;
    sandStartedAt = performance.now();
    sandFadeStart = 0;
    setPhase('sand');
  }

  function drawSandDissolve(elapsed) {
    if (!sandSnap || !sandParticles) return;
    const t = elapsed;

    // 1) Fade home in only AFTER the sand is largely cleared.
    //    During the blow-away, the bg is just deep BG.
    clear();

    // 2) Erode the splash snapshot: clear pixels whose front <= t/duration.
    //    We do this incrementally each frame for performance — only newly
    //    eroded blocks are punched out.
    const SAND_DURATION = 2.2;     // when the front reaches the bottom-right
    const TAIL_DURATION = 1.2;     // grains keep flying off-screen
    const progress = Math.min(1.0, t / SAND_DURATION);
    eroSnapshot(sandSnap, progress);

    // 3) Draw the (eroded) splash snapshot
    sctx.drawImage(sandSnap.canvas, 0, 0);

    // 4) Draw flying grains as colored streaks. Streaks are stamped twice
    //    (head + tail) so we get motion blur cheaply.
    sctx.save();
    let aliveCount = 0;
    for (const p of sandParticles) {
      const tt = t - p.rel;
      if (tt < 0) continue;       // not released yet
      // life: time since release; arc out and fall
      const turbX = Math.sin(p.tp + tt * p.tf) * p.ta;
      const turbY = Math.cos(p.tp * 1.7 + tt * p.tf * 0.9) * p.ta * 0.6;
      const x = p.ox + p.vx * tt + turbX;
      const y = p.oy + p.vy0 * tt + 0.5 * p.fall * tt * tt + turbY;
      if (x > SCREEN_W + 30 || y > SCREEN_H + 30 || x < -30) continue;
      aliveCount++;
      const life = Math.max(0, 1 - tt * 0.55);
      if (life <= 0) continue;

      // Trail: previous position, dimmer
      const x0 = x - p.vx * 0.020 - turbX * 0.5;
      const y0 = y - (p.vy0 + p.fall * tt) * 0.020 - turbY * 0.5;
      sctx.globalAlpha = life * 0.35;
      sctx.fillStyle = `rgb(${p.r|0},${p.g|0},${p.b|0})`;
      sctx.fillRect(x0, y0, p.size, p.size);

      // Head
      sctx.globalAlpha = life;
      sctx.fillRect(x, y, p.size, p.size);
    }
    sctx.globalAlpha = 1;
    sctx.restore();

    // 5) Once erosion is done AND most grains have flown off, crossfade
    //    in the home page. Crossfade is implemented by drawing the home
    //    underneath with rising alpha, on top of the (now empty) snapshot.
    if (progress >= 1.0) {
      if (sandFadeStart === 0) sandFadeStart = performance.now();
      const fadeT = Math.min(1, (performance.now() - sandFadeStart) / 700);
      if (fadeT > 0) {
        // Render home into a scratch and composite with the dissolving particles
        sctx.globalAlpha = fadeT;
        // We need the home rendered into a temp canvas to layer it cleanly.
        ensureHomeScratch();
        sctx.drawImage(homeScratch, 0, 0);
        sctx.globalAlpha = 1;
      }
      if (fadeT >= 1 && aliveCount === 0) {
        sandSnap = null;
        sandParticles = null;
        setPhase('home');
      }
      // safety: kill at fixed time if particles never finish
      if (t > SAND_DURATION + TAIL_DURATION + 1.0) {
        sandSnap = null;
        sandParticles = null;
        setPhase('home');
      }
    }
  }

  // Erode the snapshot in-place by clearing pixels whose front threshold
  // has been crossed since the last call. We track which pixels we've
  // already cleared via a Uint8Array to keep this O(newly-eroded).
  function eroSnapshot(snap, progress) {
    const { ctx, front, w, h, eroded } = snap;
    // Iterate in 8x8 blocks for cheap clears
    const BLOCK = 8;
    for (let by = 0; by < h; by += BLOCK) {
      for (let bx = 0; bx < w; bx += BLOCK) {
        const idx = by * w + bx;
        if (eroded[idx]) continue;
        // Sample the block's center value as a proxy
        const cx = Math.min(bx + BLOCK / 2, w - 1);
        const cy = Math.min(by + BLOCK / 2, h - 1);
        const f = front[(cy | 0) * w + (cx | 0)];
        if (f <= progress) {
          ctx.clearRect(bx, by, BLOCK, BLOCK);
          // mark all corners of this block as eroded (cheap; the if-continue above handles it)
          eroded[idx] = 1;
        }
      }
    }
  }

  // Cache home rendering to avoid re-rasterizing it every frame during the fade
  let homeScratch = null;
  let homeScratchAt = 0;
  function ensureHomeScratch() {
    const now = performance.now();
    if (homeScratch && now - homeScratchAt < 300) return;
    if (!homeScratch) {
      homeScratch = document.createElement('canvas');
      homeScratch.width = SCREEN_W; homeScratch.height = SCREEN_H;
    }
    // Render home into the scratch by temporarily redirecting output.
    const realCtx = sctx;
    // We can't easily redirect; instead just draw the home into the scratch
    // by reusing the current source pipeline: snapshot-and-render approach.
    // Simpler: draw home onto src, then copy src into homeScratch, then
    // restore the eroded splash on top in the caller. To keep things
    // separated, we build an *isolated* home renderer below.
    drawHomeInto(homeScratch.getContext('2d'));
    homeScratchAt = now;
  }

  // Render the home page into a passed-in 2D context (no global side-effects).
  // Used for crossfading the home in cleanly during the sand dissolve.
  function drawHomeInto(ctx) {
    const oldSctx = sctx;
    // sctx is a closure-bound name we can't reassign; use an assignment
    // trick via a wrapper: every drawHome path uses `sctx`. To keep that
    // working, we temporarily swap the canvas the global sctx points at
    // by drawing into src (the real source canvas) then copying. This is
    // simpler than refactoring all draw helpers.
    // → save real src state, draw home into src, copy to ctx, restore.
    //   We'll re-render the splash snapshot in the caller anyway.
    // BUT: during the sand phase, the visible frame is composed of
    // [splash erosion] + [grains], not src. So we can safely draw home into
    // src here and copy out without affecting what the user sees this frame
    // — we redraw src at the very end of drawSandDissolve via drawImage of
    // sandSnap and grains. Wait — actually we do clear() and drawImage(snap)
    // at the start. So we can't trash src mid-frame.
    // Easiest: do nothing fancy; render home into ctx by calling drawHome
    // after temporarily redirecting all sctx.* calls. We do that by
    // reassigning sctx via a let. (See below: we changed sctx to be reassigned
    // from src.getContext to ctx for this call.)
    sctxRedirect(ctx);
    drawHome(0, /*duringSand*/ true);
    sctxRedirect(null); // back to real
  }

  // sctx redirection — used to render the home page into a scratch canvas
  // for crossfade compositing, without touching the live frame.
  let _realSctx = null;
  function sctxRedirect(targetCtx) {
    if (targetCtx) {
      if (!_realSctx) _realSctx = sctx;
      sctx = targetCtx;
    } else if (_realSctx) {
      sctx = _realSctx;
      _realSctx = null;
    }
  }

  // ── Drawing helpers ────────────────────────────────────────────
  function clear() {
    sctx.fillStyle = BG;
    sctx.fillRect(0, 0, SCREEN_W, SCREEN_H);
  }
  function wrapText(text, x, y, maxW, lineH, color) {
    if (color) sctx.fillStyle = color;
    const paragraphs = text.split('\n');
    let yy = y;
    for (const para of paragraphs) {
      if (para === '') { yy += lineH; continue; }
      const words = para.split(' ');
      let line = '';
      for (const w of words) {
        const test = line ? line + ' ' + w : w;
        if (sctx.measureText(test).width > maxW && line) {
          sctx.fillText(line, x, yy);
          yy += lineH;
          line = w;
        } else { line = test; }
      }
      if (line) { sctx.fillText(line, x, yy); yy += lineH; }
    }
    return yy;
  }

  function drawChrome(title) {
    clear();
    // header
    sctx.fillStyle = PHOSPHOR;
    sctx.font = FONT_BIG;
    sctx.textBaseline = 'top';
    sctx.textAlign = 'left';
    sctx.fillText('SENTINEL ROBOTICS', 70, 50);
    sctx.font = FONT_SMALL;
    sctx.fillStyle = PHOSPHOR_DIM;
    sctx.fillText('AUTONOMOUS PLATFORMS  ·  TERMINAL v3.14.02', 70, 92);
    if (title) {
      sctx.fillStyle = PHOSPHOR_DIM;
      sctx.font = FONT_SMALL;
      sctx.textAlign = 'right';
      sctx.fillText(title, SCREEN_W - 70, 92);
      sctx.textAlign = 'left';
    }
    sctx.fillStyle = PHOSPHOR_FAINT;
    sctx.fillRect(70, 130, SCREEN_W - 140, 1);

    // footer divider + copyright
    sctx.fillStyle = PHOSPHOR_FAINT;
    sctx.fillRect(70, SCREEN_H - 70, SCREEN_W - 140, 1);
    sctx.fillStyle = PHOSPHOR_DIM;
    sctx.font = FONT_SMALL;
    sctx.fillText('© 2026 SENTINEL ROBOTICS  ·  COMMERCIAL IN CONFIDENCE', 70, SCREEN_H - 56);
  }

  // ── Boot phase ─────────────────────────────────────────────────
  function drawBoot(elapsed) {
    clear();
    const padX = 70, padY = 70, lineH = 28;
    sctx.font = FONT;
    sctx.fillStyle = PHOSPHOR;
    sctx.textBaseline = 'top';
    sctx.textAlign = 'left';

    let lastY = padY;
    for (const [t, s] of BOOT_LINES) {
      if (t > elapsed) break;
      sctx.fillText(s, padX, lastY);
      lastY += lineH;
    }
    if (cursorOn) sctx.fillRect(padX, lastY + 4, 12, 18);

    if (elapsed > 6.5) setPhase('splash');
  }

  // ── Splash phase ───────────────────────────────────────────────
  function drawSplash(elapsed) {
    clear();
    if (!logoProcessed) return;
    const fade = Math.min(1, elapsed / 0.6);
    const flicker = elapsed < 0.35 ? (0.55 + Math.random() * 0.45) : 1;
    const w = logoProcessed.width, h = logoProcessed.height;
    const cx = (SCREEN_W - w) / 2;
    const cy = (SCREEN_H - h) / 2 - 40;
    sctx.globalAlpha = fade * flicker;
    sctx.globalCompositeOperation = 'lighter';
    sctx.drawImage(logoProcessed, cx, cy, w, h);
    sctx.globalCompositeOperation = 'source-over';
    sctx.globalAlpha = 1;

    if (elapsed > 0.9) {
      const tagFade = Math.min(1, (elapsed - 0.9) / 0.5);
      sctx.globalAlpha = tagFade;
      sctx.fillStyle = PHOSPHOR;
      sctx.font = FONT_SMALL;
      sctx.textAlign = 'center';
      sctx.textBaseline = 'middle';
      sctx.fillText('AUTONOMOUS PLATFORMS  ·  ESTABLISHED 2025', SCREEN_W / 2, cy + h + 36);
      sctx.globalAlpha = 1;
      sctx.textAlign = 'left';
    }
    if (elapsed > 1.5) {
      const blink = Math.floor(elapsed * 1.6) % 2 === 0;
      if (blink) {
        sctx.fillStyle = PHOSPHOR;
        sctx.font = FONT;
        sctx.textAlign = 'center';
        sctx.fillText('PRESS ANY KEY TO CONTINUE', SCREEN_W / 2, SCREEN_H - 110);
        sctx.textAlign = 'left';
      }
    }
  }

  // ── Home page (sentinel.exe) ───────────────────────────────────
  // Single page: brand mark + headline + blurb + contact + investor-portal button.
  const BLURB = [
    'PROJECT SENTINEL is an autonomous ground platform for persistent, operator-authorised kinetic response across two converging domains — biosecurity and counter-drone (C-UAS).',
    '',
    'US biosecurity is a $21B+/year problem (USGS) — invasive vertebrates, agricultural pests, and disease vectors. Feral hogs alone destroy $2.5B in crops across 35+ states.',
    '',
    'C-UAS is forecast to exceed $10B by 2030 as low-cost drone threats outpace missile-priced air defence. The need: persistent, autonomous, low-cost effectors at the perimeter.',
    '',
    'One platform, both fights. Electric. Belt-fed. AI-targeted. Operator-authorised. A single confirmed target. A single round. A single recorded result. At scale.',
  ].join('\n');

  function drawHome(elapsed, duringSand) {
    drawChrome(null);
    hits = [];

    // ── Left column: copy ──────────────────────────────────────
    const leftX = 80;
    const leftW = 700;
    sctx.textBaseline = 'top';

    // small brand mark above headline
    if (brandProcessed) {
      sctx.globalCompositeOperation = 'lighter';
      sctx.drawImage(brandProcessed, leftX, 168, 56, 56);
      sctx.globalCompositeOperation = 'source-over';
    }
    sctx.fillStyle = PHOSPHOR_DIM;
    sctx.font = FONT_SMALL;
    sctx.fillText('// SENTINEL ROBOTICS', leftX + 72, 180);
    sctx.fillText('DUAL-USE  ·  KINETIC  ·  FIELD-DEPLOYED', leftX + 72, 200);

    // headline
    sctx.fillStyle = PHOSPHOR;
    sctx.font = FONT_HUGE;
    sctx.fillText('AUTONOMOUS GROUND', leftX, 248);
    sctx.fillText('INTERDICTION.', leftX, 296);

    // blurb
    sctx.fillStyle = PHOSPHOR;
    sctx.font = FONT;
    const blurbEndY = wrapText(BLURB, leftX, 372, leftW, 24);

    // Investor button under copy
    const btnLabel = '►  ACCESS INVESTOR PORTAL';
    sctx.font = FONT;
    const btnW = sctx.measureText(btnLabel).width + 60;
    const btnX = leftX;
    const btnY = Math.min(blurbEndY + 28, SCREEN_H - 200);
    const btnH = 44;
    const btnHover = mouseScreen.x >= btnX && mouseScreen.x <= btnX + btnW &&
                     mouseScreen.y >= btnY && mouseScreen.y <= btnY + btnH;
    sctx.strokeStyle = btnHover ? PHOSPHOR_BRIGHT : PHOSPHOR;
    sctx.lineWidth = 1;
    sctx.strokeRect(btnX, btnY, btnW, btnH);
    sctx.fillStyle = btnHover ? PHOSPHOR_BRIGHT : PHOSPHOR;
    sctx.textBaseline = 'middle';
    sctx.fillText(btnLabel, btnX + 18, btnY + btnH / 2 + 2);
    sctx.textBaseline = 'top';
    if (!duringSand) {
      hits.push({ x: btnX, y: btnY, w: btnW, h: btnH, action: () => { gateInput = ''; gateError = false; setPhase('gate'); } });
    }

    // contact line
    sctx.fillStyle = PHOSPHOR_DIM;
    sctx.font = FONT_SMALL;
    sctx.fillText('CONTACT  ·  ROB SWATTON  ·  PRINCIPAL DEVELOPER  ·  rob@sentinelrobotic.com',
      leftX, btnY + btnH + 22);

    // ── Right column: turret hero ──────────────────────────────
    const heroSize = 380;
    const heroX = SCREEN_W - 80 - heroSize;
    const heroY = 168;
    if (turretProcessed) {
      sctx.globalCompositeOperation = 'lighter';
      sctx.drawImage(turretProcessed, heroX, heroY, heroSize, heroSize);
      sctx.globalCompositeOperation = 'source-over';
    } else {
      // placeholder bracket-frame
      sctx.strokeStyle = PHOSPHOR_DIM;
      sctx.strokeRect(heroX, heroY, heroSize, heroSize);
    }
    // HUD-ish corner brackets around the hero
    sctx.strokeStyle = PHOSPHOR;
    sctx.lineWidth = 2;
    const br = 18;
    const corners = [
      [heroX, heroY, 1, 1],
      [heroX + heroSize, heroY, -1, 1],
      [heroX, heroY + heroSize, 1, -1],
      [heroX + heroSize, heroY + heroSize, -1, -1],
    ];
    for (const [cx, cy, dx, dy] of corners) {
      sctx.beginPath();
      sctx.moveTo(cx, cy + br * dy);
      sctx.lineTo(cx, cy);
      sctx.lineTo(cx + br * dx, cy);
      sctx.stroke();
    }
    sctx.lineWidth = 1;

    // sensor-readout label under the hero
    sctx.fillStyle = PHOSPHOR_DIM;
    sctx.font = FONT_SMALL;
    sctx.fillText('// MKIII PROTOTYPE  ·  RANGE TEST  ·  2026.04', heroX, heroY + heroSize + 14);
    sctx.fillText('FRAME ' + (1200 + Math.floor((performance.now() / 33) % 800)).toString().padStart(5, '0') +
                  '   GAIN +12dB   IR PASS', heroX, heroY + heroSize + 36);
  }

  // ── Gate ───────────────────────────────────────────────────────
  let gateInput = '';
  let gateError = false;
  const ACCESS_CODE = 'paxamericana';

  function drawGate(elapsed) {
    drawChrome('// INVESTOR ACCESS');
    hits = [];

    sctx.fillStyle = PHOSPHOR_DIM;
    sctx.font = FONT_SMALL;
    sctx.fillText('// AUTHORISATION REQUIRED', 80, 180);
    sctx.fillStyle = PHOSPHOR;
    sctx.font = FONT_HUGE;
    sctx.fillText('SECURE GATEWAY', 80, 210);
    sctx.fillStyle = PHOSPHOR;
    sctx.font = FONT;
    sctx.fillText('Phase 01 investor materials are gated.', 80, 280);
    sctx.fillText('Enter access code to continue.', 80, 308);

    // Input box
    const boxX = 80, boxY = 380, boxW = SCREEN_W - 160, boxH = 56;
    sctx.strokeStyle = gateError ? '#d04a2a' : PHOSPHOR;
    sctx.lineWidth = 1;
    sctx.strokeRect(boxX, boxY, boxW, boxH);
    sctx.fillStyle = PHOSPHOR_DIM;
    sctx.font = FONT_SMALL;
    sctx.fillText('ACCESS CODE', boxX + 14, boxY - 20);
    sctx.fillStyle = PHOSPHOR;
    sctx.font = FONT_BIG;
    sctx.textBaseline = 'middle';
    const masked = gateInput.replace(/./g, '●');
    sctx.fillText(masked, boxX + 18, boxY + boxH / 2 + 2);
    if (cursorOn) {
      const w = sctx.measureText(masked).width;
      sctx.fillRect(boxX + 18 + w + 4, boxY + boxH / 2 - 12, 14, 24);
    }
    sctx.textBaseline = 'top';

    if (gateError) {
      sctx.fillStyle = '#d04a2a';
      sctx.font = FONT;
      sctx.fillText('  ACCESS DENIED · INVALID CREDENTIALS', boxX, boxY + boxH + 18);
    }

    // Buttons
    const btnY = boxY + boxH + 70;
    sctx.font = FONT;
    const submit = '[ ENTER ]  AUTHENTICATE';
    const submitW = sctx.measureText(submit).width + 40;
    const sHover = mouseScreen.x >= boxX && mouseScreen.x <= boxX + submitW &&
                   mouseScreen.y >= btnY && mouseScreen.y <= btnY + 40;
    sctx.strokeStyle = sHover ? PHOSPHOR_BRIGHT : PHOSPHOR;
    sctx.strokeRect(boxX, btnY, submitW, 40);
    sctx.fillStyle = sHover ? PHOSPHOR_BRIGHT : PHOSPHOR;
    sctx.textBaseline = 'middle';
    sctx.fillText(submit, boxX + 14, btnY + 22);
    sctx.textBaseline = 'top';
    hits.push({ x: boxX, y: btnY, w: submitW, h: 40, action: tryAuth });

    // Back
    const back = '[ ESC ]  RETURN';
    const backW = sctx.measureText(back).width + 30;
    const backX = boxX + boxW - backW;
    const bHover = mouseScreen.x >= backX && mouseScreen.x <= backX + backW &&
                   mouseScreen.y >= btnY && mouseScreen.y <= btnY + 40;
    sctx.strokeStyle = bHover ? PHOSPHOR_BRIGHT : PHOSPHOR_DIM;
    sctx.strokeRect(backX, btnY, backW, 40);
    sctx.fillStyle = bHover ? PHOSPHOR_BRIGHT : PHOSPHOR_DIM;
    sctx.textBaseline = 'middle';
    sctx.fillText(back, backX + 14, btnY + 22);
    sctx.textBaseline = 'top';
    hits.push({ x: backX, y: btnY, w: backW, h: 40, action: () => setPhase('home') });

    // Hint
    sctx.fillStyle = PHOSPHOR_DIM;
    sctx.font = FONT_SMALL;
    sctx.fillText('TYPE CODE  ·  ENTER TO AUTHENTICATE  ·  ESC TO RETURN', boxX, SCREEN_H - 110);
  }

  function tryAuth() {
    if (gateInput.toLowerCase() === ACCESS_CODE) {
      gateInput = '';
      gateError = false;
      setPhase('authing');
    } else {
      gateError = true;
    }
  }

  // ── Auth loading screen ────────────────────────────────────────
  // ~5s of detailed steps before deck is presented.
  const AUTH_STEPS = [
    [0.0,  'CREDENTIAL HASH MATCH .................. [ OK ]'],
    [0.4,  'SESSION TOKEN ISSUED ................... [ 0x3F2A ]'],
    [0.8,  'KEY DERIVATION (SCRYPT) ................ [ ROUND 4/4 ]'],
    [1.2,  'CONNECTING TO INVESTOR RELAY ........... ' ],
    [1.7,  '  · sentinel-east-1 ............ ESTABLISHED'],
    [2.0,  '  · sentinel-eu-w  ............. ESTABLISHED'],
    [2.4,  'TLS 1.3 HANDSHAKE ...................... [ OK ]'],
    [2.7,  'ATTESTATION (TPM) ...................... [ TRUSTED ]'],
    [3.1,  'FETCHING INVESTOR MANIFEST ............. [ 12 SLIDES ]'],
    [3.5,  'DECRYPTING DECK (AES-256-GCM) .......... [ OK ]'],
    [3.9,  'WATERMARKING SESSION ................... ' ],
    [4.3,  '  · viewer = INV-' + (Math.floor(Math.random() * 9000) + 1000)],
    [4.6,  '  · timestamp = ' + new Date().toISOString().replace('T', ' ').slice(0, 19) + 'Z'],
    [4.9,  'AUDIT LOG WRITTEN ...................... [ OK ]'],
    [5.2,  ''],
    [5.4,  '> ACCESS GRANTED.'],
  ];

  function drawAuthing(elapsed) {
    drawChrome('// AUTHENTICATING');
    sctx.fillStyle = PHOSPHOR;
    sctx.font = FONT;
    let y = 180;
    for (const [t, s] of AUTH_STEPS) {
      if (t > elapsed) break;
      sctx.fillText(s, 80, y);
      y += 28;
    }
    // progress bar
    const total = 5.4;
    const pct = Math.min(1, elapsed / total);
    const barX = 80, barY = SCREEN_H - 130, barW = SCREEN_W - 160, barH = 18;
    sctx.strokeStyle = PHOSPHOR_DIM;
    sctx.strokeRect(barX, barY, barW, barH);
    sctx.fillStyle = PHOSPHOR;
    sctx.fillRect(barX + 2, barY + 2, (barW - 4) * pct, barH - 4);
    sctx.fillStyle = PHOSPHOR_DIM;
    sctx.font = FONT_SMALL;
    sctx.fillText(`${(pct * 100).toFixed(0)}%`, barX, barY - 22);

    if (elapsed > total + 0.6) {
      setPhase('deck');
      // notify HTML to show deck overlay
      document.dispatchEvent(new CustomEvent('sentinel:enter-deck'));
    }
  }

  function drawDeckShell() {
    // While deck is shown via HTML overlay (PDF.js iframe), render a minimal
    // backdrop so any peek-through is on-brand.
    drawChrome('// INVESTOR DECK');
    sctx.fillStyle = PHOSPHOR_DIM;
    sctx.font = FONT_SMALL;
    sctx.fillText('Deck rendered above this terminal.', 80, 180);
  }

  // ── Keyboard ───────────────────────────────────────────────────
  window.addEventListener('keydown', (e) => {
    if (phase === 'boot') {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape') setPhase('splash');
      return;
    }
    if (phase === 'splash') {
      if (phaseElapsed() > 1.2) startSandDissolve();
      return;
    }
    if (phase === 'home') return;
    if (phase === 'gate') {
      gateError = false;
      if (e.key === 'Enter') { tryAuth(); return; }
      if (e.key === 'Escape') { setPhase('home'); return; }
      if (e.key === 'Backspace') { gateInput = gateInput.slice(0, -1); return; }
      if (e.key.length === 1 && gateInput.length < 32) { gateInput += e.key; return; }
    }
    if (phase === 'deck') {
      if (e.key === 'Escape') {
        document.dispatchEvent(new CustomEvent('sentinel:exit-deck'));
        setPhase('home');
      }
    }
  });

  // ── Frame loop ─────────────────────────────────────────────────
  let powerOnAt = 0;

  function frame() {
    const now = performance.now();
    const elapsed = phaseElapsed();

    // Draw to source canvas
    if (phase === 'powerup') {
      clear();
      // power-up phase is short; 0..1 ramps via uniform
      if (elapsed > 0.9) setPhase('boot');
    } else if (phase === 'boot') {
      drawBoot(elapsed);
    } else if (phase === 'splash') {
      drawSplash(elapsed);
    } else if (phase === 'sand') {
      drawSandDissolve(elapsed);
    } else if (phase === 'home') {
      drawHome(elapsed, false);
    } else if (phase === 'gate') {
      drawGate(elapsed);
    } else if (phase === 'authing') {
      drawAuthing(elapsed);
    } else if (phase === 'deck') {
      drawDeckShell();
    }

    // Upload texture
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);

    // Power ramp: cold-start when entering 'powerup' phase, then stays at 1.
    if (phase === 'powerup') {
      powerOnAt = phaseStart;
    }
    const sincePower = (now - powerOnAt) / 1000;
    const power = Math.min(1, Math.max(0, (sincePower - 0.05) / 0.85));

    // Idle line-noise (NEW: per-line jitter, not curvy wave) — ramps in slowly
    // and tops out lower than before. The user can still read the home page.
    const idle = Math.max(0, (now - lastInteractAt) / 1000 - 30);
    const idleNoise = Math.min(0.55, idle / 60);
    // External chaos override (e.g. the broken pitch-deck sequence) — this
    // lifts the cap so the screen can really fall apart when we tell it to.
    const lineNoise = Math.min(1.5, Math.max(idleNoise, chaosBoost));

    // Occasional vertical-roll trigger when noisy. With chaos, fire much
    // more often and harder.
    let vsync = 0;
    const rollThresh = chaosBoost > 0.2 ? 0.05 : 0.4;
    if (lineNoise > rollThresh) {
      // pseudo-random discrete drops; bucket size shrinks with chaos so
      // they fire more frequently
      const bucket = Math.max(220, 1400 - chaosBoost * 800);
      const seed = Math.floor(now / bucket);
      const r = Math.abs(Math.sin(seed * 12.345)) % 1;
      if (r < 0.18 + lineNoise * 0.22 + chaosBoost * 0.4) {
        const phaseT = (now % bucket) / (bucket * 0.1);
        if (phaseT < 1) vsync = 0.018 * lineNoise * (1 - phaseT) * (1 + chaosBoost * 4);
      }
    }

    gl.uniform2f(u.res, out.width, out.height);
    gl.uniform1f(u.time, now / 1000);
    gl.uniform1f(u.power, power);
    gl.uniform1f(u.glow, 0.65 + chaosBoost * 0.4);
    gl.uniform1f(u.aberration, 1.0 + chaosBoost * 3.0);
    gl.uniform1f(u.scanIntensity, 0.28 + chaosBoost * 0.25);
    gl.uniform1f(u.lineNoise, lineNoise);
    // Cluster slowly walks down the screen at ~0.05 uv/sec, with a sine wobble.
    // Spread shrinks as noise rises, so heavy idle = tighter, more obvious band.
    const cluster = (now / 1000 * 0.05 + Math.sin(now / 1000 * 0.13) * 0.18) % 1.0;
    const clusterY = (cluster + 1.0) % 1.0;
    const spread = 0.22 - lineNoise * 0.10;
    gl.uniform1f(u.noiseCluster, clusterY);
    gl.uniform1f(u.noiseSpread, Math.max(0.05, spread));
    gl.uniform1f(u.vsync, vsync);
    gl.uniform1f(u.effectsDisable, cleanMode ? 1.0 : 0.0);
    // Subtle barrel curvature; bottom slightly more pronounced.
    gl.uniform1f(u.curvAmount, cleanMode ? 0.0 : 0.018);
    gl.uniform1f(u.curvBottomBias, cleanMode ? 0.0 : 0.45);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    requestAnimationFrame(frame);
  }

  // ── Public toggles for deck fullscreen ─────────────────────────
  window.SentinelCRT = {
    setCleanMode(on) {
      cleanMode = !!on;
      resize();
    },
    // 0..1 — extra noise/aberration/vsync rolls on top of idle baseline.
    // Used by the pitch-deck "broken broadcast" sequence.
    setChaos(v) {
      chaosBoost = Math.max(0, Math.min(1, +v || 0));
    },
    getChaos() { return chaosBoost; },
  };
})();
