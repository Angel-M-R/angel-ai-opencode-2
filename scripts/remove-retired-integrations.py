#!/usr/bin/env python3
"""Preview or retire the v1 integrations from one OpenCode config directory."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import tempfile
from datetime import datetime, timezone
from urllib.parse import unquote, urlparse

REPO = Path(__file__).resolve().parents[1]
RETIRED = {'engram-plugin', 'engram', 'sdd', 'openspec', 'notion', 'supabase', 'railway', 'codegraph'}
PACKAGES = {'opencode-sdd-engram-manage', 'opencode-openspec-task-tui', 'openspec-opencode-statusline'}


def retired_name(name):
    return name.lower() in RETIRED or name.lower().startswith(('openspec-', 'sdd-'))


def retired_path(value):
    return any(retired_name(part) or part in PACKAGES or
               part.split('@')[0] in PACKAGES or
               part in {'engram.ts', 'engram.js', 'sdd-engram-manage.ts', 'sdd-badge-patch.test.ts'}
               for part in Path(value).parts)


def default_config_dir():
    return Path(os.environ.get("OPENCODE_CONFIG_DIR") or
                str(Path(os.environ.get("XDG_CONFIG_HOME") or Path.home() / ".config") / "opencode"))


def retired_plugin(entry):
    spec = entry[0] if isinstance(entry, list) and entry else entry
    if isinstance(spec, dict):
        spec = spec.get("package")
    if not isinstance(spec, str):
        raise ValueError('plugin entries must be strings, package descriptors or non-empty package tuples')
    if spec.startswith('file:'):
        spec = unquote(urlparse(spec).path)
    return retired_path(spec)


def read_json(path):
    value = json.loads(path.read_text())
    if not isinstance(value, dict):
        raise ValueError(f'{path.name} must contain an object')
    return value


def encoded(value):
    return (json.dumps(value, indent=2, ensure_ascii=False) + '\n').encode()


def plan(root):
    """Validate every input before returning path -> bytes/None (remove) edits."""
    edits = {}
    for filename in ('opencode.jsonc', 'cli.jsonc', 'tui.jsonc'):
        if (root / filename).exists():
            raise ValueError(f'{filename}: convert to JSON before cleanup')
    for filename in ('opencode.json', 'cli.json', 'tui.json', 'package.json'):
        path = root / filename
        if not path.exists():
            continue
        data = read_json(path)
        original = encoded(data)
        for field in ('mcp', 'agent', 'agents'):
            if field in data:
                if not isinstance(data[field], dict):
                    raise ValueError(f'{filename}.{field}: expected object; review native config manually')
                data[field] = {k: v for k, v in data[field].items() if not retired_name(k)}
        if isinstance(data.get('default_agent'), str) and retired_name(data['default_agent']):
            data['default_agent'] = 'angel-orchestrator' if (root / 'agents/angel-orchestrator.md').exists() else 'general'
        for field in ('plugin', 'plugins'):
            if field in data:
                if not isinstance(data[field], list):
                    raise ValueError(f'{filename}.{field}: expected array')
                data[field] = [v for v in data[field] if not retired_plugin(v)]
        for field in ('dependencies', 'devDependencies', 'patchedDependencies'):
            if field in data:
                if not isinstance(data[field], dict):
                    raise ValueError(f'{filename}.{field}: expected object')
                data[field] = {k: v for k, v in data[field].items() if not retired_path(k)}
        if encoded(data) != original:
            edits[filename] = encoded(data)

    for folder in ('agents', 'skills', 'plugins', 'tui-plugins', 'patches'):
        directory = root / folder
        if not directory.exists():
            continue
        if directory.is_symlink():
            raise ValueError(f'{folder} is a symlink; choose its actual config directory')
        for path in directory.iterdir():
            if '.bak-' in path.name:
                continue
            if retired_path(path.name) or retired_name(path.stem):
                edits[str(path.relative_to(root))] = None

    guidance = root / 'AGENTS.md'
    if guidance.exists():
        text = guidance.read_text()
        start, end = '<!-- codegraph-guidance -->', '<!-- /codegraph-guidance -->'
        if start in text or end in text:
            if text.count(start) != 1 or text.count(end) != 1 or text.index(start) > text.index(end):
                raise ValueError('AGENTS.md has ambiguous CodeGraph guidance markers')
            updated = text[:text.index(start)] + text[text.index(end) + len(end):]
            edits['AGENTS.md'] = updated.rstrip().encode() + b'\n'

    for name in ('agents/angel-orchestrator.md', 'skills/product-grilling/SKILL.md'):
        path = root / name
        if path.exists():
            source = (REPO / 'assets' / name).read_bytes()
            if path.read_bytes() != source:
                # A shared skill link is replaced locally, never edited at its target.
                parent = path.parent
                if parent.is_symlink():
                    edits[str(parent.relative_to(root))] = None
                edits[name] = source

    state_path = root / '.angel-ai-state.json'
    if state_path.exists():
        state = read_json(state_path)
        before = encoded(state)
        selection = state['selection']
        selection['extras'] = {k: v for k, v in selection['extras'].items() if not retired_path(k)}
        selection['agent_models'] = {k: v for k, v in selection.get('agent_models', {}).items() if not retired_name(k)}
        for category in selection['categories']:
            category['sources'] = [v for v in category['sources'] if not retired_path(v) and not retired_name(Path(v).stem)]
        records = []
        for record in state['files']:
            name = record['path']
            if retired_path(name) or retired_name(Path(name).stem):
                continue
            if name in edits and edits[name] is not None:
                path = root / name
                # Preserve pre-existing drift; only advance hashes we still own.
                if path.exists() and hashlib.sha256(path.read_bytes()).hexdigest() == record['digest']:
                    record['digest'] = hashlib.sha256(edits[name]).hexdigest()
            records.append(record)
        state['files'] = records
        if encoded(state) != before:
            edits['.angel-ai-state.json'] = encoded(state)

    for name in edits:
        path = root / name
        if path.is_symlink() and edits[name] is not None:
            raise ValueError(f'{name} is a symlink; refusing to overwrite its target')
        for parent in path.parents:
            if parent == root:
                break
            if parent.is_symlink() and edits.get(str(parent.relative_to(root)), b'') is not None:
                raise ValueError(f'{name} has a symlink ancestor')
    return edits


def remove(path):
    if path.is_symlink() or path.is_file():
        path.unlink()
    elif path.exists():
        shutil.rmtree(path)


def apply(root, edits, backup_root):
    if not edits:
        return None
    backup_root.mkdir(parents=True, exist_ok=True, mode=0o700)
    backup = Path(tempfile.mkdtemp(prefix='retired-' + datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S-'), dir=backup_root))
    snapshot = backup / 'config'
    shutil.copytree(root, snapshot, symlinks=True, ignore=shutil.ignore_patterns('node_modules'))
    # Record existence before any parent symlinks are removed.
    originals = {name: os.path.lexists(root / name) for name in edits}
    changed = []
    try:
        for name, content in edits.items():
            path = root / name
            changed.append(name)
            if content is None:
                remove(path)
                continue
            mode = (path.stat().st_mode & 0o777) if path.exists() else 0o600
            path.parent.mkdir(parents=True, exist_ok=True)
            fd, temporary = tempfile.mkstemp(prefix='.angel-retire-', dir=path.parent)
            try:
                with os.fdopen(fd, 'wb') as stream:
                    stream.write(content)
                os.chmod(temporary, mode)
                os.replace(temporary, path)
            finally:
                if os.path.exists(temporary):
                    os.unlink(temporary)
    except Exception:
        # Restore parents as units, preserving original symlinks.
        roots = [n for n in changed if not any(n.startswith(p + '/') for p in changed if p != n)]
        for name in reversed(roots):
            path, saved = root / name, snapshot / name
            remove(path)
            if originals[name]:
                if saved.is_symlink():
                    path.symlink_to(os.readlink(saved))
                elif saved.is_dir():
                    shutil.copytree(saved, path, symlinks=True)
                else:
                    shutil.copy2(saved, path)
        raise
    (backup / 'changed-paths.json').write_bytes(encoded(list(edits)))
    return backup


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--target', type=Path, default=default_config_dir())
    parser.add_argument('--backup-root', type=Path, default=Path.home() / '.local/state/angel-ai/backups')
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    root = args.target.expanduser().resolve()
    if not root.is_dir():
        parser.error('target must be an existing config directory')
    backup_root = args.backup_root.expanduser().resolve()
    if backup_root == root or root in backup_root.parents:
        parser.error('backup directory must be outside the target')
    try:
        edits = plan(root)
        for name, content in edits.items():
            print(('REMOVE ' if content is None else 'UPDATE ') + name)
        if args.apply:
            backup = apply(root, edits, backup_root)
            print(f'Backup: {backup}' if backup else 'Already clean.')
        else:
            print('Preview only. Use --apply to save a private backup and apply.')
    except (ValueError, KeyError, TypeError, OSError) as error:
        parser.exit(1, f'Cleanup failed: {error}\n')


if __name__ == '__main__':
    main()
