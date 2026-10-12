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
    node_indices = {node['name']:i for i,node in enumerate(gltf['nodes']) if 'name' in node}
    for name,position,rotation,scale in samples['clips']['idle']['frames'][0]:
        if name not in node_indices:
            continue
        node=gltf['nodes'][node_indices[name]]
        node.pop('matrix',None)
        node.update(translation=position,rotation=rotation,scale=scale)
    def accessor(values, count, shape, limits=None):
        binary.extend(b'\0' * (-len(binary) % 4))
        view_index = len(gltf['bufferViews'])
        gltf['bufferViews'].append({'buffer':0,'byteOffset':len(binary),'byteLength':len(values)*4})
        binary.extend(struct.pack('<'+'f'*len(values),*values))
        index = len(gltf['accessors'])
        row = {'bufferView':view_index,'componentType':5126,'count':count,'type':shape}
        if limits:
            row.update(min=[limits[0]],max=[limits[1]])
        gltf['accessors'].append(row)
        return index
    for animation in gltf.get('animations', []):
        if animation['name'] not in clips:
            continue
        sampled = samples['clips'][animation['name']]
        frames = [{row[0]: row for row in frame} for frame in sampled['frames']]
        times = [(i+1)/sampled['fps'] for i in range(len(frames))]
        time_index = accessor(times,len(times),'SCALAR',(times[0],times[-1]))
        animation['channels'],animation['samplers'] = [],[]
        for name in frames[0]:
            if name.startswith('fx_'):
                continue
            assert name in node_indices, 'Missing exported joint: '+name
            for path,(field,count,shape) in components.items():
                values,previous = [],None
                for frame in frames:
                    value = list(frame[name][field])
                    if field==2 and previous and sum(a*b for a,b in zip(previous,value))<0:
                        value=[-v for v in value]
                    previous=value
                    values.extend(value)
                animation['channels'].append({'sampler':len(animation['samplers']),'target':{'node':node_indices[name],'path':path}})
                animation['samplers'].append({'input':time_index,'output':accessor(values,len(times),shape),'interpolation':'LINEAR'})
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
