// Corrected body: closed roof with a small sloping edge, not a raised rim.
// Millimetres; front = -Y, rear = +Y, assembled bottom = Z=0.
part = "body"; // body, chassis, assembly, cutaway, exploded
width = 60;
depth = 70;
height = 50;
bevel = 5;
wall = 1.6;
top_thickness = 1.6;
base_wall = 1;
base_band = 16;
corner_radius = 4;
usb_size = 15;
usb_top_offset = 15;
oled_slot_width = 20.005;
oled_slot_height = 3;
oled_slot_z = 40;
print_orientation = true;
m3_clearance = 3.4;
chassis_hole_y = 29; // Two holes, front/rear centreline: 58 mm apart.
chassis_plate_top = 2; // Original mesh plate top is approximately 1.998 mm.
chassis_boss_top = 10;
chassis_nut_floor = 7;
nut_af = 5.8; // Clearance pocket for an ordinary 5.5 mm AF M3 hex nut.
board_pitch = [50, 50]; // Owner-confirmed four-hole square, centre to centre.
board_mount_z = 40; // PCB top contacts the four standoff ends.
board_post_d = 8;
$fn = 64;

assert(board_pitch[0]/2+board_post_d/2 <= width/2);
assert(board_pitch[1]/2+board_post_d/2 <= depth/2);
assert(chassis_nut_floor-chassis_plate_top >= 3);

module rounded_rectangle(w,d,r) {
    offset(r=r) square([w-2*r,d-2*r],center=true);
}

module profile_at(w,d,r,z) {
    translate([0,0,z]) linear_extrude(height=0.01)
        rounded_rectangle(w,d,r);
}

module shell() {
    inner_bevel_z = height-bevel-wall*(sqrt(2)-1);
    inner_top_z = height-top_thickness;
    inner_shrink = inner_top_z-inner_bevel_z;
    difference() {
        union() {
            // Lower cavity is 58 x 68 x 16 mm with the widened footprint.
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
    }
}

module board_axes() {
    for(x=[-board_pitch[0]/2,board_pitch[0]/2],
        y=[-board_pitch[1]/2,board_pitch[1]/2]) translate([x,y,0]) children();
}

module chassis_axes() {
    for(side=[-1,1]) translate([0,side*chassis_hole_y,0]) children();
}

module chassis_bosses() {
    for(side=[-1,1]) scale([1,side,1]) {
        // Front/rear lugs leave the original side servo brackets untouched.
        translate([0,chassis_hole_y,chassis_plate_top])
            cylinder(d=10,h=chassis_boss_top-chassis_plate_top);
        translate([-5,chassis_hole_y,chassis_plate_top])
            cube([10,depth/2-chassis_hole_y,chassis_boss_top-chassis_plate_top]);
        // A sloped support grows from the wall when printed roof-down.
        hull() {
            translate([-5,chassis_hole_y-5,chassis_boss_top-1])
                cube([10,depth/2-chassis_hole_y+5,1]);
            translate([-5,depth/2-wall,19.9]) cube([10,wall,0.1]);
        }
    }
}

module body() {
    difference() {
        union() {
            shell();
            chassis_bosses();
            // Flat screw-head lands continue through the sloped shoulder.
            board_axes() translate([0,0,board_mount_z])
                cylinder(d=board_post_d,h=height-board_mount_z);
        }
        translate([-usb_size/2,depth/2-wall-1,height-usb_top_offset-usb_size])
            cube([usb_size,wall+2,usb_size]);
        translate([-oled_slot_width/2,-depth/2-1,oled_slot_z])
            cube([oled_slot_width,wall+2,oled_slot_height]);
        board_axes() translate([0,0,board_mount_z-1])
            cylinder(d=m3_clearance,h=height-board_mount_z+2);
        // Washer/nut clearance below the PCB, retaining 1.3 mm outer wall.
        board_axes() translate([0,0,board_mount_z-5]) cylinder(d=7.4,h=5);
        chassis_axes() {
            translate([0,0,chassis_plate_top-1]) cylinder(d=m3_clearance,h=21);
            // Open from above for nut insertion before the shell is fitted.
            translate([0,0,chassis_nut_floor])
                cylinder(d=nut_af/cos(30),h=14,$fn=6);
        }
    }
}

module original_chassis() {
    // Extract only the original 53 x 66 mm chassis, without rescaling it.
    translate([-30.5,-60,0]) intersection() {
        import("../../../firmware/MicroHuli/stl_files/MicroHuli.stl",convexity=10);
        translate([3,26,-1]) cube([55,68,18]);
    }
}

module chassis() {
    difference() {
        original_chassis();
        chassis_axes() translate([0,0,-1]) cylinder(d=m3_clearance,h=20);
    }
}

if(part=="body") {
    if(print_orientation) translate([0,0,height]) rotate([180,0,0]) body();
    else body();
} else if(part=="chassis") chassis();
else if(part=="assembly" || part=="exploded" || part=="cutaway") {
    color("SlateGray") chassis();
    color("Goldenrod") translate([0,0,part=="exploded" ? 24 : 0])
        if(part=="cutaway") difference() {
            body();
            translate([-40,-40,20]) cube([80,40,40]);
        } else body();
} else assert(false,"Unknown part");
