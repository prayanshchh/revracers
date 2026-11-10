import hashlib
import json
import math
import sys
from pathlib import Path

import bmesh
import bpy
from mathutils import Matrix, Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))
from crew import apply_pose, character, copy_object, hair_for, keep_vertices, primitive, project_uvs, stand, tailor
from materials import flat_material

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "content" / "tracks" / "hill-country" / "source" / "crew"
TEAMS = json.loads((ROOT / "content" / "cars" / "teams.json").read_text())
SIZE = (600, 760)
SAMPLES = 96
WRIST = 0.6
NECK = 1.5
COLLAR = 0.075
SHOULDER = 1.57
OVERLAP = 0.012
GAP = 0.004
HEAD = Vector((0.0, 0.004, 1.7))
WELD = 1e-4
CAMERA_DISTANCE = 4.6
CAMERA_HEIGHT = 1.42
AIM_HEIGHT = 1.33
LENS = 92
TURNS = (-22, 18, -14)
SEATS = ("0", "1", "player")
SKINS = (("Ligh", (1.0, 0.97, 0.94)), ("Ligh", (0.86, 0.76, 0.68)), ("Ligh", (0.95, 0.86, 0.8)), ("Dark", (1.0, 1.0, 1.0)), ("Dark", (1.18, 1.1, 1.04)))
HAIR = ((0.16, 0.11, 0.08), (0.05, 0.04, 0.035), (0.32, 0.22, 0.13), (0.55, 0.42, 0.25), (0.1, 0.07, 0.05))
CAP_SHARE = 0.7
CAP_CENTRE = Vector((0.0, 0.008, 1.7))
CAP_EDGE = Vector((0.0, -0.09, 1.748))
CAP_NORMAL = Vector((0.0, 0.2526, 1.0))
CAP_SCALE = 1.12
CAP_LIFT = 0.014
CAP_PEAK = 0.008
CAP_THICKNESS = 0.004
BRIM_SEGMENTS = 24
BRIM_ROWS = 6
BRIM_SPAN = math.radians(78)
BRIM_REACH = 0.075
BRIM_TUCK = 0.01
BRIM_RAISE = 0.004
BRIM_TILT = math.radians(14)
BRIM_BEND = 2.4
BRIM_THICKNESS = 0.005
BRIM_SHADE = 0.8

POSES = {
    "folded": stand(lean=1, **{"hand.L": (0.18, -0.06, 1.26), "hand.R": (0.18, 0.06, 1.22), "elbow.L": (-0.2, 1, -0.4), "elbow.R": (-0.2, -1, -0.4)}),
    "hips": stand(lean=-2, **{"hand.L": (0.03, 0.22, 1.06), "hand.R": (0.03, -0.22, 1.06), "elbow.L": (-0.4, 1, 0), "elbow.R": (-0.4, -1, 0)}),
    "chin": stand(
        lean=3,
        **{
            "hand.R": (0.12, 0.0, 1.43),
            "grip.R": (0.2, 0.22, 1.0),
            "elbow.R": (0.1, -1, -0.8),
            "hand.L": (0.2, -0.12, 1.2),
            "grip.L": (0.1, -1, 0.15),
            "elbow.L": (-0.1, 1, -0.6),
        },
    ),
    "wrist": stand(
        lean=4,
        **{
            "hand.L": (0.22, 0.05, 1.08),
            "grip.L": (0.3, -1, 0.1),
            "elbow.L": (-0.3, 1, -0.3),
            "hand.R": (0.25, -0.05, 1.12),
            "grip.R": (0.4, 0.9, 0.2),
            "elbow.R": (-0.3, -1, -0.3),
        },
    ),
}


def weld(obj):
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=WELD)
    bm.to_mesh(obj.data)
    bm.free()


def in_suit(co, margin):
    if abs(co.x) >= WRIST + margin:
        return False
    return co.z < NECK + margin or (abs(co.x) > COLLAR - margin and co.z < SHOULDER + margin)


def pick(seed, options):
    return options[seed % len(options)]


def seed_of(text):
    return int(hashlib.sha256(text.encode()).hexdigest()[:8], 16)


def suit_material(team):
    mat = bpy.data.materials.new(f"suit {team['id']}")
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    bsdf = nodes["Principled BSDF"]
    image = nodes.new("ShaderNodeTexImage")
    image.image = bpy.data.images.load(str(ROOT / "build" / "portraits" / "suits" / f"{team['id']}.png"))
    links.new(image.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 0.62
    bsdf.inputs["Sheen Weight"].default_value = 0.35
    return mat


def tinted(mat, tint, image_path=None):
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    bsdf = next(n for n in nodes if n.type == "BSDF_PRINCIPLED")
    if not bsdf.inputs["Base Color"].links:
        return
    if image_path is not None:
        for node in nodes:
            if node.type == "TEX_IMAGE" and node.image and "Superhero" in node.image.name and "Normal" not in node.image.name and "Rough" not in node.image.name:
                node.image = bpy.data.images.load(str(image_path))
    feed = bsdf.inputs["Base Color"].links[0].from_socket
    mix = nodes.new("ShaderNodeMix")
    mix.data_type = "RGBA"
    mix.blend_type = "MULTIPLY"
    mix.inputs["Factor"].default_value = 1.0
    mix.inputs["B"].default_value = (*tint, 1.0)
    links.new(feed, mix.inputs["A"])
    links.new(mix.outputs["Result"], bsdf.inputs["Base Color"])


def colour(hex_code):
    return [(int(hex_code[i : i + 2], 16) / 255) ** 2.2 for i in (1, 3, 5)]


def solid(obj, thickness, smooth_levels):
    if smooth_levels:
        modifier = obj.modifiers.new("smooth", "SUBSURF")
        modifier.levels = modifier.render_levels = smooth_levels
    modifier = obj.modifiers.new("thick", "SOLIDIFY")
    modifier.thickness = thickness
    modifier.offset = -1.0
    for polygon in obj.data.polygons:
        polygon.use_smooth = True


def make_crown(body):
    crown = copy_object(body, "cap crown")
    bm = bmesh.new()
    bm.from_mesh(crown.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=WELD)
    bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], plane_co=CAP_EDGE, plane_no=CAP_NORMAL, clear_inner=True)
    top = max(v.co.z for v in bm.verts)
    for v in bm.verts:
        height = (v.co - CAP_EDGE).dot(CAP_NORMAL.normalized())
        rise = min(1.0, max(0.0, height / (top - CAP_EDGE.z)))
        v.co = CAP_CENTRE + (v.co - CAP_CENTRE) * CAP_SCALE + Vector((0.0, -CAP_PEAK * rise * max(0.0, -v.co.y) / 0.1, CAP_LIFT * rise * rise))
    rim = [v.co.copy() for v in bm.verts if v.is_boundary]
    bm.to_mesh(crown.data)
    bm.free()
    return crown, rim


def make_brim(rim):
    front = [co for co in rim if co.y < CAP_CENTRE.y]
    reach_x = max(abs(co.x) for co in front)
    reach_y = CAP_CENTRE.y - min(co.y for co in front)
    bm = bmesh.new()
    rows = []
    for i in range(BRIM_SEGMENTS + 1):
        angle = BRIM_SPAN * (2 * i / BRIM_SEGMENTS - 1)
        inner = Vector((reach_x * math.sin(angle), CAP_CENTRE.y - reach_y * math.cos(angle), 0.0))
        outward = Vector((math.sin(angle) / reach_x, -math.cos(angle) / reach_y, 0.0)).normalized()
        reach = BRIM_REACH * math.cos(0.5 * math.pi * abs(angle) / BRIM_SPAN) ** 0.6
        base = CAP_EDGE.z - (inner.y - CAP_EDGE.y) * CAP_NORMAL.y / CAP_NORMAL.z + BRIM_RAISE
        row = []
        for j in range(BRIM_ROWS + 1):
            t = j / BRIM_ROWS
            point = inner - outward * BRIM_TUCK + outward * (reach + BRIM_TUCK) * t
            point.z = base - t * reach * math.tan(BRIM_TILT) - t * BRIM_BEND * point.x * point.x
            row.append(bm.verts.new(point))
        rows.append(row)
    for a, b in zip(rows, rows[1:]):
        for j in range(BRIM_ROWS):
            bm.faces.new((a[j], a[j + 1], b[j + 1], b[j]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    data = bpy.data.meshes.new("cap brim")
    bm.to_mesh(data)
    bm.free()
    brim = bpy.data.objects.new("cap brim", data)
    bpy.context.scene.collection.objects.link(brim)
    return brim


def make_cap(team, body, arm):
    crown, rim = make_crown(body)
    crown.data.materials.clear()
    crown.data.materials.append(flat_material("cap crown", colour(team["colours"]["primary"]), 0.0, 0.7))
    solid(crown, CAP_THICKNESS, 1)
    brim = make_brim(rim)
    brim.data.materials.append(flat_material("cap brim", [c * BRIM_SHADE for c in colour(team["colours"]["primary"])], 0.0, 0.6))
    rig_to_head(brim, arm)
    solid(brim, BRIM_THICKNESS, 1)
    return crown, brim


def rig_to_head(obj, arm):
    group = obj.vertex_groups.new(name="Head")
    group.add(list(range(len(obj.data.vertices))), 1.0, "REPLACE")
    obj.parent = arm
    modifier = obj.modifiers.new("rig", "ARMATURE")
    modifier.object = arm


def driver(team, seat):
    seed = seed_of(f"{team['id']}:{seat}")
    parts = character(SOURCE, "Male")
    arm, body = parts["arm"], parts["body"]
    cloth = copy_object(body, "suit")
    weld(cloth)
    tailor(cloth, arm)
    keep_vertices(cloth, lambda co: in_suit(co, OVERLAP))
    project_uvs(cloth.data)
    cloth.data.materials.clear()
    cloth.data.materials.append(suit_material(team))
    keep_vertices(body, lambda co: not in_suit(co, -GAP))
    texture, skin_tint = pick(seed >> 3, SKINS)
    skin = body.data.materials[0].copy()
    body.data.materials[0] = skin
    tinted(skin, skin_tint, SOURCE / f"T_Superhero_Male_{texture}.png")
    hair = hair_for(SOURCE, "Hair_Buzzed", arm)
    hair_mat = hair.data.materials[0].copy()
    hair.data.materials[0] = hair_mat
    tinted(hair_mat, pick(seed >> 7, HAIR))
    if parts["brows"]:
        brows = parts["brows"].data.materials[0].copy()
        parts["brows"].data.materials[0] = brows
        tinted(brows, pick(seed >> 7, HAIR))
    if (seed >> 11) % 100 < CAP_SHARE * 100:
        make_cap(team, body, arm)
    pose = pick(seed >> 13, list(POSES))
    arm.animation_data_create()
    arm.animation_data.action = bpy.data.actions.new(f"pose {pose}")
    apply_pose(arm, POSES[pose], 0)
    bpy.context.scene.frame_set(0)
    arm.rotation_euler = (0, 0, math.radians(TURNS[SEATS.index(seat)]))
    return pose


def studio(team):
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "GPU"
    scene.cycles.samples = SAMPLES
    scene.cycles.use_denoising = True
    scene.render.film_transparent = True
    scene.render.resolution_x, scene.render.resolution_y = SIZE
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "None"
    scene.view_settings.exposure = 0.0
    world = bpy.data.worlds.new("studio")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = (0.05, 0.045, 0.07, 1.0)
    world.node_tree.nodes["Background"].inputs[1].default_value = 1.0
    scene.world = world
    brand = [int(team["brand"][i : i + 2], 16) / 255 for i in (1, 3, 5)]
    lights = (
        ("key", (-1.8, -3.0, 2.6), 520, (1.0, 0.96, 0.92), 1.6),
        ("fill", (2.4, -2.6, 1.6), 140, (0.85, 0.88, 1.0), 2.0),
        ("rim left", (-1.8, 1.6, 2.2), 380, tuple(0.55 + 0.45 * c for c in brand), 0.8),
        ("rim right", (1.9, 1.7, 2.1), 330, (0.8, 0.85, 1.0), 0.8),
    )
    for name, location, power, colour, size in lights:
        light = bpy.data.lights.new(name, "AREA")
        light.energy = power
        light.color = colour
        light.size = size
        obj = bpy.data.objects.new(name, light)
        obj.location = location
        direction = Vector((0, 0, 1.35)) - Vector(location)
        obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
        scene.collection.objects.link(obj)
    camera = bpy.data.cameras.new("portrait")
    camera.lens = LENS
    camera.sensor_fit = "VERTICAL"
    cam = bpy.data.objects.new("portrait", camera)
    cam.location = (0.0, -CAMERA_DISTANCE, CAMERA_HEIGHT)
    direction = Vector((0, 0, AIM_HEIGHT)) - cam.location
    cam.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    scene.collection.objects.link(cam)
    scene.camera = cam


def render(team, seat, path):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    preferences = bpy.context.preferences.addons["cycles"].preferences
    preferences.compute_device_type = "METAL"
    preferences.get_devices()
    for device in preferences.devices:
        device.use = True
    pose = driver(team, seat)
    studio(team)
    bpy.context.scene.render.filepath = str(path)
    bpy.ops.render.render(write_still=True)
    return pose


def main():
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    out = Path(argv[0] if argv else ROOT / "build" / "portraits" / "renders")
    only = set(argv[1].split(",")) if len(argv) > 1 else None
    out.mkdir(parents=True, exist_ok=True)
    for team in TEAMS:
        for seat in SEATS:
            name = f"{team['id']}-{seat}"
            if only and name not in only:
                continue
            pose = render(team, seat, out / f"{name}.png")
            print(f"portrait {name} {pose}")


if __name__ == "__main__":
    main()
