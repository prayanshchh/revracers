import bpy
import numpy as np


def material(name, translucent):
    result = bpy.data.materials.new(name)
    result.use_nodes = True
    result.use_backface_culling = False
    nodes, links = result.node_tree.nodes, result.node_tree.links
    shader = nodes["Principled BSDF"]
    colour = nodes.new("ShaderNodeVertexColor")
    colour.layer_name = "colour"
    links.new(colour.outputs["Color"], shader.inputs["Base Color"])
    shader.inputs["Roughness"].default_value = 0.6 if translucent else 0.9
    shader.inputs["Metallic"].default_value = 0
    if translucent:
        through = nodes.new("ShaderNodeBsdfTranslucent")
        links.new(colour.outputs["Color"], through.inputs["Color"])
        amount = nodes.new("ShaderNodeValue")
        amount.name = "translucency"
        amount.outputs[0].default_value = 0
        blend = nodes.new("ShaderNodeMixShader")
        links.new(amount.outputs[0], blend.inputs[0])
        links.new(shader.outputs[0], blend.inputs[1])
        links.new(through.outputs[0], blend.inputs[2])
        links.new(blend.outputs[0], nodes["Material Output"].inputs["Surface"])
    return result


def mesh(name, vertices, faces, colours, translucent):
    data = bpy.data.meshes.new(name)
    corners = faces.reshape(-1)
    data.vertices.add(len(vertices))
    data.vertices.foreach_set("co", vertices.reshape(-1))
    data.loops.add(len(corners))
    data.loops.foreach_set("vertex_index", corners)
    data.polygons.add(len(faces))
    data.polygons.foreach_set("loop_start", np.arange(len(faces)) * 4)
    data.polygons.foreach_set("loop_total", np.full(len(faces), 4))
    data.update()
    data.validate()
    layer = data.color_attributes.new("colour", "FLOAT_COLOR", "POINT")
    rgba = np.concatenate([colours, np.ones((len(colours), 1), np.float32)], 1)
    layer.data.foreach_set("color", rgba.reshape(-1))
    data.materials.append(material(name, translucent))
    if not translucent:
        data.polygons.foreach_set("use_smooth", np.ones(len(faces), bool))
    item = bpy.data.objects.new(name, data)
    bpy.context.scene.collection.objects.link(item)
    return item


def load(path):
    grown = np.load(path)
    wood = mesh("wood", grown["wood_vertices"], grown["wood_faces"], grown["wood_colours"], False)
    leaves = mesh("leaves", grown["leaf_vertices"], grown["leaf_faces"], grown["leaf_colours"], True)
    return [wood, leaves]
