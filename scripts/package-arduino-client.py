"""Build a secret-free Arduino ZIP from the monorepo library. No registry publication."""

import argparse
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile


def package(output: Path) -> None:
    root = Path(__file__).resolve().parent.parent / "libraries" / "OpenHuli"
    paths = [root / name for name in ("library.json", "library.properties", "README.md", "LICENSE")]
    paths += sorted((root / "src").glob("*.h"))
    paths += sorted((root / "src").glob("*.cpp"))
    example = root / "examples" / "Telemetry"
    paths += [example / name for name in ("Telemetry.ino", "config.example.h", "platformio.ini")]
    with ZipFile(output, "w", ZIP_DEFLATED) as archive:
        for path in paths:
            archive.write(path, "OpenHuli/" + path.relative_to(root).as_posix())
    print(f"Created {output} ({len(paths)} files)")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True, type=Path)
    package(parser.parse_args().output)
