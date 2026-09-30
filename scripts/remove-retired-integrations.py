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
RETIRED = {'cmux', 'engram-plugin', 'engram', 'sdd', 'openspec', 'notion', 'supabase', 'railway', 'codegraph'}
MANAGED_ASSETS = {'agents/angel-orchestrator.md', 'skills/product-grilling/SKILL.md'}
PACKAGES = {'opencode-sdd-engram-manage', 'opencode-openspec-task-tui', 'openspec-opencode-statusline'}


def retired_name(name):
    return name.lower() in RETIRED or name.lower().startswith(('openspec-', 'sdd-'))


def retired_package(name):
    return any(name == package or name.startswith(package + '@') for package in PACKAGES)


def retired_path(value):
    def retired_part(part):
        suffix = Path(part).suffix
        asset_name = part[:-len(suffix)] if suffix in {'.patch', '.ts', '.tsx', '.js', '.mjs', '.cjs'} else part
        return (retired_name(part) or retired_package(asset_name) or
                part in {'cmux-feed.js', 'cmux-session.js', 'engram.ts', 'engram.js', 'sdd-engram-manage.ts', 'sdd-badge-patch.test.ts'})
    return any(retired_part(part) for part in Path(value).parts)


def local_patch(root, value):
    if not isinstance(value, str):
        raise ValueError('patchedDependencies values must be file paths')
    path = Path(os.path.abspath(root / value))
    try:
        name = path.relative_to(root)
        path.resolve().relative_to(root.resolve())
    except ValueError:
        return None
    # Follow only local patch artifacts, never arbitrary config files or directories.
    if path.suffix != '.patch' or not path.is_file():
        return None
    return str(name)


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
    retired_patches, retained_patches = set(), set()
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
        for field in ('dependencies', 'devDependencies', 'optionalDependencies', 'patchedDependencies'):
            if field in data:
                if not isinstance(data[field], dict):
                    raise ValueError(f'{filename}.{field}: expected object')
                if field == 'patchedDependencies':
                    for package, value in data[field].items():
                        name = local_patch(root, value)
                        if name is not None:
                            (retired_patches if retired_package(package) else retained_patches).add(name)
                data[field] = {k: v for k, v in data[field].items() if not retired_package(k)}
        if encoded(data) != original:
            edits[filename] = encoded(data)

    retained_patch_targets = {(root / name).resolve() for name in retained_patches}
    for name in sorted(retired_patches):
        if (root / name).resolve() not in retained_patch_targets:
            edits[name] = None

    for folder in ('agents', 'skills', 'plugins', 'tui-plugins', 'patches'):
        directory = root / folder
        if not directory.exists():
            continue
        if directory.is_symlink():
            raise ValueError(f'{folder} is a symlink; choose its actual config directory')
        for path in directory.iterdir():
            if '.bak-' in path.name or path.resolve() in retained_patch_targets:
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

    for name in sorted(MANAGED_ASSETS):
        path = root / name
        if path.exists() or path.is_symlink():
            source = (REPO / 'assets' / name).read_bytes()
            if path.is_symlink() or path.read_bytes() != source:
                # A shared skill link is replaced locally, never edited at its target.
                parent = path.parent
                if parent.is_symlink():
                    edits[str(parent.relative_to(root))] = None
                edits[name] = source

    for name, content in edits.items():
        removed = (root / name).resolve()
        if content is None and any(target == removed or removed in target.parents for target in retained_patch_targets):
            raise ValueError(f'{name} contains a patch still used by a retained package')

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
            preserved_patch = (root / name).resolve() in retained_patch_targets
            if ((not preserved_patch and (retired_path(name) or retired_name(Path(name).stem))) or
                    any(content is None and (name == removed or name.startswith(removed + '/'))
                        for removed, content in edits.items())):
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
        if path.is_symlink() and edits[name] is not None and name not in MANAGED_ASSETS:
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
    removed_directories = [root / name for name, content in edits.items()
                           if content is None and (root / name).is_dir() and not (root / name).is_symlink()]
    # Edited paths plus their ancestors: the only dependency-cache entries the
    # snapshot needs to restore the edits.
    needed = {path for name in edits for path in [root / name, *(root / name).parents]}
    def ignore_dependencies(directory, names):
        current = Path(directory)
        # Removed directories must be restorable byte-for-byte, including their
        # nested dependencies. Unrelated install caches need not be copied.
        if any(current == removed or removed in current.parents for removed in removed_directories):
            return []
        if 'node_modules' in current.relative_to(root).parts:
            return [name for name in names if current / name not in needed]
        return ['node_modules'] if 'node_modules' in names and current / 'node_modules' not in needed else []
    shutil.copytree(root, snapshot, symlinks=True, ignore=ignore_dependencies)
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
        (backup / 'changed-paths.json').write_bytes(encoded(list(edits)))
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
