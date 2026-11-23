#!/usr/bin/env python3
"""
sintetizar_sonidos.py · Síntesis espectral y física de los 12 sonidos de VAHO
Licencia: CC0 1.0 Universal (Dominio Público)
Autor: Plataforma VAHO

Genera 12 archivos WAV (mono, 44.1 kHz, 16 bits PCM) en public/sonidos/:
  1.  chirrido_a.wav   - Bucle de fricción de dedo en vidrio húmedo
  2.  chirrido_b.wav   - Bucle de fricción alternativo (más agudo / mojado)
  3.  gota_1.wav       - Plink de gota de agua (tono medio-alto)
  4.  gota_2.wav       - Plink de gota de agua (tono más grave, gota gruesa)
  5.  gota_3.wav       - Plink de gota de agua (tono agudo, microgota)
  6.  lluvia.wav       - Bucle de lluvia exterior sobre el vidrio
  7.  calor.wav        - Bucle de zumbido grave de calor / palma
  8.  caja_musical.wav - Bucle de caja de música, melodía original en La menor
  9.  murmullo.wav     - Bucle de voces lejanas sin palabras (acordes en La menor)
  10. barrido.wav      - Sonido de barrido suave / quién limpia con la palma
  11. reloj.wav        - Bucle de tic-tac de reloj mecánico de bolsillo
  12. soplido.wav      - Bucle de aire exhalado sobre el vidrio frío
"""

import os
import wave
import numpy as np
from scipy import signal

SR = 44100  # Frecuencia de muestreo (Hz)
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.join(os.path.dirname(SCRIPT_DIR), "public", "sonidos")

os.makedirs(OUT_DIR, exist_ok=True)


def export_wav(filename, samples):
    """Normaliza y exporta samples (numpy float array entre -1 y 1) a WAV 16-bit PCM mono."""
    samples = np.asarray(samples, dtype=np.float64)
    # Eliminar posible DC offset
    samples = samples - np.mean(samples)
    peak = np.max(np.abs(samples))
    if peak > 1e-6:
        samples = samples / peak * 0.95
    else:
        samples = np.zeros_like(samples)

    int_samples = np.int16(np.clip(samples * 32767.0, -32768, 32767))
    filepath = os.path.join(OUT_DIR, filename)
    with wave.open(filepath, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(SR)
        wf.writeframes(int_samples.tobytes())
    print(f"  ✓ {filename} ({len(samples)/SR:.2f} s, {os.path.getsize(filepath)} bytes)", flush=True)


def make_seamless_loop(samples, crossfade_sec=0.4):
    """Fundido cruzado de igual potencia (equal-power) entre cola y cabeza para bucle sin costura."""
    cf_samples = int(crossfade_sec * SR)
    if len(samples) <= cf_samples * 2:
        return samples
    n = len(samples) - cf_samples
    out = np.copy(samples[:n])
    tail = samples[n : n + cf_samples]
    t = np.linspace(0, 1, cf_samples, endpoint=False)
    fade_in = np.sin(0.5 * np.pi * t)
    fade_out = np.cos(0.5 * np.pi * t)
    out[:cf_samples] = out[:cf_samples] * fade_in + tail * fade_out
    return out


# ==============================================================================
# 1 & 2. CHIRRIDOS DE VIDRIO (chirrido_a, chirrido_b)
# ==============================================================================
def gen_chirrido(base_freq=1800, dur=4.0, variant='a'):
    """Simula la fricción 'stick-slip' de un dedo deslizándose sobre vidrio húmedo."""
    n_samples = int((dur + 0.5) * SR)
    t = np.linspace(0, (dur + 0.5), n_samples, endpoint=False)

    slip_rate = 70.0 if variant == 'a' else 95.0
    mod = np.sin(2 * np.pi * 1.8 * t) * 12.0 + np.sin(2 * np.pi * 5.1 * t) * 6.0
    phase_slip = np.cumsum((slip_rate + mod) / SR)
    pulses = np.exp(-((phase_slip % 1.0) / 0.15) ** 2)

    if variant == 'a':
        freqs = [base_freq * 0.75, base_freq, base_freq * 1.5, base_freq * 2.2]
        weights = [0.35, 0.75, 0.40, 0.18]
    else:
        freqs = [base_freq * 0.85, base_freq * 1.2, base_freq * 1.8, base_freq * 2.7]
        weights = [0.25, 0.85, 0.45, 0.22]

    body = np.zeros(n_samples)
    for f, w in zip(freqs, weights):
        f_jit = f + 35.0 * np.sin(2 * np.pi * 14.0 * t) + 20.0 * np.sin(2 * np.pi * 37.0 * t)
        phase = 2 * np.pi * np.cumsum(f_jit / SR)
        body += w * np.sin(phase)

    # Grano micro-acústico de textura
    noise = np.random.normal(0, 0.18, n_samples)
    b_bp, a_bp = signal.butter(2, [800 / (SR / 2), 5500 / (SR / 2)], btype='band')
    grain = signal.lfilter(b_bp, a_bp, noise)

    sound = pulses * (body * 0.7 + grain * 0.3)
    b_lp, a_lp = signal.butter(2, 6000 / (SR / 2), btype='low')
    sound = signal.lfilter(b_lp, a_lp, sound)

    return make_seamless_loop(sound, crossfade_sec=0.5)[: int(dur * SR)]


# ==============================================================================
# 3, 4, 5. GOTAS DE AGUA (gota_1, gota_2, gota_3)
# ==============================================================================
def gen_gota(f_start=1550, f_end=1050, dur=0.35, decay=0.045, sub_f=300):
    """Sintetiza el plink acústico de una gota de agua al desprenderse y caer sobre vidrio."""
    n_samples = int(dur * SR)
    t = np.linspace(0, dur, n_samples, endpoint=False)

    freq = f_end + (f_start - f_end) * np.exp(-t / (decay * 1.1))
    phase = 2 * np.pi * np.cumsum(freq / SR)

    env = np.exp(-t / decay)
    attack_n = int(0.002 * SR)
    env[:attack_n] *= np.linspace(0, 1, attack_n)

    plink = (
        np.sin(phase)
        + 0.30 * np.sin(2 * phase)
        + 0.12 * np.sin(2 * np.pi * sub_f * t) * np.exp(-t / (decay * 2.2))
    )

    # Clic inicial sutil de impacto en vidrio
    click = np.random.normal(0, 0.4, n_samples) * np.exp(-t / 0.003)
    b_hp, a_hp = signal.butter(2, 1400 / (SR / 2), btype='high')
    click = signal.lfilter(b_hp, a_hp, click)

    sound = plink * env + click * 0.25
    return sound


# ==============================================================================
# 6. LLUVIA EXTERIOR (lluvia)
# ==============================================================================
def gen_lluvia(dur=8.0):
    """Bucle de lluvia constante y suave en el exterior del vidrio."""
    n_samples = int((dur + 0.8) * SR)
    t = np.linspace(0, dur + 0.8, n_samples, endpoint=False)

    # Ruido base filtrado
    white = np.random.normal(0, 1.0, n_samples)
    b_bp, a_bp = signal.butter(2, [250 / (SR / 2), 3800 / (SR / 2)], btype='band')
    base_rain = signal.lfilter(b_bp, a_bp, white) * 0.35

    # Gotas aleatorias individuales contra el cristal
    n_drops = int((dur + 0.8) * 80)
    drop_indices = np.random.randint(0, n_samples - 600, n_drops)
    drop_track = np.zeros(n_samples)

    d_t = np.linspace(0, 0.012, int(0.012 * SR), endpoint=False)
    for idx in drop_indices:
        f = np.random.uniform(2200, 4200)
        env = np.exp(-d_t / np.random.uniform(0.0015, 0.003))
        drop_track[idx : idx + len(d_t)] += np.sin(2 * np.pi * f * d_t) * env * np.random.uniform(0.1, 0.25)

    sound = base_rain + drop_track * 0.35
    b_lp, a_lp = signal.butter(2, 4500 / (SR / 2), btype='low')
    sound = signal.lfilter(b_lp, a_lp, sound)

    return make_seamless_loop(sound, crossfade_sec=0.8)[: int(dur * SR)]


# ==============================================================================
# 7. CALOR DE PALMA (calor)
# ==============================================================================
def gen_calor(dur=6.0):
    """Zumbido grave y cálido con armónicos sutiles (calor corporal sobre el vidrio)."""
    n_samples = int((dur + 0.6) * SR)
    t = np.linspace(0, dur + 0.6, n_samples, endpoint=False)

    f0 = 65.0
    lfo = 0.88 + 0.12 * np.sin(2 * np.pi * 0.22 * t)

    drone = (
        1.00 * np.sin(2 * np.pi * f0 * t)
        + 0.40 * np.sin(2 * np.pi * (f0 * 2) * t + 0.4)
        + 0.16 * np.sin(2 * np.pi * (f0 * 3) * t + 0.9)
    )

    # Saturación tipo tubo/cinta
    warm = np.tanh(drone * 1.25) * lfo

    # Aire tibio de fondo
    noise = np.random.normal(0, 0.05, n_samples)
    b_lp, a_lp = signal.butter(2, 200 / (SR / 2), btype='low')
    air = signal.lfilter(b_lp, a_lp, noise)

    sound = warm * 0.8 + air * 0.2
    return make_seamless_loop(sound, crossfade_sec=0.6)[: int(dur * SR)]


# ==============================================================================
# 8. CAJA MUSICAL EN LA MENOR (caja_musical)
# ==============================================================================
def gen_caja_musical(dur=8.0):
    """
    Melodía original en La menor (Am) tocada por láminas de acero de una caja musical.
    8 compases de 1 segundo cada uno.
    Am -> Fmaj -> Dm -> E7 -> Am -> Fmaj -> Bdim/Dm -> Am
    """
    n_samples = int((dur + 1.2) * SR)
    out = np.zeros(n_samples)

    notes = {
        'E4': 329.63, 'F4': 349.23, 'G#4': 415.30, 'A4': 440.00,
        'B4': 493.88, 'C5': 523.25, 'D5': 587.33, 'E5': 659.25,
        'F5': 698.46, 'A5': 880.00
    }

    score = [
        # Compás 1: Am
        (0.00, 'A4', 0.95), (0.25, 'E5', 0.70), (0.50, 'C5', 0.80), (0.75, 'E5', 0.65),
        # Compás 2: Fmaj
        (1.00, 'F4', 0.90), (1.25, 'C5', 0.70), (1.50, 'F5', 0.85), (1.75, 'C5', 0.60),
        # Compás 3: Dm
        (2.00, 'D5', 0.90), (2.25, 'F5', 0.75), (2.50, 'A5', 0.90), (2.75, 'F5', 0.65),
        # Compás 4: E7
        (3.00, 'E4', 0.95), (3.25, 'G#4', 0.75), (3.50, 'B4', 0.85), (3.75, 'D5', 0.70),
        # Compás 5: Am
        (4.00, 'C5', 0.90), (4.25, 'E5', 0.75), (4.50, 'B4', 0.80), (4.75, 'E5', 0.65),
        # Compás 6: Fmaj
        (5.00, 'A4', 0.85), (5.25, 'C5', 0.70), (5.50, 'F5', 0.80), (5.75, 'E5', 0.70),
        # Compás 7: Dm
        (6.00, 'D5', 0.85), (6.25, 'B4', 0.75), (6.50, 'F4', 0.70), (6.75, 'G#4', 0.80),
        # Compás 8: Resuelve en Am
        (7.00, 'A4', 0.95), (7.25, 'C5', 0.70), (7.50, 'E5', 0.80), (7.75, 'A5', 0.85),
    ]

    note_dur = 1.1
    n_note = int(note_dur * SR)
    t_note = np.linspace(0, note_dur, n_note, endpoint=False)

    for t_start, note_name, vel in score:
        f0 = notes[note_name]
        start_idx = int(t_start * SR)
        if start_idx >= n_samples:
            continue

        # Lámina metálica vibrando con modos característicos
        m1 = np.sin(2 * np.pi * f0 * t_note) * np.exp(-t_note / 0.75)
        m2 = 0.32 * np.sin(2 * np.pi * (f0 * 2.756) * t_note) * np.exp(-t_note / 0.18)
        m3 = 0.14 * np.sin(2 * np.pi * (f0 * 5.404) * t_note) * np.exp(-t_note / 0.05)

        click = np.random.normal(0, 0.25, n_note) * np.exp(-t_note / 0.003)
        b_hp, a_hp = signal.butter(2, 2200 / (SR / 2), btype='high')
        click = signal.lfilter(b_hp, a_hp, click)

        note_snd = (m1 + m2 + m3 + click * 0.35) * vel
        end_idx = min(n_samples, start_idx + n_note)
        out[start_idx:end_idx] += note_snd[: end_idx - start_idx]

    return make_seamless_loop(out, crossfade_sec=1.0)[: int(dur * SR)]


# ==============================================================================
# 9. MURMULLO DE VOCES SIN PALABRAS (murmullo)
# ==============================================================================
def gen_murmullo(dur=8.0):
    """Bucle de voces lejanas que evocan un recuerdo colectivo sin palabras claras."""
    n_samples = int((dur + 0.8) * SR)
    t = np.linspace(0, dur + 0.8, n_samples, endpoint=False)

    # Acorde coral continuo en La menor: A3, C4, E4, A4
    pitches = [110.0, 130.81, 164.81, 220.0, 261.63, 329.63]
    voices = np.zeros(n_samples)

    for i, p in enumerate(pitches):
        vib = np.sin(2 * np.pi * (4.5 + i * 0.2) * t) * 1.5
        phase = 2 * np.pi * np.cumsum((p + vib) / SR)
        saw = signal.sawtooth(phase, width=0.5)
        voices += saw * (0.2 / len(pitches))

    # Formantes vocales /o/ y /u/ (F1 ~ 450 Hz, F2 ~ 950 Hz, F3 ~ 2400 Hz)
    b1, a1 = signal.butter(2, [360 / (SR / 2), 560 / (SR / 2)], btype='band')
    f1 = signal.lfilter(b1, a1, voices) * 1.2

    b2, a2 = signal.butter(2, [820 / (SR / 2), 1150 / (SR / 2)], btype='band')
    f2 = signal.lfilter(b2, a2, voices) * 0.7

    b3, a3 = signal.butter(2, [2100 / (SR / 2), 2600 / (SR / 2)], btype='band')
    f3 = signal.lfilter(b3, a3, voices) * 0.25

    vocal = f1 + f2 + f3
    # Oleaje suave
    vocal = vocal * (0.75 + 0.25 * np.sin(2 * np.pi * 0.25 * t))

    b_lp, a_lp = signal.butter(2, 1700 / (SR / 2), btype='low')
    vocal = signal.lfilter(b_lp, a_lp, vocal)

    return make_seamless_loop(vocal, crossfade_sec=0.8)[: int(dur * SR)]


# ==============================================================================
# 10. BARRIDO SUAVE (barrido)
# ==============================================================================
def gen_barrido(dur=2.0):
    """Sonido único de barrido amplio con la palma sobre el vidrio empañado."""
    n_samples = int(dur * SR)
    t = np.linspace(0, dur, n_samples, endpoint=False)

    # Envolvente en arco
    env = np.sin(np.pi * t / dur) ** 2

    # Ruido filtrado
    noise = np.random.normal(0, 1.0, n_samples)
    b_bp, a_bp = signal.butter(2, [180 / (SR / 2), 1600 / (SR / 2)], btype='band')
    whoosh = signal.lfilter(b_bp, a_bp, noise)

    # Añadir sutil fricción grave
    sub = np.sin(2 * np.pi * 120.0 * t) * np.sin(np.pi * t / dur) * 0.15

    sound = (whoosh + sub) * env
    return sound


# ==============================================================================
# 11. TIC-TAC DE RELOJ (reloj)
# ==============================================================================
def gen_reloj(dur=4.0):
    """Bucle de tic-tac de reloj mecánico de bolsillo (1 tick/tock por segundo)."""
    n_samples = int((dur + 0.5) * SR)
    out = np.zeros(n_samples)

    for sec in range(int(dur + 1)):
        # TICK (t = sec + 0.0)
        idx_tick = int((sec + 0.0) * SR)
        if idx_tick < n_samples:
            dt = np.linspace(0, 0.07, int(0.07 * SR), endpoint=False)
            snd = (
                0.85 * np.sin(2 * np.pi * 3200 * dt) * np.exp(-dt / 0.007)
                + 0.50 * np.sin(2 * np.pi * 1200 * dt) * np.exp(-dt / 0.015)
                + 0.25 * np.random.normal(0, 0.3, len(dt)) * np.exp(-dt / 0.003)
            )
            l = min(len(dt), n_samples - idx_tick)
            out[idx_tick : idx_tick + l] += snd[:l]

        # TOCK (t = sec + 0.5)
        idx_tock = int((sec + 0.5) * SR)
        if idx_tock < n_samples:
            dt = np.linspace(0, 0.07, int(0.07 * SR), endpoint=False)
            snd = (
                0.60 * np.sin(2 * np.pi * 2300 * dt) * np.exp(-dt / 0.009)
                + 0.65 * np.sin(2 * np.pi * 820 * dt) * np.exp(-dt / 0.020)
                + 0.20 * np.random.normal(0, 0.3, len(dt)) * np.exp(-dt / 0.004)
            )
            l = min(len(dt), n_samples - idx_tock)
            out[idx_tock : idx_tock + l] += snd[:l]

    return make_seamless_loop(out, crossfade_sec=0.4)[: int(dur * SR)]


# ==============================================================================
# 12. SOPLIDO DE ALIENTO (soplido)
# ==============================================================================
def gen_soplido(dur=4.0):
    """Bucle de aliento cálido exhalado contra el vidrio frío."""
    n_samples = int((dur + 0.6) * SR)
    t = np.linspace(0, dur + 0.6, n_samples, endpoint=False)

    noise = np.random.normal(0, 1.0, n_samples)
    b_bp, a_bp = signal.butter(2, [550 / (SR / 2), 1350 / (SR / 2)], btype='band')
    breath = signal.lfilter(b_bp, a_bp, noise)

    flutter = 0.85 + 0.15 * np.sin(2 * np.pi * 3.5 * t)
    sound = breath * flutter

    return make_seamless_loop(sound, crossfade_sec=0.5)[: int(dur * SR)]


# ==============================================================================
# EJECUCIÓN PRINCIPAL
# ==============================================================================
def main():
    print("Iniciando síntesis de sonidos VAHO...", flush=True)

    export_wav("chirrido_a.wav", gen_chirrido(base_freq=1750, dur=4.0, variant='a'))
    export_wav("chirrido_b.wav", gen_chirrido(base_freq=2550, dur=4.0, variant='b'))
    export_wav("gota_1.wav", gen_gota(f_start=1550, f_end=1050, dur=0.32, decay=0.040, sub_f=320))
    export_wav("gota_2.wav", gen_gota(f_start=1100, f_end=720, dur=0.42, decay=0.060, sub_f=220))
    export_wav("gota_3.wav", gen_gota(f_start=2100, f_end=1450, dur=0.25, decay=0.028, sub_f=440))
    export_wav("lluvia.wav", gen_lluvia(dur=8.0))
    export_wav("calor.wav", gen_calor(dur=6.0))
    export_wav("caja_musical.wav", gen_caja_musical(dur=8.0))
    export_wav("murmullo.wav", gen_murmullo(dur=8.0))
    export_wav("barrido.wav", gen_barrido(dur=2.0))
    export_wav("reloj.wav", gen_reloj(dur=4.0))
    export_wav("soplido.wav", gen_soplido(dur=4.0))

    print("¡12/12 sonidos sintetizados con éxito en public/sonidos/!", flush=True)


if __name__ == "__main__":
    main()
