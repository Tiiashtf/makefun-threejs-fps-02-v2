// Keyboard + mouse + pointer lock. Accumulates mouse deltas between
// frames (the sim consumes them), tracks held keys, and reports the lock
// state so the game knows when the player can aim.
export function createInput(canvas) {
  const keys = new Set();
  let lookX = 0;
  let lookY = 0;
  let firing = false;
  let locked = false;
  const pressed = new Set(); // keys pressed since last consume (edge trigger)

  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    keys.add(e.code);
    pressed.add(e.code);
    if (['Space', 'Tab'].includes(e.code)) e.preventDefault();
  });
  window.addEventListener('keyup', (e) => keys.delete(e.code));
  window.addEventListener('blur', () => {
    keys.clear();
    firing = false;
  });
  document.addEventListener('pointerlockchange', () => {
    locked = document.pointerLockElement === canvas;
    if (!locked) firing = false;
  });
  document.addEventListener('mousemove', (e) => {
    if (!locked) return;
    lookX += e.movementX;
    lookY += e.movementY;
  });
  document.addEventListener('mousedown', (e) => {
    if (e.button === 0 && locked) firing = true;
  });
  document.addEventListener('mouseup', (e) => {
    if (e.button === 0) firing = false;
  });
  canvas.addEventListener('click', () => {
    if (!locked) canvas.requestPointerLock?.();
  });

  function consumeLook() {
    const out = { x: lookX, y: lookY };
    lookX = 0;
    lookY = 0;
    return out;
  }

  function wasPressed(code) {
    if (pressed.has(code)) {
      pressed.delete(code);
      return true;
    }
    return false;
  }

  function endFrame() {
    pressed.clear();
  }

  return {
    keys,
    consumeLook,
    wasPressed,
    endFrame,
    get firing() { return firing; },
    // Setter for probes: headless Chrome never grants pointer lock, so a
    // probe drives the trigger through this instead of a real mouse press.
    // In a desktop browser the mouse handlers are the only path, and they
    // already require the lock (see above).
    set firing(v) { firing = v; },
    get locked() { return locked; },
    requestLock() { canvas.requestPointerLock?.(); },
    exitLock() { document.exitPointerLock?.(); },
  };
}
