/** Original, synthesised game sounds. Nothing is fetched or decoded at runtime. */
export class GameAudio {
  constructor() {
    this.context = null;
    this.master = null;
    this.volume = .5;
    this.lastStep = 0;
    this.noise = null;
  }
  unlock() {
    try {
      if (!this.context) {
        const AudioContext = globalThis.AudioContext || globalThis.webkitAudioContext;
        if (!AudioContext) return;
        this.context = new AudioContext();
        this.master = this.context.createGain();
        this.master.gain.value = this.volume * .35;
        this.master.connect(this.context.destination);
        this.noise = this.context.createBuffer(1, this.context.sampleRate, this.context.sampleRate);
        const values = this.noise.getChannelData(0);
        for (let i = 0; i < values.length; i++) values[i] = Math.random() * 2 - 1;
      }
      if (this.context.state === 'suspended') this.context.resume().catch(() => {});
    } catch { /* Browsers may disable audio; the game remains playable. */ }
  }
  setVolume(volume) {
    this.volume = Math.max(0, Math.min(1, Number(volume) || 0));
    if (this.master) this.master.gain.setTargetAtTime(this.volume * .35, this.context.currentTime, .04);
  }
  tone(frequency, duration, volume = .3, type = 'square', delay = 0) {
    if (!this.context || !this.master || this.volume === 0) return;
    const time = this.context.currentTime + delay;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, time);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(30, frequency * .65), time + duration);
    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(volume, time + .005);
    gain.gain.exponentialRampToValueAtTime(.001, time + duration);
    oscillator.connect(gain); gain.connect(this.master);
    oscillator.start(time); oscillator.stop(time + duration + .02);
    oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
  }
  rustle(duration, frequency, volume = .35) {
    if (!this.context || !this.noise || this.volume === 0) return;
    const now = this.context.currentTime;
    const source = this.context.createBufferSource();
    source.buffer = this.noise;
    const filter = this.context.createBiquadFilter();
    filter.type = 'lowpass'; filter.frequency.value = frequency;
    const gain = this.context.createGain();
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(.001, now + duration);
    source.connect(filter); filter.connect(gain); gain.connect(this.master);
    source.start(now, Math.random() * .5, duration);
    source.onended = () => { source.disconnect(); filter.disconnect(); gain.disconnect(); };
  }
  play(type, blockId = 1) {
    if (!this.context || this.context.state !== 'running') return;
    const soft = [1, 2, 5, 7, 19, 22, 25, 30, 31].includes(blockId);
    const wood = [6, 8, 17, 24, 28, 33].includes(blockId);
    switch (type) {
      case 'step':
        if (this.context.currentTime - this.lastStep < .23) return;
        this.lastStep = this.context.currentTime;
        this.rustle(.075, soft ? 1700 : wood ? 800 : 3400, .12);
        this.tone(wood ? 140 : 90, .055, .1, 'triangle'); break;
      case 'break': this.rustle(.22, soft ? 2100 : wood ? 1300 : 5300, .55); this.tone(wood ? 160 : 90, .13, .2, 'triangle'); break;
      case 'place': this.rustle(.09, soft ? 900 : 2400, .2); this.tone(wood ? 180 : 130, .08, .2, 'triangle'); break;
      case 'hit': this.rustle(.17, 1800, .5); this.tone(120, .14, .4, 'sawtooth'); break;
      case 'craft': this.tone(520, .12, .12, 'sine'); this.tone(780, .18, .15, 'sine', .09); break;
      case 'click': this.tone(550, .045, .12, 'square'); break;
      case 'splash': this.rustle(.38, 3600, .4); break;
      case 'eat': this.rustle(.13, 2400, .25); this.tone(170, .05, .09, 'triangle'); break;
      case 'hurt': this.tone(120, .2, .35, 'sawtooth'); this.rustle(.15, 700, .2); break;
      case 'pickup': this.tone(700 + Math.random() * 100, .06, .09, 'sine'); break;
      case 'level': [520, 650, 780, 1040].forEach((f, i) => this.tone(f, .18, .12, 'sine', i * .08)); break;
    }
  }
  dispose() { this.context?.close().catch(() => {}); this.context = null; this.master = null; }
}
