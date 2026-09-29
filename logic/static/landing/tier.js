// Rough device tier for picking particle counts and render resolution: 0 = weak .. 3 = strong.
// Based on the GPU name WebGL reports, CPU cores, memory and screen type. It's a starting guess;
// pages should still watch their frame rate and back off if it's low.
window.gpuTier = (function () {
  let gpu = '';
  try {
    const gl = document.createElement('canvas').getContext('webgl');
    const dbg = gl && gl.getExtension('WEBGL_debug_renderer_info');
    gpu = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : '';
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
  } catch {}
  let score = 1;
  if (/nvidia|geforce|rtx|quadro|radeon rx|radeon pro|apple m\d (pro|max|ultra)/i.test(gpu)) score += 2;
  else if (/apple m\d|apple gpu|iris xe|arc|radeon/i.test(gpu)) score += 1;
  if (/swiftshader|llvmpipe|software|basic render/i.test(gpu)) score -= 2;
  if ((navigator.hardwareConcurrency || 4) >= 8) score += 0.5;
  if ((navigator.deviceMemory || 4) >= 8) score += 0.5;
  if (matchMedia('(pointer: coarse)').matches) score -= 1;   // phones / tablets
  const tier = Math.max(0, Math.min(3, Math.round(score)));
  return { tier, gpu };
})();
