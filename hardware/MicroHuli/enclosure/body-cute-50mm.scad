// Corrected body: closed roof with a small sloping edge, not a raised rim.
// Millimetres; front = -Y, rear = +Y, assembled bottom = Z=0.
width = 55;
depth = 68;
height = 50;
bevel = 5;
wall = 1.6;
top_thickness = 1.6;
base_wall = 1;
base_band = 16;
corner_radius = 4;
usb_size = 10;
usb_top_offset = 10;
oled_slot_width = 20.005;
oled_slot_height = 3;
oled_slot_z = 40;
print_orientation = true;
$fn = 64;

module rounded_rectangle(w,d,r) {
    offset(r=r) square([w-2*r,d-2*r],center=true);
}

module profile_at(w,d,r,z) {
    translate([0,0,z]) linear_extrude(height=0.01)
        rounded_rectangle(w,d,r);
}

module body() {
    inner_bevel_z = height-bevel-wall*(sqrt(2)-1);
    inner_top_z = height-top_thickness;
    inner_shrink = inner_top_z-inner_bevel_z;
    difference() {
        union() {
            // Keep the original nominal lower 53 x 66 x 16 mm cavity.
            translate([-width/2,-depth/2,0]) cube([width,depth,base_band+wall]);
            translate([0,0,base_band+wall])
                linear_extrude(height=height-bevel-base_band-wall)
                    rounded_rectangle(width,depth,corner_radius);
            // Small 5 mm sloped shoulder around a closed, flat central roof.
            hull() {
                profile_at(width,depth,corner_radius,height-bevel-0.01);
                profile_at(width-2*bevel,depth-2*bevel,3,height-0.01);
            }
        }
        translate([-width/2+base_wall,-depth/2+base_wall,-1])
            cube([width-2*base_wall,depth-2*base_wall,base_band+1]);
        translate([0,0,base_band])
            linear_extrude(height=inner_bevel_z-base_band)
                rounded_rectangle(width-2*wall,depth-2*wall,corner_radius-wall);
        hull() {
            profile_at(width-2*wall,depth-2*wall,corner_radius-wall,inner_bevel_z-0.01);
            profile_at(width-2*wall-2*inner_shrink,depth-2*wall-2*inner_shrink,
                       1.4,inner_top_z-0.01);
        }
        translate([-usb_size/2,depth/2-wall-1,height-usb_top_offset-usb_size])
            cube([usb_size,wall+2,usb_size]);
        // Original-style cable slot for an externally mounted OLED board.
        translate([-oled_slot_width/2,-depth/2-1,oled_slot_z])
            cube([oled_slot_width,wall+2,oled_slot_height]);
    }
}

if(print_orientation)
    translate([0,0,height]) rotate([180,0,0]) body();
else
    body();
