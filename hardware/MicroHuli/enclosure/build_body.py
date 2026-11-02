#!/usr/bin/env python3
"""Export and check the matched M3 body/chassis. Requires OpenSCAD on PATH.

Uses only Python's standard library. CAD checks do not establish printed fit,
servo clearance with real hardware, strength, or electronics compatibility.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
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
        cases = []

        def intersection(name, geometry, tools, minimum=0, maximum=0.01):
            cases.append((name, geometry, tools, minimum, maximum))

        def run_case(indexed_case):
            index, (name, geometry, tools, minimum, maximum) = indexed_case
            source, output = folder / f"check-{index}.scad", folder / f"check-{index}.stl"
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
            return {"check": name, "intersection_mm3": round(found, 4)}

        # Exclude the intentional shared Z=0 contact face: CGAL otherwise exports
        # that zero-thickness surface as a non-manifold collision artifact.
        intersection("assembled body/chassis clearance (0.001 mm face tolerance)",
                     "body();", "translate([0,0,-0.001]) chassis();")
        # Independently specified axes catch misplaced holes and obstructions.
        for x in (-36, 36):
            intersection(f"chassis bolt {x}: shank/nut/tool access",
                         "union() { body(); chassis(); }", f'''union() {{
                translate([{x},0,-6]) cylinder(d=3.2,h=11);
                translate([{x},0,-20]) cylinder(d=5.5/cos(30),h=17.5,$fn=6);
                translate([{x},0,4.1]) cylinder(d=8,h=30);
            }}''')
            intersection(f"external tab support at bolt {x}", "body();", f'''difference() {{
                translate([{x},0,0.1]) cylinder(d=10,h=0.4);
                translate([{x},0,0]) cylinder(d=4,h=1);
            }}''', 26.3, 26.4)
        for x in (-25, 25):
            for y in (-25, 25):
                intersection(f"board bolt {x},{y}: shank/head/nut access", "body();", f'''union() {{
                    translate([{x},{y},37.9]) cylinder(d=3.2,h=14);
                    translate([{x},{y},50.01]) cylinder(d=7,h=15);
                    translate([{x},{y},33]) cylinder(d=7,h=3.3);
                }}''')
                # Support exists at the PCB contact plane, not just at the roof.
                intersection(f"board support {x},{y}", "body();", f'''difference() {{
                    translate([{x},{y},38.1]) cylinder(d=7,h=0.4);
                    translate([{x},{y},38]) cylinder(d=4,h=1);
                }}''', 10.3, 10.4)
        intersection("rear 15 x 15 opening", "body();",
                     "translate([-7.49,33,23.01]) cube([14.98,3,14.98]);")
        intersection("front OLED slot", "body();",
                     "translate([-9.99,-36,40.01]) cube([19.98,3,2.98]);")
        intersection("existing OLED cable passage above lowered board", "body();",
                     "translate([-4,-36,41]) cube([8,36,1.5]);")
        # Compare added material against the shell so its rounded corners are
        # not incorrectly classified as internal fastener obstructions.
        intersection("lower body cavity clear of chassis mounts", "difference() { body(); shell(); }",
                     "translate([-28.99,-33.99,0.01]) cube([57.98,67.98,19.9]);")
        intersection("chassis entirely below the plate plane", "chassis();",
                     "translate([-50,-50,0.01]) cube([100,100,30]);")
        intersection("no original chassis cuts", "rotate([180,0,0]) original_chassis();",
                     "difference() { cube([120,120,120],center=true); chassis(); }")
        # Original brackets occupy approximately X=-17.5..17.7, Y=-32..32.
        # Keep additions outside a larger bracket region; real moving legs are
        # not modeled by this check and still need physical qualification.
        intersection("no added material around original servo brackets", '''difference() {
            chassis(); rotate([180,0,0]) original_chassis();
        }''', "translate([-20,-33,-20]) cube([40,66,19.9]);")
        # Isolate the independent CAD renders and allow at most four processes
        # at once to keep verification time and memory use bounded.
        with ThreadPoolExecutor(max_workers=4) as pool:
            for result in pool.map(run_case, enumerate(cases)):
                checks.append(result)
                print(f"PASS {result['check']}: {result['intersection_mm3']:.4f} mm3")
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
        path = output / f"MicroHuli_{name}_M3_v7.stl"
        render(openscad, SOURCE, path, "--export-format", "binstl", "-D", f'part="{name}"')
        reports[name] = mesh(path)[2]
        expected = [86, 70, 50] if name == "body" else [86, 66, 15.996]
        if any(not math.isclose(a, b, abs_tol=0.01)
               for a, b in zip(reports[name]["size_mm"], expected)):
            raise ValueError(f"Unexpected {name} dimensions: {reports[name]}")
        print(f"PASS {name}: {reports[name]}")
    checks = check_assembly(openscad)
    (output / "body_M3_v7_report.json").write_text(json.dumps({
        "parts": reports, "checks": checks,
        "qualification": "CAD geometry only; no slicing or physical qualification",
    }, indent=2) + "\n", encoding="utf-8")
    if args.previews:
        for name, camera in (
            ("assembly", "130,160,110,0,0,18"),
            ("cutaway", "110,-160,105,0,0,18"),
            ("exploded", "120,-170,125,0,0,35"),
            ("body", "110,160,-100,0,0,25"),
        ):
            render(openscad, SOURCE, output / f"body_M3_v7_{name}.png",
                   "--render", "--imgsize=1200,1000", "--colorscheme=Tomorrow",
                   f"--camera={camera}", "--viewall", "--autocenter", "--projection=o",
                   "-D", f'part="{name}"', "-D", "print_orientation=false")
    print(f"Exports: {output}")


if __name__ == "__main__":
    main()
