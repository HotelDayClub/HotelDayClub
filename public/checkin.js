(function () {
  const btn = document.getElementById('scan-btn');
  const box = document.getElementById('scan-box');
  const video = document.getElementById('scan-video');
  const stopBtn = document.getElementById('scan-stop');
  const form = document.querySelector('form.check-code');
  const note = document.getElementById('scan-note');
  if (!btn || !form || !video) return;
  let stream = null;
  let raf = 0;
  let running = false;
  function say(text) { if (note) note.textContent = text || ''; }
  function stop() {
    running = false;
    if (raf) cancelAnimationFrame(raf);
    if (stream) stream.getTracks().forEach(track => track.stop());
    stream = null;
    if (box) box.hidden = true;
  }
  if (stopBtn) stopBtn.addEventListener('click', stop);
  btn.addEventListener('click', async () => {
    say('');
    if (typeof jsQR !== 'function') { say('Scanner did not load. Type the code instead.'); return; }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { say('This browser has no camera. Type the code instead.'); return; }
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
    } catch (err) {
      say('Camera is blocked. Type the code instead.');
      return;
    }
    box.hidden = false;
    video.srcObject = stream;
    try { await video.play(); } catch (err) { stop(); say('Camera is blocked. Type the code instead.'); return; }
    running = true;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const tick = () => {
      if (!running) return;
      if (video.readyState >= 2 && video.videoWidth) {
        const w = Math.min(video.videoWidth, 640);
        const h = Math.round(video.videoHeight * (w / video.videoWidth));
        canvas.width = w;
        canvas.height = h;
        ctx.drawImage(video, 0, 0, w, h);
        const hit = jsQR(ctx.getImageData(0, 0, w, h).data, w, h);
        if (hit && hit.data) {
          const match = String(hit.data).toUpperCase().match(/HDC-[A-Z0-9]+/);
          if (match) {
            stop();
            form.querySelector('input[name=code]').value = match[0];
            form.submit();
            return;
          }
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
  });
})();
