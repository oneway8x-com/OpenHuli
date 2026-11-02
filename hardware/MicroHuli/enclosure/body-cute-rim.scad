// Open-top body alternative, millimetres. Front = -Y, rear = +Y.
// The original 50 mm body plus the requested 50 mm raised rim totals 100 mm.
width = 55;
depth = 68;
body_height = 50;
rim_height = 50;
height = body_height + rim_height;
wall = 1.6;
base_wall = 1;
base_band = 16;
corner_radius = 4;
top_corner_radius = 8;
usb_size = 10;
usb_top_offset = 10;
oled_slot_width = 20.005;
oled_slot_height = 3;
oled_slot_z = 40;
$fn = 64;

module rounded_rectangle(w, d, r) {
    offset(r=r) square([w-2*r, d-2*r], center=true);
}

// Rounded upper corners seen from the face; sides remain vertical below them.
module crown_profile() {
    translate([0,depth/2+1,0]) rotate([90,0,0])
        linear_extrude(height=depth+2)
            hull() {
                translate([-width/2,0]) square([width,1]);
                for(x=[-width/2+top_corner_radius, width/2-top_corner_radius])
                    translate([x,height-top_corner_radius]) circle(r=top_corner_radius);
            }
}

module shell() {
    difference() {
        union() {
            // Square lower collar preserves the nominal original cavity.
            translate([-width/2,-depth/2,0]) cube([width,depth,base_band+wall]);
            translate([0,0,base_band+wall]) linear_extrude(height=height-base_band-wall)
                rounded_rectangle(width,depth,corner_radius);
        }
        translate([-width/2+base_wall,-depth/2+base_wall,-1])
            cube([width-2*base_wall,depth-2*base_wall,base_band+1]);
        translate([0,0,base_band]) linear_extrude(height=height-base_band+1)
            rounded_rectangle(width-2*wall,depth-2*wall,corner_radius-wall);
    }
}

difference() {
    intersection() { shell(); crown_profile(); }
    // Rear USB square, upper edge 10 mm below the highest rim edge.
    translate([-usb_size/2,depth/2-wall-1,height-usb_top_offset-usb_size])
        cube([usb_size,wall+2,usb_size]);
    // Original-style cable slot: OLED board mounts externally, not behind a window.
    translate([-oled_slot_width/2,-depth/2-1,oled_slot_z])
        cube([oled_slot_width,wall+2,oled_slot_height]);
}
