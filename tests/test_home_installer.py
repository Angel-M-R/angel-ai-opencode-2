import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / "scripts/install-opencode-home.py"

class HomeInstallerTest(unittest.TestCase):
    def test_install_and_restore_regular_file_and_relative_symlink(self):
        for symlink in (False, True):
            with self.subTest(symlink=symlink), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                binary = root / "patched"
                binary.write_text('#!/bin/sh\nprintf "opencode v2.0.18\\n"\n')
                binary.chmod(0o755)
                official = root / "official"
                official.write_text("original executable")
                command = root / "opencode"
                if symlink:
                    command.symlink_to("official")
                else:
                    command.write_bytes(official.read_bytes())
                installed = root / "data/home1"
                result = subprocess.run([sys.executable, str(SCRIPT), str(binary), "--command", str(command), "--install-dir", str(installed)], capture_output=True, text=True)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(command.resolve(), (installed / "opencode-angel").resolve())
                self.assertEqual(subprocess.check_output([str(command)], text=True).strip(), "opencode v2.0.18")
                backup = next((root / "data").glob("backup-*"))
                self.assertEqual((backup / "opencode-official").read_bytes(), official.read_bytes())
                self.assertEqual(json.loads((backup / "manifest.json").read_text())["command"], str(command))
                restored = subprocess.run([sys.executable, str(SCRIPT), "--restore", str(backup)], capture_output=True, text=True)
                self.assertEqual(restored.returncode, 0, restored.stderr)
                self.assertEqual(command.is_symlink(), symlink)
                self.assertEqual(command.read_bytes(), official.read_bytes())
                if symlink:
                    self.assertEqual(str(command.readlink()), "official")

    def test_wrong_version_keeps_original_command(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            binary = root / "wrong"
            binary.write_text('#!/bin/sh\nprintf "2.0.19\\n"\n')
            binary.chmod(0o755)
            command = root / "opencode"
            command.write_text("original")
            result = subprocess.run([sys.executable, str(SCRIPT), str(binary), "--command", str(command), "--install-dir", str(root / "install")], capture_output=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(command.read_text(), "original")
            self.assertFalse((root / "install").exists())


class HomeInstallerConflictTests(unittest.TestCase):
    def test_reinstall_in_other_directory_preserves_original_backup_chain(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            binary = root / 'patched'
            binary.write_text('#!/bin/sh\nprintf "2.0.18\\n"\n')
            binary.chmod(0o755)
            command = root / 'opencode'
            command.write_text('official')
            args = [sys.executable, str(SCRIPT), str(binary), '--command', str(command), '--install-dir']
            first = subprocess.run(args + [str(root / 'one')], capture_output=True)
            self.assertEqual(first.returncode, 0, first.stderr)
            target = command.readlink()
            second = subprocess.run(args + [str(root / 'two')], capture_output=True)
            self.assertNotEqual(second.returncode, 0)
            self.assertEqual(command.readlink(), target)
            self.assertFalse((root / 'two').exists())
            self.assertEqual(len(list(root.glob('backup-*'))), 1)

    def test_install_directory_must_not_overlap_active_command(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            binary = root / 'patched'
            binary.write_text('#!/bin/sh\nprintf "2.0.18\\n"\n')
            binary.chmod(0o755)
            command = root / 'opencode'
            command.write_text('official')
            result = subprocess.run([sys.executable, str(SCRIPT), str(binary), '--command', str(command), '--install-dir', str(root)], capture_output=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(command.read_text(), 'official')
            self.assertFalse(list(root.glob('backup-*')))

if __name__ == "__main__":
    unittest.main()
