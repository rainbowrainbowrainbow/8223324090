/**
 * sound-engine.js — Rock-themed sound synthesizer v28.0.0
 * Web Audio API — no external files needed!
 * Themes: rock, classic, subtle
 */
(function (global) {
    'use strict';

    var DEFAULT_SETTINGS = {
        enabled: true,
        volume: 0.4,
        theme: 'rock'
    };
    var DEFAULT_TASK_SETTINGS = {
        enabled: true,
        volume: 0.4,
        theme: 'subtle'
    };
    var TASK_SOUND_THEMES = ['rock', 'classic', 'subtle'];

    var SoundEngine = {
        ctx: null,
        enabled: true,
        volume: 0.4,
        theme: 'rock',
        taskSettings: Object.assign({}, DEFAULT_TASK_SETTINGS),

        init: function () {
            this._loadSettings();
            this._loadTaskSettings();
            // AudioContext must be created after user gesture
            // We lazily init on first play
        },

        _getCtx: function () {
            if (!this.ctx) {
                try {
                    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
                } catch (e) {
                    console.warn('[SoundEngine] Web Audio API not supported');
                    return null;
                }
            }
            if (this.ctx.state === 'suspended') {
                this.ctx.resume();
            }
            return this.ctx;
        },

        unlock: function () {
            this._getCtx();
        },

        _loadSettings: function () {
            try {
                var saved = localStorage.getItem('chat_sound_settings');
                if (saved) {
                    var s = JSON.parse(saved);
                    this.enabled = s.enabled !== undefined ? s.enabled : DEFAULT_SETTINGS.enabled;
                    this.volume = s.volume !== undefined ? s.volume : DEFAULT_SETTINGS.volume;
                    this.theme = s.theme || DEFAULT_SETTINGS.theme;
                }
            } catch (e) { /* ignore */ }
        },

        saveSettings: function () {
            try {
                localStorage.setItem('chat_sound_settings', JSON.stringify({
                    enabled: this.enabled,
                    volume: this.volume,
                    theme: this.theme
                }));
            } catch (e) { /* ignore */ }
        },

        _normalizeSoundSettings: function (settings, defaults) {
            settings = settings || {};
            var volume = Number(settings.volume);
            if (!Number.isFinite(volume)) volume = defaults.volume;
            volume = Math.max(0, Math.min(1, volume));
            var theme = String(settings.theme || defaults.theme).trim();
            if (TASK_SOUND_THEMES.indexOf(theme) === -1) theme = defaults.theme;
            return {
                enabled: settings.enabled !== undefined ? Boolean(settings.enabled) : defaults.enabled,
                volume: volume,
                theme: theme
            };
        },

        _loadTaskSettings: function () {
            try {
                var saved = localStorage.getItem('task_sound_settings');
                this.taskSettings = this._normalizeSoundSettings(saved ? JSON.parse(saved) : {}, DEFAULT_TASK_SETTINGS);
            } catch (e) {
                this.taskSettings = Object.assign({}, DEFAULT_TASK_SETTINGS);
            }
        },

        saveTaskSettings: function (settings) {
            if (settings) this.configureTask(settings, { persist: false });
            try {
                localStorage.setItem('task_sound_settings', JSON.stringify(this.taskSettings));
            } catch (e) { /* ignore */ }
            return this.getTaskSettings();
        },

        configureTask: function (settings, options) {
            this.taskSettings = this._normalizeSoundSettings(
                Object.assign({}, this.taskSettings || DEFAULT_TASK_SETTINGS, settings || {}),
                DEFAULT_TASK_SETTINGS
            );
            if (!options || options.persist !== false) this.saveTaskSettings();
            return this.getTaskSettings();
        },

        getTaskSettings: function () {
            return Object.assign({}, this.taskSettings || DEFAULT_TASK_SETTINGS);
        },

        play: function (name, channelId) {
            if (String(name || '').indexOf('task-') === 0) {
                this.playTask(name);
                return;
            }
            if (!this.enabled) return;
            var ctx = this._getCtx();
            if (!ctx) return;
            try {
                if (this.theme === 'rock') {
                    this._playRock(name);
                } else if (this.theme === 'classic') {
                    this._playClassic(name);
                } else {
                    this._playSubtle(name);
                }
            } catch (e) {
                console.warn('[SoundEngine] play error:', e);
            }
        },

        // ─── ROCK THEME ───────────────────────────────────────────────────────────

        playTask: function (name) {
            var settings = this._normalizeSoundSettings(this.taskSettings || {}, DEFAULT_TASK_SETTINGS);
            if (!settings.enabled) return;
            var ctx = this._getCtx();
            if (!ctx) return;
            try {
                this._playTaskScoped(name, settings);
            } catch (e) {
                console.warn('[SoundEngine] task play error:', e);
            }
        },

        _playTaskScoped: function (name, settings) {
            if (settings.theme === 'rock') {
                this._taskTone(1320, 0.11, settings.volume, 'triangle');
                if (name === 'task-complete') {
                    setTimeout(this._taskTone.bind(this, 1760, 0.13, settings.volume, 'triangle'), 70);
                }
                return;
            }
            if (settings.theme === 'classic') {
                this._taskTone(name === 'task-complete' ? 1050 : 780, 0.16, settings.volume, 'sine');
                return;
            }
            this._taskTone(name === 'task-complete' ? 1050 : 850, 0.07, settings.volume, 'sine');
        },

        _taskTone: function (freq, duration, volume, type) {
            var ctx = this.ctx;
            if (!ctx) return;
            var osc = ctx.createOscillator();
            var gain = ctx.createGain();
            osc.type = type || 'sine';
            osc.frequency.value = freq;
            gain.gain.setValueAtTime(Math.max(0, Math.min(1, volume)) * 0.5, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start(ctx.currentTime);
            osc.stop(ctx.currentTime + duration + 0.01);
        },

        _playRock: function (name) {
            switch (name) {
                case 'message-new':    this._rockMessageNew(); break;
                case 'message-sent':   this._rockMessageSent(); break;
                case 'mention':        this._rockMention(); break;
                case 'connect':        this._rockConnect(); break;
                case 'disconnect':     this._rockDisconnect(); break;
                case 'error':          this._rockError(); break;
                case 'reaction':       this._rockReaction(); break;
                case 'task-new':       this._rockTaskNew(); break;
                case 'task-complete':  this._rockTaskComplete(); break;
                default:               this._rockMessageNew(); break;
            }
        },

        // message-new: 3 random guitar harmonic variants
        _rockMessageNew: function () {
            var variants = [
                this._rockHarmonic.bind(this, 880, 0.15),
                this._rockHarmonic.bind(this, 1100, 0.12),
                this._rockHarmonic.bind(this, 660, 0.18)
            ];
            variants[Math.floor(Math.random() * variants.length)]();
        },

        // message-sent: palm-muted strum — quiet, short
        _rockMessageSent: function () {
            this._rockHarmonic(440, 0.08, 15);
        },

        // mention: power chord — root + fifth + octave
        _rockMention: function () {
            var root = 220;
            var self = this;
            [root, root * 1.5, root * 2].forEach(function (freq, i) {
                setTimeout(function () {
                    self._rockHarmonic(freq, 0.35, 40);
                }, i * 25);
            });
        },

        // connect: 3-note intro lick (rising)
        _rockConnect: function () {
            var notes = [330, 440, 550];
            var self = this;
            notes.forEach(function (freq, i) {
                setTimeout(function () {
                    self._rockHarmonic(freq, 0.12, 20);
                }, i * 80);
            });
        },

        // disconnect: fade out chord
        _rockDisconnect: function () {
            this._rockHarmonic(330, 0.4, 10);
        },

        // error: dissonant stab — minor second
        _rockError: function () {
            var self = this;
            this._rockHarmonic(440, 0.15, 50);
            setTimeout(function () {
                self._rockHarmonic(466, 0.12, 50); // Bb — dissonant with A
            }, 30);
        },

        // reaction: bell harmonic — high ringing tone
        _rockReaction: function () {
            this._rockBell(1760, 0.2);
        },

        // task-new: snare hit simulation
        _rockTaskNew: function () {
            this._rockSnare();
        },

        // task-complete: short positive two-tone confirmation
        _rockTaskComplete: function () {
            var self = this;
            this._rockBell(1320, 0.12);
            setTimeout(function () {
                self._rockBell(1760, 0.16);
            }, 75);
        },

        // Base: guitar harmonic (pinch) with optional distortion
        _rockHarmonic: function (freq, duration, distAmt) {
            var ctx = this.ctx;
            if (!ctx) return;
            distAmt = distAmt || 30;
            duration = duration || 0.2;

            var osc = ctx.createOscillator();
            var gain = ctx.createGain();
            var distortion = ctx.createWaveShaper();

            distortion.curve = this._makeDistortionCurve(distAmt);

            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(freq, ctx.currentTime);
            // Slight pitch bend — more expressive
            osc.frequency.exponentialRampToValueAtTime(freq * 0.95, ctx.currentTime + duration);

            gain.gain.setValueAtTime(this.volume * 0.6, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);

            osc.connect(distortion);
            distortion.connect(gain);
            gain.connect(ctx.destination);

            osc.start(ctx.currentTime);
            osc.stop(ctx.currentTime + duration + 0.01);
        },

        // Bell harmonic — sine + overtone
        _rockBell: function (freq, duration) {
            var ctx = this.ctx;
            if (!ctx) return;

            var osc1 = ctx.createOscillator();
            var osc2 = ctx.createOscillator();
            var gain = ctx.createGain();

            osc1.type = 'sine';
            osc1.frequency.value = freq;
            osc2.type = 'sine';
            osc2.frequency.value = freq * 2.756; // inharmonic overtone → bell character

            gain.gain.setValueAtTime(this.volume * 0.4, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);

            osc1.connect(gain);
            osc2.connect(gain);
            gain.connect(ctx.destination);

            osc1.start(ctx.currentTime);
            osc2.start(ctx.currentTime);
            osc1.stop(ctx.currentTime + duration + 0.01);
            osc2.stop(ctx.currentTime + duration + 0.01);
        },

        // Snare: noise burst + tone
        _rockSnare: function () {
            var ctx = this.ctx;
            if (!ctx) return;

            // Noise buffer
            var bufSize = ctx.sampleRate * 0.15;
            var buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
            var data = buf.getChannelData(0);
            for (var i = 0; i < bufSize; i++) {
                data[i] = Math.random() * 2 - 1;
            }

            var noise = ctx.createBufferSource();
            noise.buffer = buf;

            var noiseFilter = ctx.createBiquadFilter();
            noiseFilter.type = 'bandpass';
            noiseFilter.frequency.value = 2000;
            noiseFilter.Q.value = 0.6;

            var noiseGain = ctx.createGain();
            noiseGain.gain.setValueAtTime(this.volume * 0.6, ctx.currentTime);
            noiseGain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);

            noise.connect(noiseFilter);
            noiseFilter.connect(noiseGain);
            noiseGain.connect(ctx.destination);
            noise.start(ctx.currentTime);
            noise.stop(ctx.currentTime + 0.16);

            // Tone layer
            var osc = ctx.createOscillator();
            var oscGain = ctx.createGain();
            osc.frequency.setValueAtTime(200, ctx.currentTime);
            osc.frequency.exponentialRampToValueAtTime(80, ctx.currentTime + 0.08);
            oscGain.gain.setValueAtTime(this.volume * 0.4, ctx.currentTime);
            oscGain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.1);
            osc.connect(oscGain);
            oscGain.connect(ctx.destination);
            osc.start(ctx.currentTime);
            osc.stop(ctx.currentTime + 0.11);
        },

        // Distortion curve
        _makeDistortionCurve: function (amount) {
            var samples = 256;
            var curve = new Float32Array(samples);
            for (var i = 0; i < samples; i++) {
                var x = (i * 2) / samples - 1;
                curve[i] = ((Math.PI + amount) * x) / (Math.PI + amount * Math.abs(x));
            }
            return curve;
        },

        // ─── CLASSIC THEME ───────────────────────────────────────────────────────

        _playClassic: function (name) {
            var freqMap = {
                'message-new':  [800, 0.18],
                'message-sent': [600, 0.12],
                'mention':      [900, 0.28],
                'connect':      [700, 0.22],
                'disconnect':   [500, 0.30],
                'error':        [400, 0.20],
                'reaction':     [1200, 0.15],
                'task-new':     [750, 0.20],
                'task-complete': [1050, 0.18]
            };
            var p = freqMap[name] || freqMap['message-new'];
            this._classicBell(p[0], p[1]);
        },

        _classicBell: function (freq, duration) {
            var ctx = this.ctx;
            if (!ctx) return;
            var osc = ctx.createOscillator();
            var gain = ctx.createGain();
            osc.type = 'sine';
            osc.frequency.value = freq;
            gain.gain.setValueAtTime(this.volume * 0.5, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start(ctx.currentTime);
            osc.stop(ctx.currentTime + duration + 0.01);
        },

        // ─── SUBTLE THEME ─────────────────────────────────────────────────────────

        _playSubtle: function (name) {
            var freqMap = {
                'message-new':  [1000, 0.06],
                'message-sent': [800,  0.04],
                'mention':      [1100, 0.10],
                'connect':      [900,  0.08],
                'disconnect':   [700,  0.08],
                'error':        [600,  0.06],
                'reaction':     [1200, 0.05],
                'task-new':     [850,  0.07],
                'task-complete': [1050, 0.07]
            };
            var p = freqMap[name] || freqMap['message-new'];
            this._classicBell(p[0], p[1]);
        }
    };

    // Expose globally
    global.SoundEngine = SoundEngine;

    // Auto-init
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () { SoundEngine.init(); });
    } else {
        SoundEngine.init();
    }

})(window);
