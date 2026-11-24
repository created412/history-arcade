#!/bin/bash
# 참담하게: 느리게, 살짝 낮게(학생 목소리 결 유지), 밝은 고음 줄이고, 빈 방 잔향, 조금 작게
in="$1"; out="$2"
ffmpeg -v error -y -i "$in" -af "aresample=44100,\
rubberband=tempo=0.86:pitch=0.93:formant=preserved:pitchq=quality,\
equalizer=f=220:t=q:w=1:g=2,equalizer=f=3000:t=q:w=1.2:g=-4,highshelf=f=5000:g=-7,lowpass=f=7500,\
aecho=0.8:0.55:45|90:0.22|0.12,\
acompressor=threshold=-22dB:ratio=2:attack=10:release=200,loudnorm=I=-20:TP=-2,aresample=24000" -ac 1 -c:a pcm_s16le "$out.wav" \
&& ffmpeg -v error -y -i "$out.wav" -c:a libmp3lame -b:a 48k "$out" && rm "$out.wav"
