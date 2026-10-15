#!/usr/bin/env python3
"""
Generate the recorded narration (MP3) from the narration text in content.js.

Why: browser text-to-speech depends on the learner's device. Many phones
have no Arabic voice at all, so the course was silent there. Shipping the
narration as audio files makes it sound the same on every device, offline
and inside an LMS.

What it does, for every scene's `narration` segment:
  1. applies the pronunciation fixes in PRONUNCIATION (abbreviations,
     numbers) — the subtitle text itself is never changed;
  2. synthesizes it with a Piper voice (Arabic diacritization included);
  3. trims silence, normalizes loudness, encodes mono MP3 into
     audio/<sceneId>/seg-<n>.mp3;
  4. rewrites the generated blocks in js/content.js (manifest),
     imsmanifest.xml and scripts/build-scorm.sh (file lists).

Requirements (dev machine only, nothing ships to learners):
  python3 -m pip install piper-tts
  ffmpeg on PATH, node on PATH
  a Piper voice (.onnx + .onnx.json), e.g. the female Arabic voice used for
  the current files:
    curl -LO https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/vits-piper-ar_JO-SA_dii-high.tar.bz2
    tar xjf vits-piper-ar_JO-SA_dii-high.tar.bz2
  LICENSE: that voice is CC BY-NC-SA 4.0 (non-commercial). Replace it with
  a licensed voice or studio recordings before any commercial use; the
  course only needs the MP3 files, so swapping voices needs no code change.

Usage:
  python3 scripts/generate-narration.py --voice path/to/voice.onnx
  python3 scripts/generate-narration.py --voice ... --only opening
"""
import argparse
import json
import os
import re
import subprocess
import sys
import tempfile
import wave

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))

# Spoken form for text the voice would otherwise misread. Applied in order.
PRONUNCIATION = [
    (r'د\.\s*سارة', 'الدكتورة سارة'),   # "د." would be read "الدكتور"
    (r'٣٠٪', 'ثلاثون بالمئة'),
    (r'\.\.\.', '،'),                   # a pause, not three dots
    (r'\s*—\s*', '، '),
]

BEGIN = 'BEGIN generated narration'
END = 'END generated narration'


def load_segments():
    js = (
        "global.window = global; require(%s);"
        "const out = {};"
        "for (const s of window.STORY_CONTENT.screens)"
        "  out[s.id] = (s.narration || []).map(g => g.text);"
        "process.stdout.write(JSON.stringify(out));"
    ) % json.dumps(os.path.join(ROOT, 'js', 'content.js'))
    return json.loads(subprocess.check_output(['node', '-e', js]))


def spoken(text):
    for pattern, repl in PRONUNCIATION:
        text = re.sub(pattern, repl, text)
    return text.strip()


def synthesize(voice, text, mp3_path):
    with tempfile.TemporaryDirectory() as tmp:
        wav_path = os.path.join(tmp, 'seg.wav')
        with wave.open(wav_path, 'wb') as w:
            voice.synthesize_wav(text, w)
        os.makedirs(os.path.dirname(mp3_path), exist_ok=True)
        # Trim leading/trailing silence (the Narrator adds its own pauses),
        # normalize loudness so every segment plays at the same level, and
        # keep a short tail so the last syllable is not clipped.
        filters = ','.join([
            'silenceremove=start_periods=1:start_threshold=-55dB',
            'areverse',
            'silenceremove=start_periods=1:start_threshold=-55dB',
            'areverse',
            'apad=pad_dur=0.25',
            'loudnorm=I=-18:TP=-1.5:LRA=11',
        ])
        subprocess.check_call([
            'ffmpeg', '-y', '-loglevel', 'error', '-i', wav_path,
            '-af', filters, '-ar', '22050', '-ac', '1',
            '-codec:a', 'libmp3lame', '-b:a', '48k', mp3_path,
        ])


def replace_block(path, new_body, indent):
    src = open(path, encoding='utf-8').read()
    pattern = re.compile(r'([ \t]*)(<!-- |// |# )' + BEGIN + r'.*?' + END + r'( -->)?', re.S)
    m = pattern.search(src)
    if not m:
        sys.exit(f'{path}: generated block markers not found')
    if m.group(2) == '<!-- ':
        block = f'{indent}<!-- {BEGIN} -->\n{new_body}{indent}<!-- {END} -->'
    else:
        c = m.group(2)
        block = f'{indent}{c}{BEGIN}\n{new_body}{indent}{c}{END}'
    open(path, 'w', encoding='utf-8').write(src[:m.start()] + block + src[m.end():])


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--voice', required=True, help='Piper voice .onnx (its .onnx.json must sit next to it)')
    ap.add_argument('--only', help='regenerate one scene id only')
    ap.add_argument('--length-scale', type=float, default=1.1, help='>1 speaks slower (default 1.1)')
    args = ap.parse_args()

    from piper import PiperVoice, SynthesisConfig  # noqa: E402 (dev-only dependency)
    voice = PiperVoice.load(args.voice)
    # A slightly lower noise_scale gives steadier articulation for this voice.
    cfg = SynthesisConfig(length_scale=args.length_scale, noise_scale=0.5, noise_w_scale=0.6)
    synth = voice.synthesize_wav
    voice.synthesize_wav = lambda text, w: synth(text, w, syn_config=cfg)

    segments = load_segments()
    files = []
    for scene_id, texts in segments.items():
        for i, text in enumerate(texts):
            rel = f'audio/{scene_id}/seg-{i}.mp3'
            files.append(rel)
            if args.only and scene_id != args.only:
                continue
            print(f'{rel}: {spoken(text)}')
            synthesize(voice, spoken(text), os.path.join(ROOT, rel))
    files += ['audio/silence.mp3', 'audio/LICENSE.txt']

    # content.js manifest: sceneId -> segment -> file
    lines = ''.join(
        f"      '{sid}': {{ " + ', '.join(f"'{i}': 'audio/{sid}/seg-{i}.mp3'" for i in range(len(t))) + ' },\n'
        for sid, t in segments.items() if t
    )
    replace_block(os.path.join(ROOT, 'js', 'content.js'), lines, '      ')
    replace_block(os.path.join(ROOT, 'imsmanifest.xml'),
                  ''.join(f'      <file href="{f}"/>\n' for f in files), '      ')
    replace_block(os.path.join(ROOT, 'scripts', 'build-scorm.sh'),
                  ''.join(f'  "{f}"\n' for f in files), '  ')
    print(f'Wrote {len(files) - 2} narration files and updated the manifests.')


if __name__ == '__main__':
    main()
