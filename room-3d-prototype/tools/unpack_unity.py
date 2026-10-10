"""Inspect and safely recover Unity package assets; never execute package code."""
import json
import gzip
import pathlib
import sys
import tarfile

source = pathlib.Path(sys.argv[1])
destination = pathlib.Path(sys.argv[2]).resolve()
destination.mkdir(parents=True, exist_ok=True)
with gzip.open(source, 'rb') as compressed, tarfile.open(fileobj=compressed, mode='r|') as archive:
    # Read compressed bytes once; random seeks through gzip repeatedly decompress it.
    members = {m.name.removeprefix('./'): archive.extractfile(m).read()
               for m in archive if m.isfile()}
    manifest = []
    for key, member in members.items():
        if not key.endswith('/pathname'):
            continue
        guid = key.split('/')[0]
        name = member.decode('utf-8-sig').splitlines()[0].rstrip('\0').strip()
        path = pathlib.PurePosixPath(name.replace('\\', '/'))
        if path.is_absolute() or '..' in path.parts or ':' in name:
            raise ValueError(f'Unsafe asset path: {name}')
        target = destination.joinpath(*path.parts).resolve()
        target.relative_to(destination)
        asset = members.get(f'{guid}/asset')
        if asset is not None:
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(asset)
            meta = members.get(f'{guid}/asset.meta')
            if meta:
                pathlib.Path(str(target) + '.meta').write_bytes(meta)
            manifest.append({'guid': guid, 'path': name, 'bytes': len(asset)})
    (destination / 'asset-manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')
    counts = {}
    for item in manifest:
        suffix = pathlib.Path(item['path']).suffix.lower()
        counts[suffix] = counts.get(suffix, 0) + 1
    print(json.dumps({'assets': len(manifest), 'types': counts}, ensure_ascii=False))
