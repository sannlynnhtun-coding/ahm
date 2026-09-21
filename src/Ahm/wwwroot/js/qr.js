window.ahmQr = {
  async render(id, value) {
    const target = document.getElementById(id);
    if (!target || target.dataset.value === value) return;
    const { default: qrcode } = await import('./qr-code.mjs');
    const qr = qrcode(0, 'M');
    qr.addData(value);
    qr.make();
    target.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
    target.dataset.value = value;
    const image = target.querySelector('svg');
    image?.setAttribute('role', 'img');
    image?.setAttribute('aria-label', 'Member QR code for this customer');
  },
  async scan() {
    if (!('BarcodeDetector' in window)) throw new Error('BarcodeDetector unavailable');
    const detector = new BarcodeDetector({ formats: ['qr_code'] });
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    const overlay = document.createElement('div');
    overlay.className = 'fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-black/90 p-5';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'scan-title');
    const heading = document.createElement('h2');
    heading.id = 'scan-title';
    heading.className = 'text-lg font-semibold text-white';
    heading.textContent = 'Scan member QR code';
    const instruction = document.createElement('p');
    instruction.className = 'max-w-md text-center text-sm text-white';
    instruction.textContent = 'Point the camera at the customer’s QR code.';
    const video = document.createElement('video');
    video.className = 'w-full max-w-md rounded-xl';
    video.playsInline = true;
    video.setAttribute('aria-hidden', 'true');
    video.srcObject = stream;
    const cancel = document.createElement('button');
    cancel.className = 'rounded-xl bg-white px-5 py-3 text-sm font-medium text-black';
    cancel.textContent = 'Cancel scanning';
    overlay.append(heading, instruction, video, cancel);
    const app = document.getElementById('app');
    const wasInert = app?.inert ?? false;
    const previousFocus = document.activeElement;
    document.body.append(overlay);
    if (app) app.inert = true;
    cancel.focus();
    const onKeyDown = event => {
      if (event.key === 'Escape') cancel.click();
      if (event.key === 'Tab') { event.preventDefault(); cancel.focus(); }
    };
    document.addEventListener('keydown', onKeyDown);
    try {
      await video.play();
      return await new Promise((resolve, reject) => {
        let stopped = false;
        const timer = setTimeout(() => { stopped = true; reject(new Error('QR scan timed out.')); }, 30000);
        cancel.onclick = () => { stopped = true; reject(new Error('Scanning cancelled.')); };
        const tick = async () => {
          if (stopped) { clearTimeout(timer); return; }
          try {
            const codes = await detector.detect(video);
            if (codes.length) { stopped = true; clearTimeout(timer); resolve(codes[0].rawValue); return; }
          } catch { /* Keep scanning until cancelled or timed out. */ }
          setTimeout(tick, 150);
        };
        tick();
      });
    } finally {
      stream.getTracks().forEach(track => track.stop());
      overlay.remove();
      document.removeEventListener('keydown', onKeyDown);
      if (app) app.inert = wasInert;
      previousFocus?.focus();
    }
  }
};
