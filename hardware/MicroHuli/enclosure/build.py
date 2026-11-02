#!/usr/bin/env python3
"""Export default MicroHuli enclosure, validate meshes, and package a geometry 3MF.

Only Python's standard library and OpenSCAD are required. Exports are ignored;
editable cover.scad is the source of truth. No slicing or printer upload occurs.
"""
import argparse
from collections import Counter, defaultdict
import json
from pathlib import Path
import shutil
import struct
import subprocess
from xml.etree import ElementTree as ET
from zipfile import ZipFile, ZIP_DEFLATED
from check_fasteners import main as check_fasteners

ROOT = Path(__file__).resolve().parent
PARTS = ("adapter", "tub", "tray", "lid")
PLATE = {"tub": (36, 46), "adapter": (120, 46), "lid": (36, 150), "tray": (117, 133)}
NS = "http://schemas.microsoft.com/3dmanufacturing/core/2015/02"


def mesh(path):
    data = path.read_bytes()
    count = struct.unpack_from("<I", data, 80)[0]
    if len(data) != 84 + 50 * count:
        raise ValueError(f"Not a binary STL: {path.name}")
    vertices, indices, faces = [], {}, []
    for i in range(count):
        face = []
        for j in range(3):
            p = struct.unpack_from("<3f", data, 84 + 50 * i + 12 + 12 * j)
            key = tuple(round(v, 5) for v in p)
            if key not in indices:
                indices[key] = len(vertices)
                vertices.append(p)
            face.append(indices[key])
        if len(set(face)) != 3:
            raise ValueError(f"Degenerate triangle: {path.name}")
        faces.append(face)
    edges, direction = Counter(), Counter()
    neighbours = defaultdict(set)
    volume = 0
    for a, b, c in faces:
        p, q, r = (vertices[k] for k in (a, b, c))
        volume += (p[0] * (q[1]*r[2]-q[2]*r[1]) + p[1] * (q[2]*r[0]-q[0]*r[2]) + p[2] * (q[0]*r[1]-q[1]*r[0])) / 6
        for u, v in ((a, b), (b, c), (c, a)):
            edge = tuple(sorted((u, v)))
            edges[edge] += 1
            direction[edge] += 1 if u < v else -1
            neighbours[u].add(v)
            neighbours[v].add(u)
    if not edges or any(n != 2 for n in edges.values()) or any(direction.values()):
        raise ValueError(f"Mesh is not closed and consistently wound: {path.name}")
    seen, todo = set(), [0]
    while todo:
        u = todo.pop()
        if u not in seen:
            seen.add(u)
            todo.extend(neighbours[u] - seen)
    if len(seen) != len(vertices) or volume <= 0:
        raise ValueError(f"Disconnected or inverted mesh: {path.name}")
    bounds = [[min(p[a] for p in vertices), max(p[a] for p in vertices)] for a in range(3)]
    if abs(bounds[2][0]) > 0.001:
        raise ValueError(f"Part is not on the bed: {path.name}")
    return vertices, faces, {
        "triangles": len(faces), "closed": True, "connected_components": 1,
        "volume_mm3": round(volume, 2),
        "bounds_mm": [[round(x, 4) for x in b] for b in bounds],
        "size_mm": [round(b[1]-b[0], 4) for b in bounds],
    }


def package(meshes, path):
    ET.register_namespace("", NS)
    tag = lambda name: f"{{{NS}}}{name}"
    model = ET.Element(tag("model"), {"unit": "millimeter", "xml:lang": "en-US"})
    resources = ET.SubElement(model, tag("resources"))
    build = ET.SubElement(model, tag("build"))
    for ident, name in enumerate(PARTS, 1):
        vertices, faces, _ = meshes[name]
        obj = ET.SubElement(resources, tag("object"), {"id": str(ident), "name": f"MicroHuli_{name}", "type": "model"})
        m = ET.SubElement(obj, tag("mesh"))
        vv, ff = ET.SubElement(m, tag("vertices")), ET.SubElement(m, tag("triangles"))
        for p in vertices:
            ET.SubElement(vv, tag("vertex"), dict(zip(("x", "y", "z"), (f"{v:.9g}" for v in p))))
        for f in faces:
            ET.SubElement(ff, tag("triangle"), dict(zip(("v1", "v2", "v3"), map(str, f))))
        x, y = PLATE[name]
        ET.SubElement(build, tag("item"), {"objectid": str(ident), "transform": f"1 0 0 0 1 0 0 0 1 {x} {y} 0"})
    with ZipFile(path, "w", ZIP_DEFLATED) as z:
        z.writestr("3D/3dmodel.model", ET.tostring(model, encoding="utf-8", xml_declaration=True))
        z.writestr("[Content_Types].xml", '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>')
        z.writestr("_rels/.rels", '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel" Target="/3D/3dmodel.model"/></Relationships>')


def plate_extent(meshes):
    boxes = {}
    for name, (_, _, report) in meshes.items():
        x, y = PLATE[name]
        bounds = report["bounds_mm"]
        boxes[name] = (bounds[0][0]+x, bounds[1][0]+y, bounds[0][1]+x, bounds[1][1]+y)
        if boxes[name][0] < 0 or boxes[name][1] < 0:
            raise ValueError(f"Part extends outside plate origin: {name}")
    for i, name in enumerate(PARTS):
        a = boxes[name]
        for other in PARTS[i+1:]:
            b = boxes[other]
            if not (a[2] <= b[0] or b[2] <= a[0] or a[3] <= b[1] or b[3] <= a[1]):
                raise ValueError(f"Print-plate bounds overlap: {name}/{other}")
    return [round(max(b[2] for b in boxes.values()), 4), round(max(b[3] for b in boxes.values()), 4)]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=ROOT / "exports")
    parser.add_argument("--previews", action="store_true", help="Render CAD previews alongside the meshes")
    args = parser.parse_args()
    openscad = shutil.which("openscad")
    if not openscad:
        parser.error("Install OpenSCAD and put openscad on PATH")
    check_fasteners()
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    meshes = {}
    for name in PARTS:
        path = output / f"MicroHuli_{name}.stl"
        result = subprocess.run([openscad, "--export-format", "binstl", "-o", str(path), "-D", f'part="{name}"', str(ROOT / "cover.scad")], capture_output=True, text=True, check=True, timeout=120)
        if "WARNING:" in result.stderr or "ERROR:" in result.stderr:
            raise RuntimeError(result.stderr)
        meshes[name] = mesh(path)
        print(f"PASS {name}: {meshes[name][2]}")
    report = {"parts": {name: m[2] for name, m in meshes.items()}, "plate_extent_mm": plate_extent(meshes), "qualification": "CAD only; no slicing or physical fit established"}
    (output / "geometry_report.json").write_text(json.dumps(report, indent=2) + "\n")
    package(meshes, output / "MicroHuli_cover_plate.3mf")
    if args.previews:
        for name in ("assembly", "inside", "plate"):
            subprocess.run([openscad, "--render", "-o", str(output / f"{name}.png"), "--imgsize=1400,1200", "--colorscheme=Tomorrow", "--camera=160,-190,135,0,0,40", "--viewall", "--autocenter", "--projection=o", "-D", f'part="{name}"', str(ROOT / "cover.scad")], check=True, capture_output=True, timeout=120)
    print(f"Exports: {output}")


if __name__ == "__main__":
    main()
