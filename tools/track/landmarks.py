import json
import sys
import tempfile
from pathlib import Path

import bpy
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import landmark_buildings
import landmark_grandstand
import landmark_paddock
import landmark_park
import landmark_pit
import landmark_t1
import landmark_tower
from landmark_mesh import Centreline, Ground, Part, Parts
from landmark_textures import TILES, maps

LOOKS = {
    "paint": (0.0, 0.62),
    "concrete": (0.0, 0.85),
    "metal": (0.5, 0.36),
    "gloss": (0.0, 0.34),
    "glass": (0.9, 0.07),
    "fabric": (0.0, 0.82),
    "timber": (0.0, 0.75),
    "flag": (0.0, 0.88),
    "lamp": (0.0, 0.5),
}
JPEG_QUALITY = 88
FLAG_IMAGE = (540, 1024)
TEXT_RESOLUTION = 2
AO_SAMPLES = 24
AO_DISTANCE = 4.0
AO_STRENGTH = 0.6
AO_SKIPPED = ("glass", "flag", "lamp")
GROUND_REACH = 260.0
CELL = 160.0
UNSHADOWED = {"rope"}
SPARSE = 400
SPARSE_BLOCK = 3


def arguments():
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    root = Path(argv[0] if argv else "content/tracks/hill-country")
    fonts = Path(argv[1] if len(argv) > 1 else "build/hill-country/fonts")
    return root, fonts


def packed(name, pixels, colour, folder):
    height, width = pixels.shape[:2]
    image = bpy.data.images.new(name, width, height, alpha=False)
    rgba = np.concatenate([pixels[::-1], np.ones((height, width, 1))], axis=2)
    image.pixels.foreach_set(rgba.astype(np.float32).ravel())
    path = Path(folder) / f"{name.replace(' ', '-')}.jpg"
    image.filepath_raw = str(path)
    image.file_format = "JPEG"
    bpy.context.scene.render.image_settings.quality = JPEG_QUALITY
    image.save()
    loaded = bpy.data.images.load(str(path))
    loaded.colorspace_settings.name = "sRGB" if colour else "Non-Color"
    loaded.pack()
    bpy.data.images.remove(image)
    return loaded


def look_material(look, folder, image=None):
    metallic, roughness = LOOKS[look]
    mat = bpy.data.materials.new(f"landmark {look}")
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    bsdf = nodes["Principled BSDF"]
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = roughness
    if image is not None:
        texture = nodes.new("ShaderNodeTexImage")
        texture.image = image
        links.new(texture.outputs["Color"], bsdf.inputs["Base Color"])
        return mat
    if look not in TILES:
        colour = nodes.new("ShaderNodeVertexColor")
        colour.layer_name = "Col"
        links.new(colour.outputs["Color"], bsdf.inputs["Base Color"])
        return mat
    albedo, normal, rough = maps(look)
    base = nodes.new("ShaderNodeTexImage")
    base.image = packed(f"landmark {look} albedo", albedo, True, folder)
    links.new(base.outputs["Color"], bsdf.inputs["Base Color"])
    grain = nodes.new("ShaderNodeTexImage")
    grain.image = packed(f"landmark {look} roughness", rough, False, folder)
    split = nodes.new("ShaderNodeSeparateColor")
    links.new(grain.outputs["Color"], split.inputs["Color"])
    links.new(split.outputs["Green"], bsdf.inputs["Roughness"])
    bump = nodes.new("ShaderNodeTexImage")
    bump.image = packed(f"landmark {look} normal", normal, False, folder)
    mapped = nodes.new("ShaderNodeNormalMap")
    links.new(bump.outputs["Color"], mapped.inputs["Color"])
    links.new(mapped.outputs["Normal"], bsdf.inputs["Normal"])
    return mat


def flag_texture():
    height, width = FLAG_IMAGE
    pixels = landmark_t1.flag_image(height, width)
    image = bpy.data.images.new("landmark flag", width, height, alpha=False)
    rgba = np.concatenate([pixels[::-1], np.ones((height, width, 1))], axis=2)
    image.pixels.foreach_set(rgba.astype(np.float32).ravel())
    image.file_format = "PNG"
    image.pack()
    return image


def writer(fonts):
    loaded = {}

    def write(part, text, font, size, origin, right, up, out, colour):
        face = loaded.get(font) or bpy.data.fonts.load(str(fonts / f"{font}.ttf"))
        loaded[font] = face
        curve = bpy.data.curves.new("landmark text", "FONT")
        curve.body = text
        curve.font = face
        curve.resolution_u = TEXT_RESOLUTION
        curve.fill_mode = "FRONT"
        obj = bpy.data.objects.new("landmark text", curve)
        bpy.context.scene.collection.objects.link(obj)
        evaluated = obj.evaluated_get(bpy.context.evaluated_depsgraph_get())
        mesh = evaluated.to_mesh()
        mesh.calc_loop_triangles()
        points = np.array([v.co[:] for v in mesh.vertices], float)
        triangles = [tuple(t.vertices) for t in mesh.loop_triangles]
        low, high = points.min(axis=0), points.max(axis=0)
        scale = size / max(high[1] - low[1], 1e-6)
        def place(v):
            return origin + right * (v[0] - low[0]) * scale + up * (v[1] - low[1]) * scale + out * (v[2] - low[2]) * scale

        part.mesh(points, triangles, colour, place)
        evaluated.to_mesh_clear()
        bpy.data.objects.remove(obj)
        bpy.data.curves.remove(curve)
        return (high[0] - low[0]) * scale

    return write


class Site:
    def __init__(self, root, fonts):
        self.root = root
        self.ground = Ground(root / "road.glb")
        self.line = Centreline(root / "track.json")
        self.write = writer(fonts)


def bake_ground(ground, objects):
    points = np.concatenate([np.array([v.co[:] for v in obj.data.vertices]) + np.array(obj.location[:]) for obj in objects])
    low, high = points[:, :2].min(axis=0) - GROUND_REACH, points[:, :2].max(axis=0) + GROUND_REACH
    triangles = ground.triangles
    centre = triangles[:, :, :2].mean(axis=1)
    near = np.all((centre > low) & (centre < high), axis=1)
    chosen = triangles[near].reshape(-1, 3)
    mesh = bpy.data.meshes.new("bake ground")
    mesh.from_pydata(chosen.tolist(), [], [(k, k + 1, k + 2) for k in range(0, len(chosen), 3)])
    obj = bpy.data.objects.new("bake ground", mesh)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def occlusion(ground):
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = AO_SAMPLES
    world = bpy.data.worlds.new("bake")
    scene.world = world
    world.light_settings.distance = AO_DISTANCE
    targets = [o for o in scene.objects if o.type == "MESH" and not any(f" {look} " in f"{o.name} " for look in AO_SKIPPED)]
    floor = bake_ground(ground, targets)
    for obj in targets:
        mesh = obj.data
        layer = mesh.color_attributes.new(name="AO", type="FLOAT_COLOR", domain="POINT")
        mesh.color_attributes.active_color = layer
        bpy.ops.object.select_all(action="DESELECT")
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.bake(type="AO", target="VERTEX_COLORS")
        shade = np.zeros(len(mesh.vertices) * 4)
        layer.data.foreach_get("color", shade)
        base = mesh.color_attributes["Col"]
        colour = np.zeros(len(mesh.vertices) * 4)
        base.data.foreach_get("color", colour)
        shade, colour = shade.reshape(-1, 4), colour.reshape(-1, 4)
        colour[:, :3] *= (1 - AO_STRENGTH) + AO_STRENGTH * shade[:, :1]
        base.data.foreach_set("color", colour.ravel())
        mesh.color_attributes.remove(layer)
        mesh.color_attributes.active_color = mesh.color_attributes["Col"]
    bpy.data.objects.remove(floor)


def emit_cell(name, look, points, faces, colours, uvs, smooth, materials):
    used = sorted({v for f in faces for v in f})
    remap = {v: k for k, v in enumerate(used)}
    local = points[used]
    centre = (local.min(axis=0) + local.max(axis=0)) / 2
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata((local - centre).tolist(), [], [[remap[v] for v in f] for f in faces])
    mesh.polygons.foreach_set("use_smooth", smooth)
    loops = np.array([remap[v] for f in faces for v in f], int)
    layer = mesh.uv_layers.new(name="UVMap")
    scale = 1.0 / TILES.get(look, 1.0) if look != "flag" else 1.0
    layer.data.foreach_set("uv", (uvs[used][loops] * scale).ravel())
    colour = mesh.color_attributes.new(name="Col", type="FLOAT_COLOR", domain="POINT")
    colour.data.foreach_set("color", np.concatenate([colours[used], np.ones((len(used), 1))], axis=1).ravel())
    mesh.materials.append(materials[look])
    obj = bpy.data.objects.new(name, mesh)
    obj.location = centre.tolist()
    bpy.context.scene.collection.objects.link(obj)


def emit(name, look, part, materials):
    points, faces, colours, uvs, smooth = part.arrays()
    if not faces:
        return
    cells = {}
    for k, f in enumerate(faces):
        key = tuple(np.floor(points[list(f)][:, :2].mean(axis=0) / CELL).astype(int))
        cells.setdefault(key, []).append(k)
    groups = {}
    for (i, j), members in sorted(cells.items()):
        if len(members) < SPARSE:
            key = (f"{name} {i // SPARSE_BLOCK} {j // SPARSE_BLOCK} wide", )
        else:
            key = (f"{name} {i} {j}", )
        groups.setdefault(key, []).extend(members)
    for (title, ), members in sorted(groups.items()):
        emit_cell(title, look, points, [faces[k] for k in members], colours, uvs, smooth[members], materials)


def merged(parts):
    looks = {}
    for (group, look), part in sorted(parts.items.items()):
        whole = looks.setdefault((group if group in UNSHADOWED else look, look), Part())
        offset = whole.count
        whole.points += part.points
        whole.colours += part.colours
        whole.uvs += part.uvs
        whole.faces += [tuple(v + offset for v in f) for f in part.faces]
        whole.smooth += part.smooth
    return looks


def main():
    root, fonts = arguments()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    site = Site(root, fonts)
    parts = Parts()
    for module in (landmark_t1, landmark_tower, landmark_grandstand, landmark_park, landmark_pit, landmark_buildings, landmark_paddock):
        module.build(parts, site)
    folder = tempfile.mkdtemp()
    materials = {look: look_material(look, folder, flag_texture() if look == "flag" else None) for look in LOOKS}
    for (name, look), part in merged(parts).items():
        emit(f"landmark {name}", look, part, materials)
    occlusion(site.ground)
    (root / "landmarks.json").write_text(json.dumps(parts.footprints, separators=(",", ":")) + "\n")
    out = root / "landmarks.glb"
    bpy.ops.export_scene.gltf(
        filepath=str(out),
        export_format="GLB",
        export_yup=True,
        export_texcoords=True,
        export_normals=True,
        export_vertex_color="ACTIVE",
        export_materials="EXPORT",
        export_image_format="AUTO",
        export_jpeg_quality=JPEG_QUALITY,
        export_extras=False,
    )
    count = sum(len(o.data.polygons) for o in bpy.data.objects if o.type == "MESH")
    print(f"landmarks: {len(parts.items)} parts, {count} faces -> {out}")


if __name__ == "__main__":
    main()
