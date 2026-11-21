/* Lädt das hinterlegte Firmenlogo in die öffentliche Kundenansicht. */
(() => {
  const mark = document.querySelector('.brand-mark');
  if (!mark) return;
  const image = new Image();
  image.alt = '';
  image.className = 'brand-logo';
  image.onload = () => {
    mark.innerHTML = '';
    mark.appendChild(image);
    mark.classList.add('has-logo');
  };
  // Zeitstempel verhindert, dass nach einem Logo-Wechsel noch die alte Datei erscheint.
  image.src = `/branding/logo?v=${Date.now()}`;
})();
