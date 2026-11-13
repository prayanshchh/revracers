import math
import sys
from pathlib import Path

import bmesh
import bpy
import numpy as np
import OpenImageIO as oiio
from mathutils import Matrix, Vector

CELL = (192, 384)
GRID = (8, 8)
FRAME_HEIGHT = 2.0
SAMPLES = 96
SEED = 20261112
SKY = 0.62
SUN = 1.9
SUN_ELEVATION = math.radians(52)
SUN_ASIDE = math.radians(38)
SKIP = {"Female_Adult_06", "Female_Adult_10", "Female_Adult_16", "Male_Adult_15", "Male_Adult_19", "Male_Adult_21"}
SEATED = (
    ("sit_chair_idle_neutral_01", 0.2),
    ("sit_chair_idle_look_around", 0.35),
    ("sit_chair_idle_relaxed_01", 0.5),
    ("sit_chair_gestic_thoughtful", 0.45),
    ("sit_chair_idle_waiting_01", 0.3),
    ("sit_chair_breathe_01", 0.6),
    ("sit_chair_idle_look_around", 0.7),
    ("sit_chair_idle_neutral_01", 0.75),
)
STANDING = (
    ("idle_neutral_01", 0.3),
    ("idle_look_around_01", 0.4),
    ("idle_waiting_01", 0.5),
    ("claphands_01", 0.45),
    ("cheer_01", 0.1),
    ("idle_neutral_04", 0.6),
    ("cell_phone_textmessage", 0.5),
    ("wave_01", 0.3),
    ("idle_look_around_01", 0.75),
    ("cheer_01", 0.25),
    ("drink_idle", 0.4),
    ("cheer_01", 0.6),
    ("cheer_01", 0.4),
    ("idle_neutral_01", 0.8),
)
TORSO = ("Bip01 Spine", "Bip01 Spine1", "Bip01 Spine2", "Bip01 L Clavicle", "Bip01 R Clavicle", "Bip01 L UpperArm", "Bip01 R UpperArm", "Bip01 L Forearm", "Bip01 R Forearm")
FAN_SHARE = 0.62
SKIN_REACH = 0.11
SHIRT_LEVEL = 0.8
CAP_SHARE = 0.34
FACE = ("Eye", "Mouth", "Lip", "Brow", "Cheek", "Jaw", "Tongue", "Nose", "Masseter", "Caninus", "lip")


def setup():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    preferences = bpy.context.preferences.addons["cycles"].preferences
    preferences.compute_device_type = "METAL"
    preferences.get_devices()
    for device in preferences.devices:
        device.use = True
    scene.cycles.device = "GPU"
    scene.cycles.samples = SAMPLES
    scene.cycles.use_denoising = False
    scene.cycles.max_bounces = 2
    scene.render.film_transparent = True
    scene.render.resolution_x = CELL[0]
    scene.render.resolution_y = CELL[1]
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "None"
    scene.render.image_settings.media_type = "MULTI_LAYER_IMAGE"
    scene.render.image_settings.file_format = "OPEN_EXR_MULTILAYER"
    scene.render.image_settings.color_depth = "32"
    layer = scene.view_layers[0]
    layer.use_pass_diffuse_color = True
    for name in ("torso", "head"):
        mark = layer.aovs.add()
        mark.name = name
        mark.type = "VALUE"
    world = bpy.data.worlds.new("sky")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = (0.86, 0.93, 1.0, 1)
    world.node_tree.nodes["Background"].inputs[1].default_value = SKY
    scene.world = world
    lamp = bpy.data.lights.new("sun", "SUN")
    lamp.energy = SUN
    lamp.angle = math.radians(6)
    lamp.color = (1.0, 0.96, 0.9)
    sun = bpy.data.objects.new("sun", lamp)
    scene.collection.objects.link(sun)
    eye = bpy.data.cameras.new("eye")
    eye.type = "ORTHO"
    eye.ortho_scale = FRAME_HEIGHT
    camera = bpy.data.objects.new("eye", eye)
    scene.collection.objects.link(camera)
    scene.camera = camera
    return scene, camera, sun


def texture_for(folder, part):
    matches = sorted(folder.glob(f"*_{part}_color.tga"))
    return matches[0] if matches else None


def dress(mesh, folder):
    for material in mesh.data.materials:
        material.use_nodes = True
        nodes, links = material.node_tree.nodes, material.node_tree.links
        nodes.clear()
        part = "head" if material.name.endswith("_head") else ("opacity" if material.name.endswith("_opacity") else "body")
        output = nodes.new("ShaderNodeOutputMaterial")
        shader = nodes.new("ShaderNodeBsdfPrincipled")
        shader.inputs["Roughness"].default_value = 0.85
        shader.inputs["Specular IOR Level"].default_value = 0.2
        picture = texture_for(folder, part) or texture_for(folder, "body")
        image = nodes.new("ShaderNodeTexImage")
        image.image = bpy.data.images.load(str(picture), check_existing=True)
        links.new(image.outputs["Color"], shader.inputs["Base Color"])
        if part == "opacity" and texture_for(folder, part):
            links.new(image.outputs["Alpha"], shader.inputs["Alpha"])
        links.new(shader.outputs[0], output.inputs["Surface"])
        for name, value in (("torso", part == "body"), ("head", part == "head")):
            mark = nodes.new("ShaderNodeOutputAOV")
            mark.aov_name = name
            if name == "torso" and value:
                weight = nodes.new("ShaderNodeVertexColor")
                weight.layer_name = "torso"
                links.new(weight.outputs["Color"], mark.inputs["Value"])
            else:
                mark.inputs["Value"].default_value = 1.0 if value else 0.0


def torso_weights(mesh):
    groups = {group.index for group in mesh.vertex_groups if group.name in TORSO}
    weights = np.zeros(len(mesh.data.vertices), np.float32)
    for vertex in mesh.data.vertices:
        weights[vertex.index] = sum(member.weight for member in vertex.groups if member.group in groups)
    layer = mesh.data.color_attributes.new("torso", "FLOAT_COLOR", "POINT")
    solid = (weights > 0.5).astype(np.float32)
    layer.data.foreach_set("color", np.repeat(solid[:, None], 4, 1).ravel())


def load_avatar(folder):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.fbx(filepath=str(next(folder.glob("*.fbx"))))
    fresh = [item for item in bpy.data.objects if item not in before]
    armature = next(item for item in fresh if item.type == "ARMATURE")
    mesh = next(item for item in fresh if item.type == "MESH")
    dress(mesh, folder)
    torso_weights(mesh)
    return armature, mesh, fresh


def pose(armature, library, name, share):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.fbx(filepath=str(library / f"{name}.fbx"))
    fresh = [item for item in bpy.data.objects if item not in before]
    source = next(item for item in fresh if item.type == "ARMATURE")
    for bone in armature.pose.bones:
        if bone.name not in source.pose.bones or any(part in bone.name for part in FACE):
            continue
        follow = bone.constraints.new("COPY_ROTATION")
        follow.target = source
        follow.subtarget = bone.name
    hips = armature.pose.bones["Bip01 Pelvis"].constraints.new("COPY_LOCATION")
    hips.target = source
    hips.subtarget = "Bip01 Pelvis"
    start, end = source.animation_data.action.frame_range
    bpy.context.scene.frame_set(int(start + (end - start) * share))
    bpy.context.view_layer.update()
    return fresh


def cap(armature, rng):
    head = armature.pose.bones.get("Bip01 Head")
    nose = armature.pose.bones.get("Bip01 MNose")
    if head is None or nose is None:
        return []
    world = armature.matrix_world
    forward = ((world @ head.tail) - (world @ head.head)).normalized()
    aside = forward.cross(Vector((0, 0, 1))).normalized()
    up = aside.cross(forward).normalized()
    turn = Matrix((forward, -aside, up)).transposed().to_euler()
    material = bpy.data.materials.new("cap")
    material.use_nodes = True
    nodes = material.node_tree.nodes
    shader = nodes["Principled BSDF"]
    tone = rng.uniform(0.6, 0.92)
    shader.inputs["Base Color"].default_value = (tone, tone, tone, 1)
    shader.inputs["Roughness"].default_value = 0.9
    for name, value in (("torso", 1.0), ("head", 0.0)):
        mark = nodes.new("ShaderNodeOutputAOV")
        mark.aov_name = name
        mark.inputs["Value"].default_value = value
    base = (world @ nose.head) - forward * 0.105 + up * 0.085
    bpy.ops.mesh.primitive_uv_sphere_add(segments=24, ring_count=12, radius=0.092, location=base, rotation=turn)
    dome = bpy.context.object
    shape = bmesh.new()
    shape.from_mesh(dome.data)
    bmesh.ops.delete(shape, geom=[vertex for vertex in shape.verts if vertex.co.z < -0.004], context="VERTS")
    shape.to_mesh(dome.data)
    shape.free()
    dome.scale = (1.1, 0.95, 0.8)
    bpy.ops.mesh.primitive_cylinder_add(vertices=24, radius=0.062, depth=0.01, location=base + forward * 0.11 - up * 0.004, rotation=turn)
    brim = bpy.context.object
    brim.scale = (1.25, 1.0, 1.0)
    for part in (dome, brim):
        part.data.materials.append(material)
    return [dome, brim]


def read_layers(path):
    source = oiio.ImageInput.open(str(path))
    layers = {}
    part = 0
    while source.seek_subimage(part, 0):
        spec = source.spec()
        layers[spec.getattribute("name").split(".")[-1]] = np.array(source.read_image(part, 0, 0, spec.nchannels, oiio.FLOAT))
        part += 1
    source.close()
    return layers


def srgb(linear):
    return np.where(linear <= 0.0031308, linear * 12.92, 1.055 * np.power(np.maximum(linear, 1e-9), 1 / 2.4) - 0.055)


def bleed(frame, rounds=12):
    alpha = frame[..., 3] > 0.05
    colour = frame[..., :3] * alpha[..., None]
    weight = alpha.astype(np.float32)
    for _ in range(rounds):
        total = np.zeros_like(colour)
        count = np.zeros_like(weight)
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            total += np.roll(colour * weight[..., None], (dy, dx), (0, 1))
            count += np.roll(weight, (dy, dx), (0, 1))
        grow = (weight == 0) & (count > 0)
        colour[grow] = total[grow] / count[grow][..., None]
        weight[grow] = 1.0
    out = frame.copy()
    out[..., :3][~alpha] = colour[~alpha]
    return out


def extent(objects):
    graph = bpy.context.evaluated_depsgraph_get()
    low = np.array([math.inf] * 3)
    high = -low
    for item in objects:
        if item.type != "MESH":
            continue
        shown = item.evaluated_get(graph)
        data = shown.to_mesh()
        points = np.empty(len(data.vertices) * 3, np.float32)
        data.vertices.foreach_get("co", points)
        world = np.array(shown.matrix_world)
        points = points.reshape(-1, 3) @ world[:3, :3].T + world[:3, 3]
        low = np.minimum(low, points.min(0))
        high = np.maximum(high, points.max(0))
        shown.to_mesh_clear()
    return low, high


def shoot(scene, camera, sun, objects, turn, lift, scratch):
    low, high = extent(objects)
    centre = Vector(((low[0] + high[0]) / 2, (low[1] + high[1]) / 2, low[2] + FRAME_HEIGHT / 2))
    facing = Vector((math.sin(turn), -math.cos(turn), math.tan(lift)))
    eye = centre + facing.normalized() * 6
    camera.location = eye
    camera.rotation_euler = (centre - eye).to_track_quat("-Z", "Y").to_euler()
    around = turn - SUN_ASIDE
    toward_sun = Vector((math.sin(around) * math.cos(SUN_ELEVATION), -math.cos(around) * math.cos(SUN_ELEVATION), math.sin(SUN_ELEVATION)))
    sun.rotation_euler = toward_sun.to_track_quat("Z", "Y").to_euler()
    scene.render.filepath = str(scratch)
    bpy.ops.render.render(write_still=True)
    return read_layers(scratch)


def sprite(layers, fan):
    combined = layers["Combined"]
    alpha = np.clip(combined[..., 3], 0, 1)
    colour = combined[..., :3] / np.maximum(alpha[..., None], 1e-4)
    albedo = layers["Diffuse Color"][..., :3]
    torso = layers["torso"][..., 0] > 0.5
    head = layers["head"][..., 0] > 0.5
    solid = alpha > 0.6
    mask = np.zeros(alpha.shape, np.float32)
    if fan and (head & solid).sum() > 20:
        skin = np.median(albedo[head & solid], 0)
        chroma = lambda c: c / np.maximum(c.sum(-1, keepdims=True), 1e-4)
        apart = np.linalg.norm(chroma(albedo) - chroma(skin), axis=-1) + np.abs(albedo.mean(-1) - skin.mean()) * 0.35
        cloth = torso & solid & (apart > SKIN_REACH)
        if cloth.sum() > 40:
            grey = colour @ np.array([0.2126, 0.7152, 0.0722], np.float32)
            level = np.percentile(grey[cloth], 70)
            shirt = np.clip(grey / max(level, 1e-3) * SHIRT_LEVEL, 0, 1)
            colour = np.where(cloth[..., None], shirt[..., None], colour)
            mask = cloth.astype(np.float32)
    frame = np.concatenate([np.clip(srgb(np.clip(colour, 0, 1)), 0, 1), alpha[..., None]], -1)
    return bleed(frame), mask


def main():
    arguments = sys.argv[sys.argv.index("--") + 1 :]
    source, out = Path(arguments[0]), Path(arguments[1])
    out.mkdir(parents=True, exist_ok=True)
    only = [int(value) for value in arguments[2:]]
    avatars = sorted(folder for folder in (source / "avatars").iterdir() if folder.is_dir() and folder.name not in SKIP and texture_for(folder, "body"))
    rng = np.random.default_rng(SEED)
    columns, rows = GRID
    rounds = math.ceil(columns * rows / len(avatars))
    order = np.concatenate([rng.permutation(len(avatars)) for _ in range(rounds)])
    atlas = np.zeros((CELL[1] * rows, CELL[0] * columns, 4), np.float32)
    masks = np.zeros((CELL[1] * rows, CELL[0] * columns), np.float32)
    scratch = out / "person.exr"
    for index in range(columns * rows):
        folder = avatars[order[index]]
        seated = index < columns * rows // 2
        poses = SEATED if seated else STANDING
        name, share = poses[int(rng.integers(len(poses)))]
        turn = rng.uniform(-0.6, 0.6)
        lift = rng.uniform(-0.02, 0.1)
        fan = rng.random() < FAN_SHARE
        capped = rng.random() < CAP_SHARE
        if only and index not in only:
            continue
        scene, camera, sun = setup()
        armature, mesh, parts = load_avatar(folder)
        prefix = "f_" if folder.name.startswith("Female") else "m_"
        pose(armature, source / "anims", prefix + name, share)
        bpy.context.view_layer.update()
        shown = [mesh]
        if capped:
            shown.extend(cap(armature, rng))
        frame, mask = sprite(shoot(scene, camera, sun, shown, turn, lift, scratch), fan)
        row, column = divmod(index, columns)
        window = (slice(row * CELL[1], (row + 1) * CELL[1]), slice(column * CELL[0], (column + 1) * CELL[0]))
        atlas[window] = frame
        masks[window] = mask
        print(f"sprite {index} {folder.name} {name} fan {fan} cap {capped} cover {(frame[..., 3] > 0.5).mean():.3f}", flush=True)
    scratch.unlink(missing_ok=True)
    np.save(out / "people.npy", atlas)
    np.save(out / "people-mask.npy", masks)


if __name__ == "__main__":
    main()
