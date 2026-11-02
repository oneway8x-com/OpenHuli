#!/usr/bin/env python3
"""Export and check the matched M3 body/chassis. Requires OpenSCAD on PATH.

Uses only Python's standard library. CAD checks do not establish printed fit,
servo clearance with real hardware, strength, or electronics compatibility.
"""
import argparse
import json
import math
from pathlib import Path
import shutil
import struct
import subprocess
import tempfile

from build import mesh

ROOT = Path(__file__).resolve().parent
SOURCE = ROOT / "body-cute-50mm.scad"


def render(openscad, source, output, *options, allow_empty=False):
    result = subprocess.run(
        [openscad, *options, "-o", str(output), str(source)],
        capture_output=True, text=True, timeout=180,
    )
    log = result.stdout + result.stderr
    empty = "Current top level object is empty" in log
    if ("WARNING:" in log or "ERROR:" in log
            or (result.returncode and not (allow_empty and empty))):
        raise RuntimeError(log)
    return empty


def volume(path):
    if not path.exists():
        return 0
    data = path.read_bytes()
    count = struct.unpack_from("<I", data, 80)[0]
    if len(data) != 84 + count * 50:
        raise ValueError(f"Invalid binary STL: {path}")
    result = 0
    for i in range(count):
        p, q, r = (struct.unpack_from("<3f", data, 96 + i * 50 + j * 12)
                   for j in range(3))
        result += (p[0] * (q[1]*r[2]-q[2]*r[1])
                   + p[1] * (q[2]*r[0]-q[0]*r[2])
                   + p[2] * (q[0]*r[1]-q[1]*r[0])) / 6
    return abs(result)


def check_assembly(openscad):
    checks = []
    with tempfile.TemporaryDirectory(prefix="microhuli-body-") as directory:
        folder = Path(directory)

        def intersection(name, geometry, tools, minimum=0, maximum=0.01):
            source, output = folder / "check.scad", folder / "check.stl"
            source.write_text(
                f'use <{SOURCE.as_posix()}>\n$fn=64;\n'
                f'intersection() {{ {geometry} {tools} }}\n',
                encoding="utf-8",
            )
            output.unlink(missing_ok=True)
            render(openscad, source, output, "--export-format", "binstl", allow_empty=True)
            found = volume(output)
            if not minimum <= found <= maximum:
                raise ValueError(f"{name}: volume {found:.4f}, expected {minimum}..{maximum}")
            checks.append({"check": name, "intersection_mm3": round(found, 4)})
            print(f"PASS {name}: {found:.4f} mm3")

        intersection("assembled body/chassis clearance", "body();", "chassis();")
        # Independently specified axes catch misplaced holes and obstructions.
        for y in (-29, 29):
            intersection(f"chassis bolt {y}: shank/nut/tool access",
                         "union() { body(); chassis(); }", f'''union() {{
                translate([0,{y},-1]) cylinder(d=3.2,h=9);
                translate([0,{y},7.1]) cylinder(d=5.5/cos(30),h=20,$fn=6);
                translate([0,{y},-20]) cylinder(d=8,h=19.9);
            }}''')
            # Ensure each drill axis passes through actual original plate material.
            intersection(f"original plate material at bolt {y}", "original_chassis();",
                         f"translate([0,{y},0.2]) cylinder(d=3,h=1.5);", 10.5, 10.7)
        for x in (-25, 25):
            for y in (-25, 25):
                intersection(f"board bolt {x},{y}: shank/head/nut access", "body();", f'''union() {{
                    translate([{x},{y},39.9]) cylinder(d=3.2,h=12);
                    translate([{x},{y},50.01]) cylinder(d=7,h=15);
                    translate([{x},{y},35]) cylinder(d=7,h=3.3);
                }}''')
                # Support exists at the PCB contact plane, not just at the roof.
                intersection(f"board support {x},{y}", "body();", f'''difference() {{
                    translate([{x},{y},40.1]) cylinder(d=7,h=0.4);
                    translate([{x},{y},40]) cylinder(d=4,h=1);
                }}''', 10.3, 10.4)
        intersection("rear 15 x 15 opening", "body();",
                     "translate([-7.49,33,20.01]) cube([14.98,3,14.98]);")
        intersection("front OLED slot", "body();",
                     "translate([-9.99,-36,40.01]) cube([19.98,3,2.98]);")
        # Chassis edits must consist only of the two specified clearance holes.
        intersection("no added chassis material", "chassis();",
                     "difference() { cube([100,100,100],center=true); original_chassis(); }")
        intersection("no other chassis cuts", "original_chassis();", '''difference() {
            difference() { cube([100,100,100],center=true); chassis(); }
            for(y=[-29,29]) translate([0,y,-1]) cylinder(d=3.4,h=20);
        }''')
    return checks


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=ROOT / "exports")
    parser.add_argument("--previews", action="store_true")
    args = parser.parse_args()
    openscad = shutil.which("openscad.com") or shutil.which("openscad")
    if not openscad:
        parser.error("Install OpenSCAD and put its directory on PATH")
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    reports = {}
    for name in ("body", "chassis"):
        path = output / f"MicroHuli_{name}_M3_v3.stl"
        render(openscad, SOURCE, path, "--export-format", "binstl", "-D", f'part="{name}"')
        reports[name] = mesh(path)[2]
        expected = [60, 70, 50] if name == "body" else [53, 66, 15.996]
        if any(not math.isclose(a, b, abs_tol=0.01)
               for a, b in zip(reports[name]["size_mm"], expected)):
            raise ValueError(f"Unexpected {name} dimensions: {reports[name]}")
        print(f"PASS {name}: {reports[name]}")
    checks = check_assembly(openscad)
    (output / "body_M3_v3_report.json").write_text(json.dumps({
        "parts": reports, "checks": checks,
        "qualification": "CAD geometry only; no slicing or physical qualification",
    }, indent=2) + "\n", encoding="utf-8")
    if args.previews:
        for name, camera in (
            ("assembly", "130,160,110,0,0,25"),
            ("cutaway", "110,-160,105,0,0,24"),
            ("exploded", "120,-170,125,0,0,35"),
            ("body", "110,160,-100,0,0,25"),
        ):
            render(openscad, SOURCE, output / f"body_M3_v3_{name}.png",
                   "--render", "--imgsize=1200,1000", "--colorscheme=Tomorrow",
                   f"--camera={camera}", "--viewall", "--autocenter", "--projection=o",
                   "-D", f'part="{name}"', "-D", "print_orientation=false")
    print(f"Exports: {output}")


if __name__ == "__main__":
    main()
