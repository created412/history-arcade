#!/bin/bash
# 1950년대 진공관 AM 라디오 방송 소리: 좁은 음역 + 콧소리 중음 + 진공관 찌그러짐 + 잡음(쉬익·지직)
# 사용: radio.sh 입력.mp3 출력.mp3 [말빠르기=0.94]
in="$1"; out="$2"; tempo="${3:-0.94}"
dur=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$in")
d=$(python3 -c "print(round($dur/$tempo+0.6,2))")
ffmpeg -v error -y -i "$in" \
  -f lavfi -t "$d" -i "anoisesrc=color=pink:amplitude=0.018:sample_rate=44100" \
  -f lavfi -t "$d" -i "anoisesrc=color=white:amplitude=0.6:sample_rate=44100" \
  -filter_complex "\
[0:a]aresample=44100,rubberband=tempo=${tempo}:pitch=1.02,highpass=f=320,highpass=f=320,lowpass=f=3300,lowpass=f=3300,\
equalizer=f=1400:t=q:w=1.1:g=6,equalizer=f=700:t=q:w=1:g=2,volume=2.2,asoftclip=type=tanh,adelay=300|300,apad=pad_dur=0.3[v];\
[1:a]highpass=f=500,lowpass=f=4000,volume=0.6[hiss];\
[2:a]agate=threshold=0.55:ratio=20:attack=0.01:release=5,highpass=f=1500,volume=0.3[crk];\
[v][hiss][crk]amix=inputs=3:duration=first:normalize=0,acompressor=threshold=-18dB:ratio=3:attack=5:release=100,loudnorm=I=-18:TP=-1.5,aresample=24000[o]" \
  -map "[o]" -ac 1 -c:a pcm_s16le "$out.wav" && ffmpeg -v error -y -i "$out.wav" -c:a libmp3lame -b:a 48k "$out" && rm "$out.wav"
