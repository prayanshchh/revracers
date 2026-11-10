import json
import math
import sys
from pathlib import Path

import bpy
import numpy as np
import OpenImageIO as oiio
from mathutils import Matrix, Vector

COLUMNS = 6
ROWS = 4
AZIMUTHS = 12
RINGS = (math.radians(5.0), math.radians(40.0))
MARGIN = 1.04
SAMPLES = 48
SKY_STRENGTH = 1.0
OCCLUSION_FLOOR = 0.3
OCCLUSION_GAIN = 1.35
COVERAGE_GAMMA = 0.8


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "GPU"
    preferences = bpy.context.preferences.addons["cycles"].preferences
    preferences.compute_device_type = "METAL"
    preferences.get_devices()
    for device in preferences.devices:
        device.use = True
    scene.cycles.samples = SAMPLES
    scene.cycles.use_denoising = False
    scene.cycles.max_bounces = 3
    scene.cycles.transparent_max_bounces = 16
    scene.render.film_transparent = True
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "None"
    layer = scene.view_layers[0]
    layer.use_pass_diffuse_color = True
    layer.use_pass_normal = True
    layer.use_pass_z = True
    world = bpy.data.worlds.new("sky")
    world.use_nodes = True
    background = world.node_tree.nodes["Background"]
    background.inputs[0].default_value = (1, 1, 1, 1)
    background.inputs[1].default_value = SKY_STRENGTH
    scene.world = world
    return scene


def load_tree(path, only):
    bpy.ops.import_scene.gltf(filepath=str(path))
    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    for mesh in [m for m in meshes if only and only not in m.name]:
        bpy.data.objects.remove(mesh)
    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    for material in bpy.data.materials:
        material.use_backface_culling = False
        if not material.use_nodes:
            continue
        for node in material.node_tree.nodes:
            if node.type == "BSDF_PRINCIPLED":
                node.inputs["Metallic"].default_value = 0
                for link in list(node.inputs["Metallic"].links):
                    material.node_tree.links.remove(link)
    low = np.array([math.inf] * 3)
    high = -low
    parts = []
    for mesh in meshes:
        world = np.array(mesh.matrix_world)
        count = len(mesh.data.vertices)
        local = np.empty(count * 3, np.float32)
        mesh.data.vertices.foreach_get("co", local)
        points = local.reshape(-1, 3) @ world[:3, :3].T + world[:3, 3]
        low = np.minimum(low, points.min(0))
        high = np.maximum(high, points.max(0))
        parts.append(points)
    points = np.concatenate(parts)
    height = high[2] - low[2]
    centre = (np.percentile(points[:, :2], 0.5, axis=0) + np.percentile(points[:, :2], 99.5, axis=0)) / 2
    base = np.array([centre[0], centre[1], low[2]])
    radius = np.percentile(np.linalg.norm(points[:, :2] - centre, axis=1), 99.7)
    return meshes, base, float(height), float(radius)


def frame_sizes(height, radius):
    return [max(2 * radius, height * math.cos(e) + 2 * radius * math.sin(e)) * MARGIN for e in RINGS]


def camera_for(scene, base, size, azimuth, elevation, radius):
    data = bpy.data.cameras.new("eye")
    data.type = "ORTHO"
    data.ortho_scale = size
    data.clip_start = 0.01
    data.clip_end = 1000
    camera = bpy.data.objects.new("eye", data)
    scene.collection.objects.link(camera)
    scene.camera = camera
    toward = Vector((math.cos(azimuth) * math.cos(elevation), math.sin(azimuth) * math.cos(elevation), math.sin(elevation)))
    right = Vector((-math.sin(azimuth), math.cos(azimuth), 0))
    up = toward.cross(right)
    drop = radius * math.sin(elevation) * MARGIN
    centre = Vector(base) + up * (size / 2 - drop)
    rotation = Matrix((right, up, toward)).transposed()
    camera.matrix_world = Matrix.Translation(centre + toward * 200) @ rotation.to_4x4()
    return camera, np.array(right), np.array(up), np.array(toward), drop / size


def read_layers(path):
    source = oiio.ImageInput.open(str(path))
    layers = {}
    part = 0
    while source.seek_subimage(part, 0):
        spec = source.spec()
        name = spec.getattribute("name").split(".")[-1]
        layers[name] = np.array(source.read_image(part, 0, 0, spec.nchannels, oiio.FLOAT))
        part += 1
    source.close()
    return layers["Combined"], layers["Diffuse Color"], layers["Normal"], layers["Depth"][..., 0]


def bake(model, out, pixels, only):
    scene = reset()
    meshes, base, height, radius = load_tree(model, only)
    sizes = frame_sizes(height, radius)
    scene.render.resolution_x = pixels
    scene.render.resolution_y = pixels
    scene.render.image_settings.media_type = "MULTI_LAYER_IMAGE"
    scene.render.image_settings.file_format = "OPEN_EXR_MULTILAYER"
    scene.render.image_settings.color_depth = "32"
    colour = np.zeros((ROWS * pixels, COLUMNS * pixels, 4), np.float32)
    shape = np.zeros((ROWS * pixels, COLUMNS * pixels, 4), np.float32)
    drops = []
    scratch = out.parent / f"{out.name}-frame.exr"
    for ring, elevation in enumerate(RINGS):
        size = sizes[ring]
        for step in range(AZIMUTHS):
            azimuth = step * 2 * math.pi / AZIMUTHS
            camera, right, up, toward, drop = camera_for(scene, base, size, azimuth, elevation, radius)
            scene.render.filepath = str(scratch)
            bpy.ops.render.render(write_still=True)
            combined, albedo, normal, depth = read_layers(scratch)
            bpy.data.objects.remove(camera)
            alpha = np.clip(combined[..., 3], 0, 1)
            lit = combined[..., :3] / np.maximum(alpha[..., None], 1e-4)
            grey = lambda c: c @ np.array([0.2126, 0.7152, 0.0722], np.float32)
            occlusion = np.clip(grey(lit) / np.maximum(grey(albedo), 1e-4), 0, 1)
            shade = np.clip(OCCLUSION_FLOOR + (1 - OCCLUSION_FLOOR) * occlusion * OCCLUSION_GAIN, 0, 1)
            frame = np.concatenate([np.clip(albedo * shade[..., None], 0, 1), (alpha**COVERAGE_GAMMA)[..., None]], -1)
            local = np.stack([normal @ right, normal @ up, normal @ toward], -1)
            local[..., 2] = np.abs(local[..., 2])
            near = (200 - depth) / size
            covered = alpha > 0.05
            thickness = np.where(covered, np.clip(near + 0.5, 0, 1), 0.5)
            form = np.concatenate([local * 0.5 + 0.5, thickness[..., None]], -1)
            form[~covered, :3] = (0.5, 0.5, 1.0)
            index = ring * AZIMUTHS + step
            row, column = divmod(index, COLUMNS)
            colour[row * pixels : (row + 1) * pixels, column * pixels : (column + 1) * pixels] = frame
            shape[row * pixels : (row + 1) * pixels, column * pixels : (column + 1) * pixels] = form
            drops.append(drop)
            print(f"{out.name} ring {ring} azimuth {step} cover {covered.mean():.3f}", flush=True)
    scratch.unlink(missing_ok=True)
    np.save(out.parent / f"{out.name}-colour.npy", colour)
    np.save(out.parent / f"{out.name}-shape.npy", shape)
    meta = {
        "columns": COLUMNS,
        "rows": ROWS,
        "azimuths": AZIMUTHS,
        "rings": [round(math.degrees(e), 2) for e in RINGS],
        "sizes": [round(size / height, 4) for size in sizes],
        "spread": round(radius / height, 4),
        "drops": [round(drops[0], 4), round(drops[AZIMUTHS], 4)],
    }
    (out.parent / f"{out.name}.json").write_text(json.dumps(meta) + "\n")
    print("meta", meta, "height", height, "radius", radius)


if __name__ == "__main__":
    arguments = sys.argv[sys.argv.index("--") + 1 :]
    bake(Path(arguments[0]), Path(arguments[1]), int(arguments[2]), arguments[3] if len(arguments) > 3 else "")
