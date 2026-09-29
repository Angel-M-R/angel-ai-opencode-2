#!/usr/bin/env python3
"""Install the tested Angel build behind the current opencode command, with rollback."""
import argparse
import datetime
import json
import os
from pathlib import Path
import shlex
import shutil
import subprocess

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("binary", nargs="?", type=Path)
parser.add_argument("--command", type=Path, default=Path(shutil.which("opencode") or Path.home() / ".local/bin/opencode"))
parser.add_argument("--install-dir", type=Path, default=Path(os.environ.get("XDG_DATA_HOME", Path.home() / ".local/share")) / "angel-ai/opencode/2.0.18-home1")
parser.add_argument("--restore", type=Path, help="Restore the original command from an installation backup")
args = parser.parse_args()
if args.restore:
    manifest = json.loads((args.restore / "manifest.json").read_text())
    command = Path(manifest["command"])
    launcher = Path(manifest["launcher"])
    if not command.is_symlink() or command.resolve() != launcher.resolve():
        parser.error("opencode has changed since installation; review the backup before restoring")
    temporary = command.with_name(command.name + ".restore-tmp")
    if os.path.lexists(temporary):
        parser.error(f"Temporary path already exists: {temporary}")
    shutil.copy2(args.restore / "original-command", temporary, follow_symlinks=False)
    os.replace(temporary, command)
    print(f"Restored {command}")
    raise SystemExit(0)
if not args.binary or not args.binary.is_file():
    parser.error("provide the compiled binary")
binary = args.binary.resolve()
version = subprocess.check_output([str(binary), "--version"], text=True).strip()
if version not in {"2.0.18", "opencode v2.0.18"}:
    parser.error(f"expected OpenCode 2.0.18, received {version!r}")
version = "2.0.18"
command = args.command.absolute()
install_dir = args.install_dir.absolute()
if not command.exists():
    parser.error("an existing opencode command is required so it can be backed up")
launcher = install_dir / "opencode-angel"
if command.is_symlink() and (command.resolve() == launcher.resolve() or command.resolve().name == "opencode-angel"):
    parser.error("this build is already installed; restore the recorded backup before reinstalling")
if command.resolve() in {(install_dir / "opencode").resolve(), launcher.resolve()}:
    parser.error("install directory overlaps the active command; choose a separate directory")
stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S-%f")
backup = install_dir.parent / ("backup-" + stamp)
backup.mkdir(parents=True, mode=0o700)
shutil.copy2(command, backup / "original-command", follow_symlinks=False)
# Preserve the actual official executable as well as its original symlink.
shutil.copy2(command, backup / "opencode-official")
install_dir.mkdir(parents=True, exist_ok=True)
installed = install_dir / "opencode"
shutil.copy2(binary, installed)
installed.chmod(0o755)
launcher.write_text("#!/bin/sh\n# Angel AI home layout, OpenCode 2.0.18. Rebuild before upgrading.\nexport OPENCODE_DISABLE_AUTOUPDATE=1\nexec " + shlex.quote(str(installed)) + ' "$@"\n')
launcher.chmod(0o755)
(backup / "manifest.json").write_text(json.dumps({
    "command": str(command), "launcher": str(launcher), "binary": str(installed),
    "upstream": "cd9a14a6b688d4021bee381dfd39d2cef9c0f862", "version": version,
}, indent=2) + "\n")
temporary = command.with_name(command.name + ".angel-tmp")
if os.path.lexists(temporary):
    parser.error(f"Temporary path already exists: {temporary}")
temporary.symlink_to(launcher)
os.replace(temporary, command)
print(f"Installed {command} -> {launcher}")
print(f"Backup: {backup}")
print(f"Restore: python3 {shlex.quote(str(Path(__file__).resolve()))} --restore {shlex.quote(str(backup))}")
