"""Build a secret-free Arduino ZIP from the monorepo library. No registry publication."""

import argparse
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile


def package(output: Path, library: str = "OpenHuli") -> None:
    root = Path(__file__).resolve().parent.parent / "libraries" / library
    paths = [root / name for name in ("library.json", "library.properties", "README.md", "LICENSE")]
    paths += sorted((root / "src").glob("*.h"))
    paths += sorted((root / "src").glob("*.cpp"))
    example_name = "Telemetry" if library == "OpenHuli" else "Node"
    example = root / "examples" / example_name
    names = ("Telemetry.ino", "config.example.h", "platformio.ini") if library == "OpenHuli" else ("Node.ino", "platformio.ini")
    paths += [example / name for name in names]
    if library == "OpenHuliSerial":
        paths += [root / "examples" / "Sensors" / name for name in ("Sensors.ino", "platformio.ini")]
    with ZipFile(output, "w", ZIP_DEFLATED) as archive:
        for path in paths:
            archive.write(path, library + "/" + path.relative_to(root).as_posix())
    print(f"Created {output} ({len(paths)} files)")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--library", choices=("OpenHuli", "OpenHuliSerial"), default="OpenHuli")
    args = parser.parse_args()
    package(args.output, args.library)
