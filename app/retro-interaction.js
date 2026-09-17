"use strict";
// Native cursor assets keep the OS hotspot and latency; their paper colour tracks
// the LCD palette because page blend layers cannot colour an OS cursor.
(() => {
  const root = document.documentElement;
  const arrow = 'M2 1H4V3H6V5H8V7H10V9H12V11H14V13H9V15H11V19H8V17H6V13H4V15H2Z';
  const vertical = 'M10 1H12V3H14V5H16V7H13V15H16V17H14V19H12V21H10V19H8V17H6V15H9V7H6V5H8V3H10Z';
  const shapes = {
    default: [arrow, 2, 1],
    pointer: ['M8 2H12V10H14V8H17V10H20V12H23V20H21V24H10V22H8V20H6V18H4V14H8Z', 10, 2],
    grab: ['M5 13H7V5H11V11H12V3H16V11H17V5H21V13H22V9H26V21H24V25H21V28H11V25H8V22H5V19H3V13ZM10 15H12V20H10ZM15 14H17V20H15ZM20 15H22V20H20Z', 15, 16],
    grabbing: ['M7 11H11V8H15V7H19V8H23V10H26V21H24V25H21V28H11V25H8V22H5V18H3V14H7ZM10 12H12V17H10ZM15 11H17V16H15ZM20 12H22V17H20Z', 15, 16],
    text: ['M5 3H11V5H13V3H19V5H15V23H19V25H13V23H11V25H5V23H9V5H5Z', 12, 14],
    'ns-resize': [vertical, 11, 11],
    'ew-resize': [vertical, 11, 11, 'rotate(90 11 11)'],
    crosshair: ['M12 2H14V12H24V14H14V24H12V14H2V12H12Z', 13, 13],
    help: [arrow + 'M18 2H26V4H28V10H26V12H24V14H20V10H24V6H20V8H16V4H18ZM20 17H24V21H20Z', 2, 1],
    'not-allowed': ['M8 3H20V5H24V9H26V21H22V25H10V23H6V19H4V9H6V5H8ZM10 8V18H12V20H20V18H18V16H16V14H14V12H12V8ZM16 8V10H18V12H20V14H22V10H20V8Z', 15, 14],
  };
  function palette() {
    const paper = root.dataset.displayOverlay === 'true'
      ? getComputedStyle(root).getPropertyValue('--lcd-overlay-colour').trim() : '#fff';
    for (const [name, [path, x, y, transform = '']] of Object.entries(shapes)) {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" shape-rendering="crispEdges"><path d="${path}" transform="${transform}" fill="black" stroke="${paper}" stroke-width="2" stroke-linejoin="miter" paint-order="stroke" fill-rule="evenodd"/></svg>`;
      root.style.setProperty(`--cursor-${name}`, `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${x} ${y}, ${name}`);
    }
  }
  palette();
  let lastColour = getComputedStyle(root).getPropertyValue('--lcd-overlay-colour');
  new MutationObserver(records => {
    const colour = getComputedStyle(root).getPropertyValue('--lcd-overlay-colour');
    if (records.some(r => r.attributeName === 'data-display-overlay') || colour !== lastColour) {
      lastColour = colour;
      palette();
    }
  }).observe(root, { attributes: true, attributeFilter: ['data-display-overlay', 'style'] });

  const tip = document.createElement('div');
  tip.id = 'retro-tooltip';
  tip.className = 'retro-tooltip';
  tip.setAttribute('role', 'tooltip');
  tip.setAttribute('popover', 'manual');
  tip.hidden = true;
  document.body.append(tip);
  let owner = null, timer = null, leaveTimer = null;
  // Convert existing and dynamically rendered title help without changing the
  // editor's title-writing API. Mutation delivery runs before the next paint.
  function convert(el) {
    if (!(el instanceof Element)) return;
    if (el.hasAttribute('title')) {
      const help = el.getAttribute('title');
      el.dataset.tooltip = help;
      if (help) el.setAttribute('aria-description', help);
      else el.removeAttribute('aria-description');
      el.removeAttribute('title');
    }
    el.querySelectorAll('[title]').forEach(convert);
  }
  convert(document.body);
  function hide() {
    clearTimeout(timer);
    clearTimeout(leaveTimer);
    if (tip.matches(':popover-open')) tip.hidePopover();
    tip.hidden = true;
    if (owner) {
      const ids = (owner.getAttribute('aria-describedby') || '').split(/\s+/).filter(id => id && id !== tip.id);
      if (ids.length) owner.setAttribute('aria-describedby', ids.join(' '));
      else owner.removeAttribute('aria-describedby');
    }
    owner = null;
  }
  function show(el, keyboard) {
    if (el === owner) return;
    hide();
    if (!el?.dataset.tooltip) return;
    owner = el;
    timer = setTimeout(() => {
      if (!el.isConnected || !el.getClientRects().length) return hide();
      tip.textContent = el.dataset.tooltip;
      tip.hidden = false;
      if (tip.showPopover) tip.showPopover();
      const rect = el.getBoundingClientRect(), box = tip.getBoundingClientRect();
      tip.style.left = `${Math.max(8, Math.min(rect.left, innerWidth - box.width - 8))}px`;
      tip.style.top = `${Math.max(8, Math.min(rect.bottom + 8 + box.height <= innerHeight - 8 ? rect.bottom + 8 : rect.top - box.height - 8, innerHeight - box.height - 8))}px`;
      el.setAttribute('aria-describedby', [el.getAttribute('aria-describedby'), tip.id].filter(Boolean).join(' '));
    }, keyboard ? 0 : 500);
  }
  new MutationObserver(records => {
    for (const record of records) {
      if (record.type === 'attributes') convert(record.target);
      else record.addedNodes.forEach(convert);
    }
    if (owner && (!owner.isConnected || tip.textContent !== owner.dataset.tooltip && !tip.hidden)) hide();
  }).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['title'] });
  document.addEventListener('pointerover', e => {
    if (tip.contains(e.target)) { clearTimeout(leaveTimer); return; }
    if (e.pointerType !== 'touch' && !e.buttons) show(e.target.closest('[data-tooltip]'), false);
  });
  document.addEventListener('pointerout', e => {
    if (owner && !owner.contains(e.relatedTarget) && !tip.contains(e.relatedTarget)) {
      leaveTimer = setTimeout(hide, 150);
    }
  });
  tip.addEventListener('pointerleave', hide);
  document.addEventListener('focusin', e => {
    if (e.target.matches(':focus-visible')) show(e.target.closest('[data-tooltip]'), true);
  });
  document.addEventListener('focusout', hide);
  document.addEventListener('pointerdown', hide, true);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') hide(); }, true);
  document.addEventListener('scroll', hide, true);
  document.addEventListener('close', hide, true);
  window.addEventListener('resize', hide);
  window.addEventListener('blur', hide);
})();

// Move native modal dialogs without changing their focus or backdrop behavior.
(() => {
  const dialog = document.querySelector('#dialog');
  const titlebar = dialog.querySelector('.dialog-titlebar');
  let drag = null;
  function position(left, top) {
    const rect = dialog.getBoundingClientRect();
    dialog.style.left = `${Math.max(0, Math.min(left, innerWidth - rect.width))}px`;
    dialog.style.top = `${Math.max(0, Math.min(top, innerHeight - rect.height))}px`;
  }
  function stop() {
    if (!drag) return;
    const id = drag.id;
    drag = null;
    titlebar.classList.remove('dragging');
    if (titlebar.hasPointerCapture(id)) titlebar.releasePointerCapture(id);
  }
  titlebar.addEventListener('pointerdown', e => {
    if (e.button !== 0 || !e.isPrimary || e.target.closest('button')) return;
    const rect = dialog.getBoundingClientRect();
    drag = { id: e.pointerId, x: e.clientX - rect.left, y: e.clientY - rect.top };
    dialog.classList.add('dialog-positioned');
    position(rect.left, rect.top);
    titlebar.classList.add('dragging');
    titlebar.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  titlebar.addEventListener('pointermove', e => {
    if (drag?.id === e.pointerId) position(e.clientX - drag.x, e.clientY - drag.y);
  });
  for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    titlebar.addEventListener(event, e => { if (drag?.id === e.pointerId) stop(); });
  }
  dialog.addEventListener('close', () => {
    stop();
    dialog.classList.remove('dialog-positioned');
    dialog.style.removeProperty('left');
    dialog.style.removeProperty('top');
  });
  function constrain() {
    if (!dialog.open || !dialog.classList.contains('dialog-positioned')) return;
    const rect = dialog.getBoundingClientRect();
    position(rect.left, rect.top);
  }
  window.addEventListener('resize', constrain);
  window.addEventListener('blur', stop);
  new ResizeObserver(constrain).observe(dialog);
})();
