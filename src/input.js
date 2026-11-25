// Keyboard, gamepad and touch input folded into one driving state.
const GAME_KEYS = new Set([
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'KeyW', 'KeyA', 'KeyS', 'KeyD',
  'KeyQ', 'KeyE', 'KeyC', 'KeyR', 'KeyF', 'KeyL', 'KeyK', 'KeyT', 'KeyM', 'KeyN', 'KeyP', 'KeyH', 'KeyB', 'KeyG', 'KeyX', 'KeyV', 'Enter', 'Tab',
]);

export class Input {
  constructor() {
    this.keys = new Set();
    this.pressed = new Set(); // edge-triggered, cleared every frame
    this.state = { throttle: 0, brake: 0, steer: 0, handbrake: 0, analog: false, lookBack: false };
    this.touch = { left: false, right: false, gas: false, brake: false, hand: false };
    this.padButtons = [];
    this.usedPad = false;
    this.enabled = true;

    addEventListener('keydown', (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (GAME_KEYS.has(e.code)) e.preventDefault();
      if (!e.repeat) this.pressed.add(e.code);
      this.keys.add(e.code);
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
    document.addEventListener('visibilitychange', () => this.keys.clear());
  }

  hit(code) {
    return this.pressed.has(code);
  }

  // Bind an on-screen button (touch devices).
  bindTouch(el, name) {
    const set = (on) => (e) => {
      e.preventDefault();
      this.touch[name] = on;
      el.classList.toggle('on', on);
    };
    el.addEventListener('pointerdown', set(true));
    el.addEventListener('pointerup', set(false));
    el.addEventListener('pointercancel', set(false));
    el.addEventListener('pointerleave', set(false));
  }

  poll() {
    const k = this.keys;
    const t = this.touch;
    const s = this.state;
    let throttle = k.has('KeyW') || k.has('ArrowUp') || t.gas ? 1 : 0;
    let brake = k.has('KeyS') || k.has('ArrowDown') || t.brake ? 1 : 0;
    let steer = (k.has('KeyA') || k.has('ArrowLeft') || t.left ? 1 : 0) - (k.has('KeyD') || k.has('ArrowRight') || t.right ? 1 : 0);
    let handbrake = k.has('Space') || t.hand ? 1 : 0;
    let lookBack = k.has('KeyB');
    let analog = false;

    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const pad of pads) {
      if (!pad || !pad.connected || pad.buttons.length < 8) continue;
      const dz = (x) => (Math.abs(x) < 0.12 ? 0 : (x - Math.sign(x) * 0.12) / 0.88);
      const sx = dz(pad.axes[0] || 0);
      const rt = pad.buttons[7].value;
      const lt = pad.buttons[6].value;
      const b = pad.buttons;
      if (Math.abs(sx) > 0.01 || rt > 0.03 || lt > 0.03 || b[0].pressed) this.usedPad = true;
      if (this.usedPad) {
        if (Math.abs(sx) > Math.abs(steer)) {
          // gentle curve around centre for fine drift corrections
          steer = -Math.sign(sx) * Math.pow(Math.abs(sx), 1.5);
          analog = true;
        }
        if (rt > throttle) {
          throttle = rt;
          analog = true;
        }
        if (lt > brake) {
          brake = lt;
          analog = true;
        }
        if (b[0].pressed || b[2].pressed) handbrake = 1;
        if (b[1].pressed) lookBack = true;
      }
      // edge-triggered pad buttons mapped onto key codes
      const map = { 3: 'KeyC', 9: 'KeyP', 12: 'KeyT', 4: 'KeyQ', 5: 'KeyE', 8: 'KeyR', 13: 'KeyM', 14: 'KeyN', 15: 'KeyG' };
      for (const i in map) {
        const down = b[i] && b[i].pressed;
        if (down && !this.padButtons[i]) this.pressed.add(map[i]);
        this.padButtons[i] = down;
      }
      break;
    }
    if (!this.enabled) {
      throttle = brake = steer = handbrake = 0;
      lookBack = false;
    }
    s.throttle = throttle;
    s.brake = brake;
    s.steer = steer;
    s.handbrake = handbrake;
    s.analog = analog;
    s.lookBack = lookBack;
    return s;
  }

  endFrame() {
    this.pressed.clear();
  }
}
