/**
 * generateTrapSounds.js
 * ─────────────────────────────────────────────────────────────
 * Generates WAV sound files for all 6 traps using mathematical
 * audio synthesis, then writes them to Android res/raw/.
 *
 * Run from the functions/ directory:
 *   node scripts/generateTrapSounds.js
 *
 * Naming convention: sfx_{soundKey}.wav
 * Android MediaPlayer picks them up via:
 *   resources.getIdentifier("sfx_${soundKey}", "raw", packageName)
 */

const fs   = require("fs");
const path = require("path");

const SAMPLE_RATE = 22050;   // Hz  (44100/2 – smaller files, fine for SFX)
const OUT_DIR     = "C:/Users/ferko/AndroidStudioProjects/Trap/app/src/main/res/raw";

// ── WAV writer ────────────────────────────────────────────────

function writeWav(samples) {
  const n   = samples.length;
  const buf = Buffer.alloc(44 + n * 2);

  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);         // PCM chunk size
  buf.writeUInt16LE(1,  20);         // PCM format
  buf.writeUInt16LE(1,  22);         // mono
  buf.writeUInt32LE(SAMPLE_RATE, 24);
  buf.writeUInt32LE(SAMPLE_RATE * 2, 28); // byte-rate
  buf.writeUInt16LE(2,  32);         // block align
  buf.writeUInt16LE(16, 34);         // bits per sample
  buf.write("data", 36);
  buf.writeUInt32LE(n * 2, 40);

  for (let i = 0; i < n; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    buf.writeInt16LE(Math.round(clamped * 32767), 44 + i * 2);
  }
  return buf;
}

// ── Helper: generate float sample array of given duration ────

function makeSamples(durationSec) {
  return new Float32Array(Math.floor(durationSec * SAMPLE_RATE));
}

// ── Envelope helpers ──────────────────────────────────────────

function env(t, attack, decay) {
  if (t < attack) return t / attack;
  return Math.exp(-decay * (t - attack));
}

// ── 1. Prank Zone – evil bouncing laugh chords ────────────────
//    Three "HA" bursts (0 s, 0.4 s, 0.8 s), ascending pitch each time

function genPrankZone() {
  const samples = makeSamples(1.2);
  const bursts  = [0, 0.38, 0.72];
  const baseFreqs = [280, 350, 440];

  for (let i = 0; i < samples.length; i++) {
    const t   = i / SAMPLE_RATE;
    let  sig  = 0;

    for (let b = 0; b < bursts.length; b++) {
      const tl = t - bursts[b];
      if (tl >= 0 && tl < 0.28) {
        const e    = env(tl, 0.025, 10);
        const freq = baseFreqs[b] + tl * 180 + 25 * Math.sin(2 * Math.PI * 9 * tl);
        sig += 0.32 * e * (
          Math.sin(2 * Math.PI * freq * tl) +
          0.4 * Math.sin(4 * Math.PI * freq * tl) +
          0.15 * Math.sin(6 * Math.PI * freq * tl)
        );
      }
    }
    samples[i] = sig;
  }
  return samples;
}

// ── 2. Shadow Snare – metal trap snap + spring reverb ────────
//    Sharp click attack, mid-frequency metal resonance

function genShadowSnare() {
  const samples = makeSamples(0.9);
  let   phase1  = 0;
  let   phase2  = 0;

  for (let i = 0; i < samples.length; i++) {
    const t = i / SAMPLE_RATE;

    // Initial click (random noise burst)
    const click = t < 0.012 ? (Math.random() * 2 - 1) * env(t, 0.002, 50) * 0.7 : 0;

    // Metal resonance – two inharmonic partials
    phase1 += (2 * Math.PI * 780) / SAMPLE_RATE;
    phase2 += (2 * Math.PI * 1320) / SAMPLE_RATE;
    const metal = env(t, 0.008, 12) * (
      0.45 * Math.sin(phase1) +
      0.25 * Math.sin(phase2) +
      0.15 * Math.sin(phase1 * 2.3)
    );

    // Low body thud
    const thud  = t < 0.18 ? 0.3 * env(t, 0.005, 22) * Math.sin(2 * Math.PI * 120 * t) : 0;

    samples[i] = click + metal + thud;
  }
  return samples;
}

// ── 3. Iron Cage – heavy clang + low rumble ───────────────────
//    Deep boom followed by long metallic ring

function genIronCage() {
  const samples  = makeSamples(1.6);
  let   phaseA   = 0;
  let   phaseB   = 0;
  let   phaseC   = 0;

  for (let i = 0; i < samples.length; i++) {
    const t = i / SAMPLE_RATE;

    // Deep BOOM
    const boom  = 0.45 * env(t, 0.01, 6) * Math.sin(2 * Math.PI * 68 * t);

    // Mid clang ring (multiple inharmonic partials)
    phaseA += (2 * Math.PI * 380) / SAMPLE_RATE;
    phaseB += (2 * Math.PI * 510) / SAMPLE_RATE;
    phaseC += (2 * Math.PI * 720) / SAMPLE_RATE;
    const clang = env(t, 0.005, 4) * (
      0.28 * Math.sin(phaseA) +
      0.22 * Math.sin(phaseB) +
      0.15 * Math.sin(phaseC)
    );

    // Initial crash noise
    const crash = t < 0.06
      ? (Math.random() * 2 - 1) * 0.35 * Math.exp(-40 * t)
      : 0;

    // Chain rattle (high-pitched noise tail)
    const rattle = t > 0.1 && t < 0.5
      ? (Math.random() * 2 - 1) * 0.08 * Math.exp(-4 * (t - 0.1))
      : 0;

    samples[i] = boom + clang + crash + rattle;
  }
  return samples;
}

// ── 4. Silly Spider – cartoon BOING + giggle squeak ──────────
//    Descending frequency glide (classic cartoon boing)

function genSillySpider() {
  const samples = makeSamples(0.7);

  for (let i = 0; i < samples.length; i++) {
    const t   = i / SAMPLE_RATE;
    const e   = Math.exp(-3.5 * t);

    // Descending glide: 900 Hz → 120 Hz
    const freq    = 900 * Math.pow(120 / 900, t / 0.7) + 20 * Math.sin(2 * Math.PI * 18 * t);
    const boing   = e * 0.65 * (
      Math.sin(2 * Math.PI * freq * t) +
      0.35 * Math.sin(4 * Math.PI * freq * t) * Math.exp(-6 * t)
    );

    // Short squeak at 0.35 s
    let squeak = 0;
    const tq = t - 0.35;
    if (tq >= 0 && tq < 0.12) {
      squeak = 0.25 * env(tq, 0.01, 20) * Math.sin(2 * Math.PI * 1800 * tq);
    }

    samples[i] = boing + squeak;
  }
  return samples;
}

// ── 5. Bubble Trap – three soap-bubble pops ──────────────────
//    Quick pop clicks with brief resonance each

function genBubbleTrap() {
  const samples  = makeSamples(0.85);
  const popTimes = [0, 0.28, 0.55];

  for (let i = 0; i < samples.length; i++) {
    const t   = i / SAMPLE_RATE;
    let   sig = 0;

    for (const pt of popTimes) {
      const tl = t - pt;
      if (tl >= 0 && tl < 0.22) {
        // Click at burst
        const click = tl < 0.008
          ? (Math.random() * 2 - 1) * Math.exp(-120 * tl) * 0.55
          : 0;
        // Descending pitch resonance
        const freq = Math.max(80, 650 - tl * 3800);
        const tone = env(tl, 0.004, 28) * 0.32 * Math.sin(2 * Math.PI * freq * tl);
        // High shimmer
        const shim = env(tl, 0.005, 50) * 0.15 * Math.sin(2 * Math.PI * 2200 * tl);
        sig += click + tone + shim;
      }
    }
    samples[i] = sig;
  }
  return samples;
}

// ── 6. Rainbow Freeze – ascending magical chime ───────────────
//    C-major pentatonic arpeggio with bell-like decay

function genRainbowFreeze() {
  // C4 E4 G4 B4 C5
  const noteFreqs  = [261.63, 329.63, 392.00, 493.88, 523.25];
  const noteStep   = 0.26;
  const totalDur   = noteFreqs.length * noteStep + 0.5;
  const samples    = makeSamples(totalDur);

  for (let i = 0; i < samples.length; i++) {
    const t   = i / SAMPLE_RATE;
    let   sig = 0;

    for (let n = 0; n < noteFreqs.length; n++) {
      const noteStart = n * noteStep;
      const tl        = t - noteStart;
      if (tl < 0) continue;

      const e  = env(tl, 0.018, 2.8);
      const f  = noteFreqs[n];
      sig += 0.22 * e * (
        Math.sin(2 * Math.PI * f * tl) +
        0.45 * Math.sin(4 * Math.PI * f * tl) * Math.exp(-5 * tl) +
        0.2  * Math.sin(6 * Math.PI * f * tl) * Math.exp(-9 * tl)
      );
    }

    // Soft shimmer noise (like ice particles)
    const shimmer = (Math.random() * 2 - 1) * 0.025 * Math.exp(-1.5 * t);
    samples[i] = sig + shimmer;
  }
  return samples;
}

// ── Main ──────────────────────────────────────────────────────

const SOUNDS = [
  { soundKey: "prank_zone",     gen: genPrankZone,     label: "Prank Zone"     },
  { soundKey: "shadow_snare",   gen: genShadowSnare,   label: "Shadow Snare"   },
  { soundKey: "iron_cage",      gen: genIronCage,       label: "Iron Cage"      },
  { soundKey: "silly_spider",   gen: genSillySpider,   label: "Silly Spider"   },
  { soundKey: "bubble_trap",    gen: genBubbleTrap,    label: "Bubble Trap"    },
  { soundKey: "rainbow_freeze", gen: genRainbowFreeze, label: "Rainbow Freeze" },
];

function main() {
  if (!fs.existsSync(OUT_DIR)) {
    console.error(`Output directory not found: ${OUT_DIR}`);
    process.exit(1);
  }

  for (const { soundKey, gen, label } of SOUNDS) {
    const filename = `sfx_${soundKey}.wav`;
    const outPath  = path.join(OUT_DIR, filename);
    const samples  = gen();
    const wav      = writeWav(samples);
    fs.writeFileSync(outPath, wav);

    const durationMs = Math.round((samples.length / SAMPLE_RATE) * 1000);
    const sizeKb     = Math.round(wav.length / 1024);
    console.log(`✓ ${label.padEnd(16)} → ${filename}  (${durationMs} ms, ${sizeKb} KB)`);
  }

  console.log(`\n✅  6 sound files written to:\n   ${OUT_DIR}`);
  console.log("\nAndroid mapping:");
  for (const { soundKey } of SOUNDS) {
    console.log(`   soundKey="${soundKey}"  →  res/raw/sfx_${soundKey}.wav`);
  }
}

main();
