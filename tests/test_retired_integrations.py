import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('retire', Path(__file__).resolve().parents[1] / 'scripts/remove-retired-integrations.py')
retire = importlib.util.module_from_spec(spec)
spec.loader.exec_module(retire)


class CleanupTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        self.root = self.base / 'config'
        self.root.mkdir()
        self.backups = self.base / 'backups'

    def write(self, name, data):
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(data) if isinstance(data, (dict, list)) else data)
        return path

    def test_preview_apply_backup_and_idempotence(self):
        config = self.write('opencode.json', {
            'mcp': {'engram': {}, 'codegraph': {}, 'notion': {}, 'supabase': {}, 'railway': {}, 'context7': {'enabled': True}, 'plane': {'enabled': False}},
            'agent': {'openspec-planner': {'model': 'old'}, 'general': {'model': 'kept'}},
            'default_agent': 'openspec-planner', 'plugin': ['foreign@1', './plugins/engram.ts'], 'permission': {'bash': 'ask'},
        })
        original = config.read_bytes()
        self.write('cli.json', {'plugins': ['foreign', str(self.root / 'tui-plugins/sdd-engram'), ['opencode-openspec-task-tui@1', {'x': 1}], './tui-plugins/open-in-app']})
        self.write('package.json', {'dependencies': {'opencode-sdd-engram-manage': '1', 'kept': '2'}, 'patchedDependencies': {'opencode-sdd-engram-manage@1': 'patches/old.patch'}})
        self.write('plugins/engram.ts', 'old')
        self.write('agents/openspec-planner.md', 'old prompt')
        self.write('tui-plugins/sdd-engram/tui.tsx', 'old ui')
        memory = self.write('memories/engram.db', 'preserve user data')
        self.write('AGENTS.md', 'custom before\n<!-- codegraph-guidance -->retired<!-- /codegraph-guidance -->\ncustom after\n')
        edits = retire.plan(self.root)
        self.assertEqual(config.read_bytes(), original)
        backup = retire.apply(self.root, edits, self.backups)
        self.assertEqual((backup / 'config/opencode.json').read_bytes(), original)
        self.assertEqual(backup.stat().st_mode & 0o777, 0o700)
        current = json.loads(config.read_text())
        self.assertEqual(set(current['mcp']), {'context7', 'plane'})
        self.assertEqual(current['agent'], {'general': {'model': 'kept'}})
        self.assertEqual(current['plugin'], ['foreign@1'])
        self.assertEqual(current['default_agent'], 'general')
        self.assertEqual(current['permission'], {'bash': 'ask'})
        self.assertFalse((self.root / 'plugins/engram.ts').exists())
        self.assertFalse((self.root / 'agents/openspec-planner.md').exists())
        self.assertEqual(memory.read_text(), 'preserve user data')
        self.assertEqual(retire.plan(self.root), {})

    def test_native_descriptors_preserve_options(self):
        kept = {'package': './tui-plugins/open-in-app', 'options': {'favorite': 'code'}}
        self.write('cli.json', {'plugins': [{'package': 'opencode-sdd-engram-manage', 'options': {}}, kept]})
        retire.apply(self.root, retire.plan(self.root), self.backups)
        self.assertEqual(json.loads((self.root / 'cli.json').read_text())['plugins'], [kept])

    def test_config_directory_environment_precedence(self):
        with patch.dict(retire.os.environ, {'OPENCODE_CONFIG_DIR': '/custom', 'XDG_CONFIG_HOME': '/xdg'}, clear=True):
            self.assertEqual(retire.default_config_dir(), Path('/custom'))
        with patch.dict(retire.os.environ, {'XDG_CONFIG_HOME': '/xdg'}, clear=True):
            self.assertEqual(retire.default_config_dir(), Path('/xdg/opencode'))

    def test_shared_skill_is_replaced_locally_without_editing_target(self):
        shared = self.base / 'shared'
        shared.mkdir()
        (shared / 'SKILL.md').write_text('shared prompt')
        (self.root / 'skills').mkdir()
        (self.root / 'skills/product-grilling').symlink_to(shared)
        self.write('agents/angel-orchestrator.md', 'old prompt')
        retire.apply(self.root, retire.plan(self.root), self.backups)
        self.assertEqual((shared / 'SKILL.md').read_text(), 'shared prompt')
        self.assertFalse((self.root / 'skills/product-grilling').is_symlink())
        for name in ('agents/angel-orchestrator.md', 'skills/product-grilling/SKILL.md'):
            self.assertEqual((self.root / name).read_bytes(), (retire.REPO / 'assets' / name).read_bytes())

    def test_invalid_input_never_mutates(self):
        original = self.write('opencode.json', {'mcp': {'engram': {}}}).read_bytes()
        self.write('cli.json', '{broken')
        with self.assertRaises(ValueError):
            retire.plan(self.root)
        self.assertEqual((self.root / 'opencode.json').read_bytes(), original)
        self.assertFalse(self.backups.exists())

    def test_state_removes_retired_selection_without_accepting_unrelated_drift(self):
        self.write('opencode.json', {'mcp': {'engram': {}, 'context7': {}}})
        self.write('.angel-ai-state.json', {'selection': {'extras': {'openspec': True, 'cmux': True}, 'categories': [{'name': 'agents', 'sources': ['agents/openspec-planner.md', 'agents/review-correctness.md']}], 'agent_models': {'openspec-planner': {}, 'general': {}}}, 'files': [{'path': 'agents/openspec-planner.md', 'digest': 'old'}, {'path': 'opencode.json', 'digest': 'preexisting-drift'}]})
        retire.apply(self.root, retire.plan(self.root), self.backups)
        state = json.loads((self.root / '.angel-ai-state.json').read_text())
        self.assertEqual(state['selection']['extras'], {'cmux': True})
        self.assertEqual(state['selection']['categories'][0]['sources'], ['agents/review-correctness.md'])
        self.assertEqual(state['files'], [{'path': 'opencode.json', 'digest': 'preexisting-drift'}])

    def test_write_failure_restores_earlier_edits(self):
        self.write('plugins/engram.ts', 'hook')
        self.write('opencode.json', 'original bytes')
        with patch.object(retire.os, 'replace', side_effect=OSError('injected failure')):
            with self.assertRaises(OSError):
                retire.apply(self.root, {'plugins/engram.ts': None, 'opencode.json': b'new'}, self.backups)
        self.assertEqual((self.root / 'plugins/engram.ts').read_text(), 'hook')
        self.assertEqual((self.root / 'opencode.json').read_text(), 'original bytes')


if __name__ == '__main__':
    unittest.main()
