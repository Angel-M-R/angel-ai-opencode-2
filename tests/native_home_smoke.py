#!/usr/bin/env python3
"""Exercise the compiled CLI in a PTY. Requires pyte; --png also requires Pillow.

Uses the current user's OpenCode config without submitting any prompt.
"""
import argparse
import codecs
import fcntl
import os
from pathlib import Path
import pty
import select
import struct
import subprocess
import termios
import time

import pyte

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("binary")
parser.add_argument("--columns", type=int, default=180)
parser.add_argument("--rows", type=int, default=55)
parser.add_argument("--output", type=Path, required=True)
parser.add_argument("--png", action="store_true")
args = parser.parse_args()
args.output.parent.mkdir(parents=True, exist_ok=True)
screen = pyte.Screen(args.columns, args.rows)
stream = pyte.Stream(screen)
master, slave = pty.openpty()
fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", args.rows, args.columns, 0, 0))
process = subprocess.Popen([args.binary], stdin=slave, stdout=slave, stderr=slave,
    env={**os.environ, "TERM": "xterm-256color", "OPENCODE_DISABLE_AUTOUPDATE": "1"}, start_new_session=True)
os.close(slave)
decoder = codecs.getincrementaldecoder("utf8")("replace")
raw = bytearray()
started = time.monotonic()
try:
    while time.monotonic() - started < 14:
        ready, _, _ = select.select([master], [], [], 0.1)
        if ready:
            try:
                chunk = os.read(master, 65536)
            except OSError:
                break
            if not chunk:
                break
            raw.extend(chunk)
            stream.feed(decoder.decode(chunk))
        if process.poll() is not None:
            break
    lines = screen.display
    args.output.with_suffix(".txt").write_text("\n".join(line.rstrip() for line in lines) + "\n")
    args.output.with_suffix(".ansi").write_bytes(raw)
    if args.png:
        from PIL import Image, ImageDraw, ImageFont
        font = ImageFont.truetype("/System/Library/Fonts/Menlo.ttc", 18)
        cell_width, cell_height = round(font.getlength("M")), 25
        image = Image.new("RGB", (args.columns * cell_width + 40, args.rows * cell_height + 40), "#080a0f")
        draw = ImageDraw.Draw(image)
        names = {"default": "#abb2bf", "black": "#080a0f", "white": "#abb2bf", "red": "#ff5f73", "green": "#72d66b", "yellow": "#ffaa3d", "blue": "#4aa8ff", "magenta": "#d66bff", "cyan": "#35d0c5", "brown": "#ffaa3d"}
        def color(value, background=False):
            if value == "default" and background:
                return "#080a0f"
            return names.get(value, "#" + value if len(value) == 6 else "#abb2bf")
        for y in range(args.rows):
            for x in range(args.columns):
                cell = screen.buffer[y][x]
                px, py = 20 + x * cell_width, 20 + y * cell_height
                fg, bg = color(cell.fg), color(cell.bg, True)
                if cell.reverse:
                    fg, bg = bg, fg
                draw.rectangle((px, py, px + cell_width, py + cell_height), fill=bg)
                if cell.data.strip():
                    draw.text((px, py), cell.data, font=font, fill=fg)
        image.save(args.output.with_suffix(".png"))
    panel = next((i for i, line in enumerate(lines) if line.strip() == "MCP" or "Angel AI · /angel-mcps" in line), -1)
    prompt = next((i for i, line in enumerate(lines) if "Angel-Orchestrator" in line), -1)
    official_logo = any("█▀▀█" in line for line in lines)
    print(f"panel row={panel + 1}; prompt row={prompt + 1}; official logo={official_logo}")
    assert panel >= 0 and prompt >= 0, "Expected Angel panel and configured prompt were not rendered"
    assert panel < prompt, "Angel panel is below the prompt"
    assert not official_logo, "Official logo is still visible"
    print("PASS: Angel panel is above the prompt and replaces the official logo")
finally:
    if process.poll() is None:
        os.write(master, b"\x03")
    # Close the terminal before waiting: a final redraw can otherwise block
    # macOS PTY teardown while the parent is no longer draining output.
    os.close(master)
    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=5)
