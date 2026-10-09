"""Encode canonical local tracks without exporter world-matrix cancellation under tiny parent scales."""
import hashlib
import json
import re
import struct
from pathlib import Path


def encode_tracks(file, samples, clips):
    payload = file.read_bytes()
    size, kind = struct.unpack_from('<II', payload, 12)
    assert payload[:4] == b'glTF' and kind == 0x4E4F534A
    gltf = json.loads(payload[20:20+size])
    binary_size, binary_kind = struct.unpack_from('<II', payload, 20+size)
    assert binary_kind == 0x004E4942 and len(gltf['buffers']) == 1
    binary = bytearray(payload[28+size:28+size+gltf['buffers'][0]['byteLength']])
    components = {'translation': (1, 3, 'VEC3'), 'rotation': (2, 4, 'VEC4'), 'scale': (3, 3, 'VEC3')}
    for animation in gltf.get('animations', []):
        if animation['name'] not in clips:
            continue
        sampled = samples['clips'][animation['name']]
        frames = [{row[0]: row for row in frame} for frame in sampled['frames']]
        for channel in animation['channels']:
            name = gltf['nodes'][channel['target']['node']]['name']
            if name.startswith('fx_'):
                continue
            sampler = animation['samplers'][channel['sampler']]
            accessor = gltf['accessors'][sampler['input']]
            view = gltf['bufferViews'][accessor['bufferView']]
            assert accessor['componentType'] == 5126 and accessor['type'] == 'SCALAR'
            offset = view.get('byteOffset', 0) + accessor.get('byteOffset', 0)
            times = struct.unpack_from('<' + 'f' * accessor['count'], binary, offset)
            field, count, shape = components[channel['target']['path']]
            values, previous = [], None
            for time in times:
                index = round(time * sampled['fps']) - 1
                assert 0 <= index < len(frames), f'{animation["name"]}: sample time outside the clip'
                value = list(frames[index][name][field])
                if field == 2 and previous and sum(a*b for a,b in zip(previous,value)) < 0:
                    value = [-v for v in value]
                previous = value
                values.extend(value)
            binary.extend(b'\0' * (-len(binary) % 4))
            view_index = len(gltf['bufferViews'])
            gltf['bufferViews'].append({'buffer': 0, 'byteOffset': len(binary), 'byteLength': len(values)*4})
            binary.extend(struct.pack('<' + 'f' * len(values), *values))
            sampler['output'] = len(gltf['accessors'])
            gltf['accessors'].append({'bufferView': view_index, 'componentType': 5126, 'count': len(times), 'type': shape})
            sampler['interpolation'] = 'LINEAR'
    gltf['buffers'][0]['byteLength'] = len(binary)
    header = json.dumps(gltf, separators=(',', ':')).encode('utf8')
    header += b' ' * (-len(header) % 4)
    binary.extend(b'\0' * (-len(binary) % 4))
    output = struct.pack('<4sII', b'glTF', 2, 28+len(header)+len(binary))
    output += struct.pack('<II', len(header), 0x4E4F534A) + header
    output += struct.pack('<II', len(binary), 0x004E4942) + binary
    temporary = file.with_suffix('.exact.glb')
    temporary.write_bytes(output)
    temporary.replace(file)


if __name__ == '__main__':
    root = Path(__file__).resolve().parents[2]
    for file in sorted((root / 'out/anatomical_motion/after').glob('*.json')):
        if not re.fullmatch(r'[stm]\d{2}', file.stem):
            continue
        directory = root / 'out/morph_reference' / file.stem
        if not (directory / 'validation.json').exists():
            directory = root / 'out/mech_reference' / file.stem
        report_file = directory / 'validation.json'
        report = json.loads(report_file.read_text(encoding='utf8'))
        if not report.get('motionSource'):
            continue
        glb = root / 'public/assets/models/reference' / (file.stem + '.glb')
        encode_tracks(glb, json.loads(file.read_text(encoding='utf8')), report['motionSource']['clips'])
        report['hashes']['glb'] = hashlib.sha256(glb.read_bytes()).hexdigest()
        report['motionSource']['encoder'] = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
        report['gates']['export'] = 'pending_independent_load'
        report_file.write_text(json.dumps(report, indent=2), encoding='utf8')
        print('EXACT_TRACKS ' + file.stem, flush=True)
