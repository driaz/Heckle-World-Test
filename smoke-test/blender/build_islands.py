"""Model the island blocks + moss caps and bake their lighting (Cycles, CPU), then export one GLB per island.

    blender -b -P blender/build_islands.py -- blender/layout.json public/models/islands [A D ...]

Geometry is built in the island's local Three.js frame (cell i -> x, height -> y, cell j -> z) and rotated to
Blender's Z-up at the end, so the glTF exporter hands Three.js the original local coordinates back.
Albedo goes out as vertex colours (large smooth colour shifts, no fine detail); the baked texture holds lighting only
(sky visibility, bounce light and a soft share of the sun) and is used as a lightMap in Three.js.
"""
import bpy, bmesh, json, sys, math, time, random, os
import numpy as np
from mathutils import Vector, Matrix, noise

argv = sys.argv[sys.argv.index('--') + 1:]
LAYOUT = json.load(open(argv[0]))
OUT = argv[1]
ONLY = argv[2:]
os.makedirs(OUT, exist_ok=True)
SAMPLES = int(os.environ.get('BAKE_SAMPLES', 48))
SUN_SHARE = float(os.environ.get('SUN_SHARE', 1.0))    # Cycles sun strength baked in (the rest of the sun is real-time)
SKY = float(os.environ.get('SKY', 0.42))
RES = {"A": 1024, "D": 1024, "F": 1024, "H": 1024, "E": 1024, "G": 1024, "BG": 512}
SPLIT = {"A", "D", "F", "H", "E", "G"}  # moss and stone each get their own lightmap

DIRS = [(1, 0), (-1, 0), (0, 1), (0, -1)]
WARM = ['#cf8f4a', '#c07a3a', '#b06c30', '#d9a05a', '#a5622f', '#c98445', '#dfae6a', '#b87236', '#a85f35']
GREY = ['#b3a898', '#a59a88', '#bdb3a2', '#9d9282']
STEP = ['#b9ad98', '#a89c86', '#c4b8a2', '#b0a48e']
ROCK = ['#b88a5e', '#a67c56', '#c09468', '#a08468']


def srgb(h):
    h = h.lstrip('#')
    c = np.array([int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)])
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def mix(a, b, t):
    return a + (b - a) * t


# ---------------------------------------------------------------- rounded-box template
def make_template(segs):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=4.0)
    bmesh.ops.bevel(bm, geom=bm.edges[:], offset=1.0, offset_type='OFFSET', segments=segs, profile=0.5, affect='EDGES')
    bm.verts.ensure_lookup_table()
    P = np.array([v.co[:] for v in bm.verts])
    faces = [[v.index for v in f.verts] for f in bm.faces]
    bm.free()
    S, Dd = np.sign(P), np.abs(P) - 1.0
    fmin = np.array([P[f].min(axis=0) for f in faces])
    fmax = np.array([P[f].max(axis=0) for f in faces])
    return {'S': S, 'D': Dd, 'faces': faces, 'fmin': fmin, 'fmax': fmax, 'P': P}


TEMPL = {s: make_template(s) for s in (1, 2, 3)}
print('template tris', {k: sum(len(f) - 2 for f in t['faces']) for k, t in TEMPL.items()})


def rot_y(a):
    c, s = math.cos(a), math.sin(a)
    return np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]])


def rot_euler_yxz(rx, ry, rz):
    cx, sx, cz, sz = math.cos(rx), math.sin(rx), math.cos(rz), math.sin(rz)
    Rx = np.array([[1, 0, 0], [0, cx, -sx], [0, sx, cx]])
    Rz = np.array([[cz, -sz, 0], [sz, cz, 0], [0, 0, 1]])
    return rot_y(ry) @ Rx @ Rz


class Builder:
    def __init__(self, M):
        self.V, self.F, self.C, self.mat, self.hid = [], [], [], [], []
        self.n = 0
        self.M = np.array(M).reshape(4, 4).T  # column-major -> matrix

    def world(self, W):
        return W @ self.M[:3, :3].T + self.M[:3, 3]

    def box(self, c, size, bevel, segs, color, mat, R=None, drop=(), hide=(), top=0.0, colfn=None):
        """drop / hide: list of (axis, sign) sides of the local box. drop removes the faces on that side,
        hide marks flat faces that are buried against a neighbour (they get a tiny share of the lightmap)."""
        T = TEMPL[segs]
        half = np.array(size, float) / 2
        b = min(bevel, half.min() * 0.9)
        L = T['S'] * ((half - b) + b * T['D'])
        W = (L @ R.T if R is not None else L) + np.array(c, float)
        ny = L[:, 1] / half[1]
        if colfn is not None:
            col = colfn(W, ny)
        else:
            col = color[None, :] * (1.0 + top * ny)[:, None]
        base = self.n
        self.V.append(W); self.C.append(col); self.n += len(W)
        for k, f in enumerate(T['faces']):
            skip = False
            for ax, sg in drop:
                if (sg > 0 and T['fmin'][k][ax] >= 1 - 1e-4) or (sg < 0 and T['fmax'][k][ax] <= -1 + 1e-4):
                    skip = True
            if skip:
                continue
            h = 0
            for ax, sg in hide:
                if (sg > 0 and T['fmin'][k][ax] >= 2 - 1e-4) or (sg < 0 and T['fmax'][k][ax] <= -2 + 1e-4):
                    h = 1
            self.F.append([base + i for i in f]); self.mat.append(mat); self.hid.append(h)


def lowfreq(p, f, seed=0.0):
    return noise.noise(Vector((p[0] * f + seed, p[1] * f + seed * 0.37, p[2] * f - seed)))


MOSS_DARK, MOSS_MID, MOSS_LIGHT, MOSS_YEL = srgb('#507c22'), srgb('#7da530'), srgb('#a2be3c'), srgb('#c3cd50')
MOSS_SHADE = srgb('#335a18')


def moss_colfn(B, drip=False, bias=0.0):
    def fn(W, ny):
        ww = B.world(W)
        out = np.zeros((len(W), 3))
        for i, p in enumerate(ww):
            n = 0.5 + 0.6 * lowfreq(p, 0.42, 3.1) + 0.35 * lowfreq(p, 1.05, 9.7) + bias
            n = min(1.0, max(0.0, (n - 0.2) * 1.5))
            c = mix(MOSS_MID, MOSS_LIGHT, n)
            y = 0.5 + 0.55 * lowfreq(p, 0.6, 21.0) + bias
            c = mix(c, MOSS_YEL, min(1.0, max(0.0, y - 0.5) * 1.5))
            c = mix(c, MOSS_DARK, min(1.0, max(0.0, 0.45 - n) * 1.8))
            # sides and hanging lobes go deeper green toward the bottom
            t = (1 - ny[i]) * 0.5
            c = mix(c, MOSS_SHADE, (0.12 + 0.6 * t) if drip else 0.6 * t * t)
            out[i] = c
        return out
    return fn


def stone_colfn(B, base, top=0.12, tint=0.07):
    def fn(W, ny):
        ww = B.world(W)
        out = np.zeros((len(W), 3))
        for i, p in enumerate(ww):
            n = lowfreq(p, 0.45, 5.0)
            c = base * (1.0 + top * ny[i] + tint * n)
            c = c * np.array([1.0 + 0.05 * n, 1.0, 1.0 - 0.07 * n])  # warm/cool drift
            out[i] = c
        return out
    return fn


def build_island(isl):
    rng = random.Random(isl.get('seed', 1))
    B = Builder(isl['M'])
    lod = isl.get('lod', False)  # far background island: fewest segments, no lumps
    cells = {(c['i'], c['j']): c for c in isl['cells']}
    base = isl['base']
    get = lambda i, j: cells.get((i, j))
    top_y = max(c['h'] for c in cells.values())
    avoid = isl.get('mossAvoid', [])
    HAZE = srgb('#8fa6cf')

    def brick_color(t):
        c = srgb(rng.choice(GREY) if rng.random() < 0.05 + t * 0.2 else rng.choice(WARM))
        c = c * (0.84 + (rng.random() - 0.5) * 0.14)
        g = c.mean()
        c = mix(c, np.array([g, g, g]), 0.14)
        c = mix(c, HAZE, min(0.8, max(0.0, t)))  # deep walls dissolve into blue haze toward the bottom
        return c

    MOSS, STONE = 0, 1
    CORE = srgb('#3a2a1c')
    for c in cells.values():
        i, j, h, typ = c['i'], c['j'], c['h'], c['type']
        cx, cz = i + 0.5, j + 0.5
        exposed = {}
        any_wall = False
        for di, dj in DIRS:
            n = get(i + di, j + dj)
            nh = n['h'] if n else -1e9
            exposed[(di, dj)] = (nh < h - 0.3)
            if nh >= h:
                continue
            any_wall = True
            wall_bot = (nh - 0.3) if n else base
            R = rot_y(math.pi / 2) if di != 0 else None
            back = (2, -(di + dj))
            y = h - 0.36
            while y > wall_bot:
                t = (-(y) - 2.4) / 4.0  # haze by absolute depth below the island's ground level
                segs = 1 if (lod or y < top_y - 4.6) else 2
                out = 0.355 + (rng.random() - 0.5) * 0.07
                hide = [(0, 1), (0, -1), (1, 1), (1, -1)]
                gh = 0.455 + rng.random() * 0.02   # leaves a dark mortar gap down to the core
                if rng.random() < 0.58:
                    col = brick_color(t)
                    B.box((cx + di * out, y - 0.25, cz + dj * out), (0.955, gh, 0.34), 0.08, segs, col, STONE, R=R, drop=[back], hide=hide,
                          colfn=stone_colfn(B, col))
                else:
                    tx, tz = (0, 1) if di != 0 else (1, 0)
                    for s in (-0.25, 0.25):
                        o2 = out + (rng.random() - 0.5) * 0.06
                        col = brick_color(t)
                        B.box((cx + di * o2 + tx * s, y - 0.25, cz + dj * o2 + tz * s), (0.455, gh, 0.34), 0.075, segs, col, STONE, R=R, drop=[back], hide=hide,
                              colfn=stone_colfn(B, col))
                y -= 0.5
        if any_wall:
            # dark core behind the bricks: what you see down the mortar gaps
            bot = base - 0.1
            B.box((cx, (h - 0.3 + bot) / 2, cz), (0.9, h - 0.3 - bot, 0.9), 0.01, 1, CORE, STONE, drop=[(1, 1)],
                  hide=[(0, 1), (0, -1), (1, -1), (2, 1), (2, -1)])
        if typ == 'grass':
            # thick puffy cap: hangs over every exposed side, and overlaps its neighbours by a random amount so the
            # seams between caps are soft dimples of varying depth instead of a tidy grid
            x0, x1, z0, z1 = cx - 0.5, cx + 0.5, cz - 0.5, cz + 0.5
            ov = lambda: 0.15 + rng.random() * 0.07
            inn = lambda: 0.05 + rng.random() * 0.07
            hide = []
            if exposed[(1, 0)]: x1 += ov()
            else: x1 += inn(); hide.append((0, 1))
            if exposed[(-1, 0)]: x0 -= ov()
            else: x0 -= inn(); hide.append((0, -1))
            if exposed[(0, 1)]: z1 += ov()
            else: z1 += inn(); hide.append((2, 1))
            if exposed[(0, -1)]: z0 -= ov()
            else: z0 -= inn(); hide.append((2, -1))
            th = 0.52
            jit = (rng.random() - 0.5) * 0.03
            B.box(((x0 + x1) / 2, h - th / 2 + jit, (z0 + z1) / 2), (x1 - x0, th, z1 - z0), 0.16, 3 if (len(hide) < 4 and not lod) else 2, None, MOSS, drop=[(1, -1)], hide=hide,
                  colfn=moss_colfn(B))
            for di, dj in DIRS:
                if not exposed[(di, dj)]:
                    continue
                tx, tz = (0, 1) if di != 0 else (1, 0)
                R = rot_y(math.pi / 2) if di != 0 else None
                back = (2, -(di + dj))
                for s in ((-0.25, 0.25) if lod else (-0.34, 0.0, 0.34)):
                    ln = 0.3 + rng.random() * rng.random() * 0.6
                    w = (0.5 if lod else 0.33) + rng.random() * 0.2
                    o = 0.58 + rng.random() * 0.06
                    ss = s + (rng.random() - 0.5) * 0.08
                    B.box((cx + di * o + tx * ss, h - 0.14 - ln / 2, cz + dj * o + tz * ss), (w, ln, 0.28), 0.12, 1 if lod else 2, None, MOSS, R=R, drop=[back],
                          hide=[(0, 1), (0, -1)], colfn=moss_colfn(B, drip=True))
            if not lod:
                # soft mounds on top: a big-radius rounded box, squashed flat and sunk until only its domed top shows.
                # Lighter or darker than the cap, kept off the dirt paths.
                for _ in range(2):
                    lx, lz = cx + (rng.random() - 0.5) * 0.85, cz + (rng.random() - 0.5) * 0.85
                    sx, sz = 0.62 + rng.random() * 0.3, 0.62 + rng.random() * 0.3
                    ry, up, v = rng.random() * 3.14, 0.03 + rng.random() * 0.04, rng.random()
                    if any(math.hypot(lx - ax, lz - az) < ar + 0.3 for ax, az, ar in avoid):
                        continue
                    q = 0.3  # vertical squash
                    B.box((lx, h + up - 0.33 * q, lz), (sx, 0.66, sz), 0.29, 2, None, MOSS, R=rot_y(ry) @ np.diag([1.0, q, 1.0]), drop=[(1, -1)],
                          hide=[(0, 1), (0, -1), (2, 1), (2, -1)], colfn=moss_colfn(B, bias=0.16 if v < 0.4 else (-0.16 if v > 0.75 else 0.0)))

    # stairs: light stone slabs on a solid fill
    for st in isl.get('stairs', []):
        r2 = random.Random(st['seed'])
        n = round((st['h1'] - st['h0']) / 0.27)
        rise = (st['h1'] - st['h0']) / n
        tread = st['len'] / n
        for k in range(n):
            zc = st['j0'] + 1 - (k + 0.5) * tread
            top = st['h0'] + (k + 1) * rise
            col = srgb(r2.choice(STEP))
            B.box((st['i'] + 0.5 + (r2.random() - 0.5) * 0.03, top - 0.15, zc), (0.96, 0.3, tread * 1.2), 0.06, 2, col, STONE, colfn=stone_colfn(B, col, 0.06, 0.04))
            y0, y1 = st['h0'] - 0.3, top - 0.2
            B.box((st['i'] + 0.5, (y0 + y1) / 2, zc), (0.9, y1 - y0, tread), 0.01, 1, srgb('#8a7458'), STONE, hide=[(0, 1), (0, -1), (1, -1), (2, 1), (2, -1)])

    # underside: stepped rough stone shrinking toward the centroid (outer ring(s) only; the middle is never seen)
    dist = {}
    frontier = []
    for k in cells:
        if any((k[0] + a, k[1] + b) not in cells for a in (-1, 0, 1) for b in (-1, 0, 1)):
            dist[k] = 1; frontier.append(k)
    d = 1
    while frontier:
        nxt = []
        for k in frontier:
            for di, dj in DIRS:
                q = (k[0] + di, k[1] + dj)
                if q in cells and q not in dist:
                    dist[q] = d + 1; nxt.append(q)
        frontier = nxt; d += 1
    mx = sum(k[0] + 0.5 for k in cells) / len(cells)
    mz = sum(k[1] + 0.5 for k in cells) / len(cells)
    K = isl.get('taper', 3)
    amt = isl.get('taperAmt', 0.82)
    for k in range(1, K + 1):
        s = 1 - (k / (K + 1)) * amt
        t = k / K
        for key in cells:
            col = mix(srgb(rng.choice(ROCK)) * 0.72, HAZE, 0.04 + t * 0.3)
            px = mx + (key[0] + 0.5 - mx) * s + (rng.random() - 0.5) * 0.1
            py = base - 0.36 - (k - 1) * 0.7 + (rng.random() - 0.5) * 0.22
            pz = mz + (key[1] + 0.5 - mz) * s + (rng.random() - 0.5) * 0.1
            R = rot_euler_yxz((rng.random() - 0.5) * 0.16, (rng.random() - 0.5) * 0.3, (rng.random() - 0.5) * 0.16)
            if dist[key] > (2 if k == 1 else 1):
                continue
            B.box((px, py, pz), (1.16 * s, 0.86, 1.16 * s), 0.2, 1 if (lod or k > 1) else 2, col, STONE, R=R, colfn=stone_colfn(B, col, 0.08, 0.05))
    return B


# ---------------------------------------------------------------- scene / bake setup
def setup_scene(sun_local):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.samples = SAMPLES
    sc.cycles.max_bounces = 3
    sc.cycles.diffuse_bounces = 2
    sc.cycles.use_denoising = True
    try:
        sc.cycles.denoiser = 'OPENIMAGEDENOISE'
    except Exception as e:
        print('denoiser', e)
    sc.render.threads_mode = 'AUTO'
    sc.render.bake.use_pass_direct = True
    sc.render.bake.use_pass_indirect = True
    sc.render.bake.use_pass_color = False
    sc.render.bake.margin = 6
    w = bpy.data.worlds.new('sky'); sc.world = w; w.use_nodes = True
    nt = w.node_tree; nt.nodes.clear()
    tc = nt.nodes.new('ShaderNodeTexCoord'); sep = nt.nodes.new('ShaderNodeSeparateXYZ')
    ramp = nt.nodes.new('ShaderNodeValToRGB'); mr = nt.nodes.new('ShaderNodeMapRange')
    bg = nt.nodes.new('ShaderNodeBackground'); outn = nt.nodes.new('ShaderNodeOutputWorld')
    mr.inputs['From Min'].default_value = -1; mr.inputs['From Max'].default_value = 1
    e = ramp.color_ramp.elements
    e[0].position = 0.0; e[0].color = (0.26, 0.31, 0.44, 1)     # cloud floor bounce from below
    e[1].position = 1.0; e[1].color = (0.62, 0.80, 1.0, 1)      # zenith
    m = ramp.color_ramp.elements.new(0.5); m.color = (0.78, 0.8, 0.86, 1)  # bright hazy horizon
    bg.inputs['Strength'].default_value = SKY
    nt.links.new(tc.outputs['Generated'], sep.inputs[0]); nt.links.new(sep.outputs['Z'], mr.inputs['Value'])
    nt.links.new(mr.outputs['Result'], ramp.inputs['Fac']); nt.links.new(ramp.outputs['Color'], bg.inputs['Color'])
    nt.links.new(bg.outputs['Background'], outn.inputs['Surface'])
    if SUN_SHARE > 0:
        ld = bpy.data.lights.new('sun', 'SUN'); ld.energy = SUN_SHARE; ld.angle = math.radians(14); ld.color = (1.0, 0.9, 0.72)
        lo = bpy.data.objects.new('sun', ld); sc.collection.objects.link(lo)
        dvec = Vector((sun_local[0], -sun_local[2], sun_local[1]))  # three -> blender
        lo.rotation_euler = dvec.to_track_quat('Z', 'Y').to_euler()  # a sun shines along its -Z
    return sc


def make_material(name, img):
    m = bpy.data.materials.new(name); m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes['Principled BSDF']
    bsdf.inputs['Roughness'].default_value = 0.9 if 'moss' in name else 0.6
    att = nt.nodes.new('ShaderNodeVertexColor'); att.layer_name = 'Col'
    nt.links.new(att.outputs['Color'], bsdf.inputs['Base Color'])
    tex = nt.nodes.new('ShaderNodeTexImage'); tex.image = img
    nt.nodes.active = tex; tex.select = True
    return m, tex, bsdf


def process(isl):
    t0 = time.time()
    name = isl['name']
    Mn = np.array(isl['M']).reshape(4, 4).T
    sd = np.array(LAYOUT['sunDir'])
    sun_local = Mn[:3, :3].T @ sd
    sun_local /= np.linalg.norm(sun_local)
    sc = setup_scene(sun_local)
    B = build_island(isl)
    V = np.concatenate(B.V); C = np.concatenate(B.C)
    me = bpy.data.meshes.new('isl_' + name)
    me.from_pydata(V.tolist(), [], B.F)
    me.update()
    ca = me.color_attributes.new('Col', 'FLOAT_COLOR', 'POINT')
    ca.data.foreach_set('color', np.concatenate([np.clip(C, 0, 1), np.ones((len(C), 1))], axis=1).ravel())
    me.color_attributes.active_color = ca
    try:
        me.color_attributes.render_color_index = 0
    except Exception:
        pass
    me.polygons.foreach_set('material_index', B.mat)
    me.polygons.foreach_set('use_smooth', [True] * len(B.F))
    hid = me.attributes.new('hid', 'INT', 'FACE'); hid.data.foreach_set('value', B.hid)
    me.transform(Matrix.Rotation(math.pi / 2, 4, 'X'))
    ob = bpy.data.objects.new('isl_' + name, me)
    sc.collection.objects.link(ob)
    bpy.context.view_layer.objects.active = ob; ob.select_set(True)
    tris = sum(len(f) - 2 for f in B.F)
    print(f'{name}: {tris} tris', flush=True)
    if os.environ.get('COUNT_ONLY'):
        return dict(name=name, tris=tris)

    res = RES[name]
    split = name in SPLIT
    imgs = [bpy.data.images.new(f'{name}_light_{k}', res, res, alpha=False, float_buffer=True) for k in ((0, 1) if split else (0,))]
    mats = []
    for k, mn in enumerate(('moss', 'stone')):
        m, tex, bsdf = make_material(f'{name}_{mn}', imgs[k if split else 0])
        me.materials.append(m); mats.append((m, tex, bsdf))

    # weighted normals so the flat faces stay flat and the bevels read as rounded
    mod = ob.modifiers.new('wn', 'WEIGHTED_NORMAL'); mod.keep_sharp = False; mod.weight = 60
    bpy.ops.object.modifier_apply(modifier='wn')

    # UVs: smart project, shrink buried faces, repack
    t1 = time.time()
    bpy.ops.object.mode_set(mode='EDIT')
    bm = bmesh.from_edit_mesh(me)
    groups = [[0], [1]] if split else [[0, 1]]
    for g in groups:
        for f in bm.faces:
            f.select_set(f.material_index in g)
        bm.select_flush_mode()
        bmesh.update_edit_mesh(me)
        bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.0, area_weight=0.0, correct_aspect=True, scale_to_bounds=False)
        bm = bmesh.from_edit_mesh(me)
        uvl = bm.loops.layers.uv.verify()
        hl = bm.faces.layers.int.get('hid')
        for f in bm.faces:
            if f.select and f[hl]:
                cen = Vector((0, 0))
                for l in f.loops: cen += l[uvl].uv
                cen /= len(f.loops)
                for l in f.loops: l[uvl].uv = cen + (l[uvl].uv - cen) * 0.22
        bmesh.update_edit_mesh(me)
        bpy.ops.uv.pack_islands(rotate=True, margin_method='FRACTION', margin=0.0035 * (1024 / res), shape_method='AABB')
        bm = bmesh.from_edit_mesh(me)
    bpy.ops.object.mode_set(mode='OBJECT')
    t_uv = time.time() - t1

    t2 = time.time()
    bpy.ops.object.bake(type='DIFFUSE')
    t_bake = time.time() - t2

    # the exported GLB carries the baked texture as base colour; Three.js rewires it to lightMap
    for k, im in enumerate(imgs):
        im.filepath_raw = os.path.join(OUT, f'{name}_light_{k}.png'); im.file_format = 'PNG'; im.save()
    for m, tex, bsdf in mats:
        nt = m.node_tree
        for l in list(bsdf.inputs['Base Color'].links): nt.links.remove(l)
        nt.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
    kw = dict(filepath=os.path.join(OUT, f'isl_{name}.glb'), export_format='GLB', use_selection=True, export_apply=True,
              export_image_format='JPEG', export_yup=True, export_normals=True, export_materials='EXPORT')
    try:
        bpy.ops.export_scene.gltf(**kw, export_vertex_color='ACTIVE', export_all_vertex_colors=False, export_image_quality=92)
    except TypeError as e:
        print('gltf export fallback:', e)
        bpy.ops.export_scene.gltf(**kw)
    print(f'RESULT {name}: tris={tris} verts={len(V)} res={res}x{len(imgs)} samples={SAMPLES} build+uv={t1 - t0 + t_uv:.1f}s (uv {t_uv:.1f}s) bake={t_bake:.1f}s total={time.time() - t0:.1f}s', flush=True)
    return dict(name=name, tris=tris, res=res, maps=len(imgs), samples=SAMPLES, uv_s=round(t_uv, 1), bake_s=round(t_bake, 1), total_s=round(time.time() - t0, 1))


# one extra low-poly island, instanced far away as the hazy background islands
_c, _s = math.cos(-0.6), math.sin(-0.6)
LAYOUT['islands'].append(dict(name='BG', lod=True, base=-0.9, taper=3, seed=77, stairs=[],
                              M=[_c, 0, -_s, 0, 0, 1, 0, 0, _s, 0, _c, 0, 0, 0, 0, 1],
                              cells=[dict(i=i, j=j, h=0, type='grass') for i in range(3) for j in range(3)]))
results = []
for isl in LAYOUT['islands']:
    if ONLY and isl['name'] not in ONLY:
        continue
    results.append(process(isl))
log = os.path.join(OUT, 'bake-log.json')
old = json.load(open(log)) if os.path.exists(log) else {}
for r in results:
    old[r['name']] = r
json.dump(old, open(log, 'w'), indent=1)
print('ALL DONE', json.dumps(results))
