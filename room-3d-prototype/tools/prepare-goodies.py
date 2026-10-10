"""Read Unity YAML as data, resolve material GUIDs; never execute package scripts."""
import json, pathlib, re, yaml
from PIL import Image
root = pathlib.Path('.asset-work/goodies-cozy')
out = pathlib.Path('.asset-work/converted/goodies-cozy')
out.mkdir(parents=True, exist_ok=True)
manifest = json.loads((root / 'asset-manifest.json').read_text('utf-8'))
by_guid = {a['guid']: a for a in manifest}
def docs(text):
    text = re.sub(r'^%.*\n', '', text, flags=re.M)
    text = re.sub(r'^--- !u!\d+ &(-?\d+).*$', r'---\nfileId: "\1"', text, flags=re.M)
    return list(yaml.safe_load_all(text))
materials, textures, bindings = {}, {}, {}
warnings = []
def texture(guid):
    if guid not in by_guid: raise ValueError('Missing texture '+guid)
    a = by_guid[guid]
    filename = guid + '.png'
    if filename not in textures:
        with Image.open(root / a['path']) as image: image.convert('RGBA').save(out / filename)
        textures[filename] = a['path']
    return filename
for a in manifest:
    if not a['path'].endswith('.mat'): continue
    records=docs((root / a['path']).read_text('utf-8-sig'))
    material_records=[d['Material'] for d in records if d and 'Material' in d]
    if not material_records:
        print('No Material record:',a['path'],[list(d or {}) for d in records]); continue
    m = material_records[0]
    p = m['m_SavedProperties']
    floats = {k:v for d in p.get('m_Floats', []) for k,v in d.items()}
    colors = {k:v for d in p.get('m_Colors', []) for k,v in d.items()}
    tex = {k:v for d in p.get('m_TexEnvs', []) for k,v in d.items()}
    color = colors.get('_Color', dict(r=1,g=1,b=1,a=1))
    result = {'name': m['m_Name'], 'pbrMetallicRoughness': {'baseColorFactor': [color[k] for k in 'rgba'], 'metallicFactor': floats.get('_Metallic', 0), 'roughnessFactor': 1-floats.get('_Glossiness', 0)}}
    base = tex.get('_MainTex', {})
    scale, offset = base.get('m_Scale',dict(x=1,y=1)),base.get('m_Offset',dict(x=0,y=0))
    transform = {'scale':[scale['x'],scale['y']], 'offset':[offset['x'],1-scale['y']-offset['y']]}
    maps = {}
    for unity, gltf in [('_MainTex','baseColorTexture'),('_BumpMap','normalTexture'),('_EmissionMap','emissiveTexture')]:
        guid = tex.get(unity,{}).get('m_Texture',{}).get('guid')
        if guid:
            maps[gltf] = {'file':texture(guid),'transform':transform}
    if floats.get('_Mode',0) == 1: result.update(alphaMode='MASK', alphaCutoff=floats.get('_Cutoff',.5))
    elif floats.get('_Mode',0) in (2,3): result['alphaMode']='BLEND'
    if floats.get('_Cull',2)==0 or floats.get('_CullMode',2)==0: result['doubleSided']=True
    keywords = ' '.join(m.get('m_ValidKeywords', [])) + m.get('m_ShaderKeywords','')
    if '_EMISSION' in keywords:
        c=colors.get('_EmissionColor',dict(r=0,g=0,b=0)); result['emissiveFactor']=[min(1,c[k]) for k in 'rgb']
    else: maps.pop('emissiveTexture',None)
    if 'normalTexture' in maps: maps['normalTexture']['scale']=floats.get('_BumpScale',1)
    mg=tex.get('_MetallicGlossMap',{}).get('m_Texture',{}).get('guid')
    if mg and '_METALLICGLOSSMAP' in keywords:
        filename=a['guid']+'-metalrough.png'
        with Image.open(root/by_guid[mg]['path']) as im:
            r,g,b,alpha=im.convert('RGBA').split()
            rough=alpha.point(lambda v: 255-v*floats.get('_GlossMapScale',1))
            Image.merge('RGB',(Image.new('L',im.size,255),rough,r)).save(out/filename)
        textures[filename]=by_guid[mg]['path']
        maps['metallicRoughnessTexture']={'file':filename,'transform':transform}
        result['pbrMetallicRoughness'].update(metallicFactor=1,roughnessFactor=1)
    materials[a['guid']]={'gltf':result,'maps':maps}
for a in manifest:
    if not a['path'].endswith('.prefab'): continue
    documents=docs((root/a['path']).read_text('utf-8-sig'))
    names={str(d['fileId']):d['GameObject']['m_Name'] for d in documents if d and 'GameObject' in d}
    prefab_bindings={}
    meshes={}
    for d in documents:
        if 'MeshFilter' in d:
            m=d['MeshFilter']; meshes[str(m['m_GameObject']['fileID'])]=m.get('m_Mesh',{}).get('guid')
    for d in documents:
        if 'MeshRenderer' not in d: continue
        renderer=d['MeshRenderer']; guid=meshes.get(str(renderer['m_GameObject']['fileID']))
        slots=[r.get('guid') for r in renderer.get('m_Materials',[])]
        if guid and all(s in materials for s in slots):
            binding=prefab_bindings.setdefault(guid,{'prefab':a['path'],'nodes':{}})
            binding['nodes'][names[str(renderer['m_GameObject']['fileID'])]]=slots
    for guid,binding in prefab_bindings.items(): bindings.setdefault(guid,[]).append(binding)
(out/'unity-materials.json').write_text(json.dumps({'materials':materials,'textures':list(textures),'bindings':bindings},indent=2),encoding='utf-8')
print(json.dumps({'materials':len(materials),'textures':len(textures),'boundMeshes':len(bindings),'fbx':sum(a['path'].endswith('.fbx') for a in manifest)}))
