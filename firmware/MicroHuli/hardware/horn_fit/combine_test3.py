#!/usr/bin/env python3
"""Package Test3 plus three current legs and shoes without rescaling meshes."""
from collections import Counter
from copy import deepcopy
from pathlib import Path
from xml.etree import ElementTree as ET
from zipfile import ZIP_DEFLATED, ZipFile

ROOT = Path(__file__).resolve().parent
NS = "http://schemas.microsoft.com/3dmanufacturing/core/2015/02"
ET.register_namespace("", NS)


def tag(name):
    return f"{{{NS}}}{name}"


def transform(x, y, z=0):
    return f"1 0 0 0 1 0 0 0 1 {x:.9f} {y:.9f} {z:.9f}"


def check_mesh(mesh):
    vertices = list(mesh.find(tag("vertices")))
    edges = Counter()
    for t in mesh.find(tag("triangles")):
        a, b, c = (int(t.attrib[k]) for k in ("v1", "v2", "v3"))
        assert min(a, b, c) >= 0 and max(a, b, c) < len(vertices)
        for e in ((a, b), (b, c), (c, a)):
            edges[tuple(sorted(e))] += 1
    assert all(count == 2 for count in edges.values()), "Mesh is not closed"


def stl_mesh(path):
    mesh = ET.Element(tag("mesh"))
    vertices = ET.SubElement(mesh, tag("vertices"))
    triangles = ET.SubElement(mesh, tag("triangles"))
    indices, face = {}, []
    for line in path.read_text().splitlines():
        words = line.split()
        if not words or words[0] != "vertex":
            continue
        point = tuple(float(v) for v in words[1:])
        if point not in indices:
            indices[point] = len(indices)
            ET.SubElement(vertices, tag("vertex"), dict(zip(
                ("x", "y", "z"), (repr(v) for v in point))))
        face.append(indices[point])
        if len(face) == 3:
            ET.SubElement(triangles, tag("triangle"), dict(zip(
                ("v1", "v2", "v3"), map(str, face))))
            face = []
    assert not face
    check_mesh(mesh)
    return mesh


with ZipFile(ROOT / "inputs/Test3.3mf") as source:
    original = ET.fromstring(source.read("3D/3dmodel.model"))
assert original.get("unit") == "millimeter"
source_objects = original.findall(f"{tag('resources')}/{tag('object')}")
source_build = original.find(tag("build"))
assert len(source_objects) == 4 and len(source_build) == 4
assert all(not item.get("transform") for item in source_build)

model = ET.Element(tag("model"), {"unit": "millimeter"})
ET.SubElement(model, tag("metadata"), {"name": "Title"}).text = (
    "Test3 + 3 MicroHuli legs (long horn recess) + 3 shoes")
resources = ET.SubElement(model, tag("resources"))
build = ET.SubElement(model, tag("build"))
source_points = []
for obj in source_objects:
    mesh = obj.find(tag("mesh"))
    check_mesh(mesh)
    copied = ET.SubElement(resources, tag("object"), {
        "id": obj.get("id"), "name": "Test3_" + obj.get("name"), "type": "model"})
    copied.append(deepcopy(mesh))
    source_points.extend(tuple(float(v.get(a)) for a in ("x", "y", "z"))
                         for v in mesh.find(tag("vertices")))

# Retain all original internal offsets, including the raised hinge body.
assembly = ET.SubElement(resources, tag("object"), {
    "id": "5", "name": "Test3_original_arrangement", "type": "model"})
components = ET.SubElement(assembly, tag("components"))
for item in source_build:
    ET.SubElement(components, tag("component"), {"objectid": item.get("objectid")})
minimum = [min(p[i] for p in source_points) for i in range(3)]
ET.SubElement(build, tag("item"), {"objectid": "5", "transform": transform(
    5 - minimum[0], 60 - minimum[1], -minimum[2])})

for object_id, name, path in [
    ("6", "MicroHuli_long_horn_recess_leg", ROOT / "exports/leg_larger_horn_mount.stl"),
    ("7", "MicroHuli_separate_rocker_shoe", ROOT.parent / "feet/exports/rocker_shoe_single.stl"),
]:
    obj = ET.SubElement(resources, tag("object"), {
        "id": object_id, "name": name, "type": "model"})
    obj.append(stl_mesh(path))

for x in (5, 50, 95):
    ET.SubElement(build, tag("item"), {"objectid": "6", "transform": transform(x, 5)})
    ET.SubElement(build, tag("item"), {"objectid": "7", "transform": transform(x + 30, 13)})

output = ROOT / "exports/Test3_with_3_legs_and_shoes.3mf"
with ZipFile(output, "w", ZIP_DEFLATED) as archive:
    archive.writestr("3D/3dmodel.model", ET.tostring(model, encoding="utf-8", xml_declaration=True))
    archive.writestr("[Content_Types].xml", '''<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>
</Types>''')
    archive.writestr("_rels/.rels", '''<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel" Target="/3D/3dmodel.model"/>
</Relationships>''')
print(output)
print("Preserved all four Test3 meshes and added three leg and three shoe instances.")
