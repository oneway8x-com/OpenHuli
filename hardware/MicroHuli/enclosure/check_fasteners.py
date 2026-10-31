#!/usr/bin/env python3
"""Check bottom M3 insertion and tool access before electronics/lid installation.

Uses actual cover solids, independently placed 3.2 mm shank and 8 mm tool
clearance cylinders. Requires OpenSCAD; no Python third-party packages.
"""
from pathlib import Path
import shutil
import struct
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parent


def main():
    openscad = shutil.which("openscad")
    if not openscad:
        raise SystemExit("Install OpenSCAD and put openscad on PATH")
    with tempfile.TemporaryDirectory(prefix="microhuli-fasteners-") as directory:
        temp = Path(directory)
        for x in (-21, 21):
            for y in (-40, 40):
                source, output = temp / "access.scad", temp / "collision.stl"
                source.write_text(f'''$fn = 48;
use <{ROOT / "cover.scad"}>
intersection() {{
    union() {{ adapter_assembled(); tub_assembled(); }}
    union() {{
        translate([{x},{y},17.8]) cylinder(d=3.2,h=5.05,$fn=48);
        translate([{x},{y},22.85]) cylinder(d=8,h=65,$fn=48);
        // Room for a loose nut and small socket below the adapter flange.
        translate([{x},{y},14]) cylinder(d=9,h=3.95,$fn=48);
    }}
}}
''')
                output.unlink(missing_ok=True)
                result = subprocess.run(
                    [openscad, "--export-format", "binstl", "-o", str(output), str(source)],
                    capture_output=True, text=True, timeout=120,
                )
                if "WARNING:" in result.stderr or "ERROR:" in result.stderr:
                    raise SystemExit(result.stderr)
                triangles = 0
                if output.exists():
                    data = output.read_bytes()
                    triangles = struct.unpack_from("<I", data, 80)[0]
                if triangles:
                    raise SystemExit(f"FAIL bottom bolt ({x}, {y}): insertion/tool/nut path intersects printed material")
                if result.returncode and "Current top level object is empty" not in result.stderr:
                    raise SystemExit(result.stderr)
                print(f"PASS bottom bolt ({x}, {y}): shank, 8 mm tool and underside nut/socket access")


if __name__ == "__main__":
    main()
