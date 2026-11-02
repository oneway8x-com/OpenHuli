// Rectangular, flat-top alternative to the original MicroHuli cover.
// Millimetres. Rear is +Y; assembled bottom is Z=0.
width = 55;
depth = 68;
height = 50;
wall = 1.0;
top_thickness = 1.6;
usb_width = 10;
usb_height = 10;
usb_top_offset = 10; // Outside top to upper edge of opening.
print_orientation = true; // Closed top on the bed; no internal supports.

assert(width > 2 * wall && depth > 2 * wall);
assert(height > top_thickness && wall > 0 && top_thickness > 0);
assert(usb_width < width - 2 * wall);
assert(usb_top_offset > top_thickness);
assert(usb_top_offset + usb_height < height);

module body() {
    difference() {
        translate([-width / 2, -depth / 2, 0])
            cube([width, depth, height]);
        // Open bottom, preserving the original nominal 53 x 66 mm cavity.
        translate([-width / 2 + wall, -depth / 2 + wall, -1])
            cube([width - 2 * wall, depth - 2 * wall,
                  height - top_thickness + 1]);
        // Square opening centered on the rear wall.
        translate([-usb_width / 2, depth / 2 - wall - 1,
                   height - usb_top_offset - usb_height])
            cube([usb_width, wall + 2, usb_height]);
    }
}

if (print_orientation)
    translate([0, 0, height]) rotate([180, 0, 0]) body();
else
    body();
