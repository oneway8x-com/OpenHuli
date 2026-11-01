# MicroHuli body with a small sloped roof edge

This is the corrected body requested after the raised-rim interpretation was
rejected. Outside dimensions are **55 × 68 × 50 mm total**, including the roof.
It has a **closed top**, a small **5 mm sloped shoulder** like the original
cover, softly rounded upper plan corners, and an open bottom for the chassis.

![Front and rear of the corrected body](body-cute-50mm.png)

- Front OLED cable slot: **20.005 × 3 mm**, 40–43 mm above the bottom. As on
  the original robot, the OLED board mounts outside the body. The cable slot
  is retained; the old sloping recess and a verified OLED fastening method are
  not reproduced.
- Rear USB opening: **10 × 10 mm**, centered, 30–40 mm above the bottom. Its
  upper edge is **10 mm below the top**. Check actual connector alignment.
- Upper walls and flat roof: **1.6 mm**. Lower collar: 1 mm walls with a nominal
  **53 × 66 mm cavity for the first 16 mm**. A short transition joins the square
  collar to rounded upper corners. The cavity narrows beneath the roof shoulder.
- No internal mounts. Check shield, battery, plugs and wires together; nominal
  outside dimensions do not establish electronics clearance or chassis retention.

## Export and print

```sh
mkdir -p hardware/MicroHuli/enclosure/exports
openscad --export-format binstl \
  -o hardware/MicroHuli/enclosure/exports/MicroHuli_body_cute_50mm.stl \
  hardware/MicroHuli/enclosure/body-cute-50mm.scad
```

The export puts the closed central roof on the bed and the open bottom upward.
The 5 mm shoulder grows outward at approximately 45° in this orientation.
Start with a 0.4 mm nozzle and 0.2 mm layers; inspect wall paths, shoulder
layers and bridges over the two small openings. Internal supports should not
be required. Physical printing, strength, cable fit and attachment remain
untested.

Set `print_orientation=false` for an upright view. Edit parameters in
[body-cute-50mm.scad](body-cute-50mm.scad). The earlier flat-top and tall-rim
alternatives are separate files; use this version for the corrected request.
