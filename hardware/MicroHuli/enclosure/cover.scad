// MicroHuli battery enclosure. Units: mm. Component sizes supplied by owner.
// Print parts separately: adapter, tub, tray, lid. Assembly coordinates: rim Z=0.
part = "assembly"; // adapter, tub, tray, lid, plate, assembly, inside
battery = [60, 50, 16];
shield = [60, 50, 20];
component_clearance = 1; // Per side around battery holder.
wall = 1.6; // Lightweight fit prototype; load-bearing plates remain 2.4 mm.
outer = [72, 92];
collar_h = 18;
flange = 2.4;
floor_t = 2.4;
roof_z = 80;
lid_t = 1.6;
tray_t = 2.4;
tray_z = 44.8; // Underside, measured from original cover rim.
board_gap = 3; // Insulating support pads below board, not connector allowance.
component_y = -7;
tray_size = [66, 56];
// Broad service openings; adjust Y/Z after checking actual connector positions.
service_y = -7;
service_z = 60;
service_size = [24, 16];
// External OLED: adjustable slots, not an assumed exact hole pattern.
oled_slot_x = [12, 19];
oled_slot_z = [47, 72];
ir_size = [16, 12];
ir_z = 33;
honeycomb = true;
hex_af = 7; // Clear opening across flats.
hex_web = 1.6; // Nominal material between adjacent hex openings.
$fn = 48;

tub_z = collar_h + flange;
battery_z = tub_z + floor_t;
board_z = tray_z + tray_t + board_gap;
inside_size = outer - [2*wall, 2*wall];
lid_xy = [outer[0]/2-5, outer[1]/2-5];
base_xy = [21, 40]; // Clear lid pillars, tray rails and front IR/rear shelf supports.
eps = 0.05;
assert(battery[0]+2*component_clearance+4 <= inside_size[0], "Battery fence exceeds tub");
assert(shield[0]+2 <= tray_size[0] && shield[1]+2 <= tray_size[1], "Shield exceeds tray");
assert(battery_z+battery[2]+4 <= tray_z, "Battery removal/wiring gap too small");
assert(board_z+shield[2]+8 <= roof_z, "Board/header wire clearance too small");
assert(component_y+max(battery[1], shield[1])/2+6 <= 25, "Rear bay obstructed");
assert(tray_size[0] < inside_size[0] && tray_size[1] < inside_size[1]);
assert(wall >= 1.6 && lid_t >= 1.6 && hex_web >= 1.6, "Prototype walls, lid and webs must be at least 1.6 mm");
assert(collar_h == 18, "Preserve original collar cut plane");

module rounded(size, r=4) {
    linear_extrude(size[2]) offset(r=r)
        square([size[0]-2*r, size[1]-2*r], center=true);
}
module four(xy) { for(x=[-xy[0],xy[0]], y=[-xy[1],xy[1]]) translate([x,y,0]) children(); }
// Finite hex field clipped to a rectangular panel; its surrounding frame stays solid.
module hex_panel(size, depth) {
    intersection() {
        cube([size[0],size[1],depth],center=true);
        for(col=[-12:12],row=[-14:14])
            translate([col*sqrt(3)/2*(hex_af+hex_web),
                       (row+(col%2==0 ? 0 : 0.5))*(hex_af+hex_web),0])
                cylinder(r=hex_af/sqrt(3),h=depth+1,center=true,$fn=6);
    }
}
module wall_lightening() {
    // Side frames and continuous rails/shelf band carry the component mounts.
    for(side=[-1,1]) translate([side*outer[0]/2,0,51]) rotate([90,0,90])
        difference() {
            hex_panel([outer[1]-24,42],wall*3);
            translate([0,-7.5,0]) cube([outer[1],12,wall*4],center=true);
            translate([service_y,service_z-51,0]) cube([service_size[0]+6,service_size[1]+6,wall*4],center=true);
        }
    // Rear ribs protect the ESP shelf/gusset attachments; front stays solid for OLED/IR.
    translate([0,outer[1]/2,51]) rotate([90,0,0]) difference() {
        hex_panel([outer[0]-20,42],wall*3);
        translate([0,-10,0]) cube([outer[0],7,wall*4],center=true);
        for(x=[-13,13]) translate([x,-11,0]) cube([10,25,wall*4],center=true);
    }
}
module original_cover() {
    // Isolate cover only; legs and servo chassis remain untouched.
    translate([46.5,-19,31.001]) mirror([0,0,1]) intersection() {
        import("../../../firmware/MicroHuli/stl_files/MicroHuli.stl", convexity=10);
        translate([-75,-16,-1]) cube([57,70,34]);
    }
}
module adapter_assembled() {
    difference() {
        union() {
            intersection() {
                original_cover();
                translate([-40,-50,-eps]) cube([80,100,collar_h+2*eps]);
            }
            translate([0,0,collar_h]) rounded([outer[0],outer[1],flange]);
        }
        four(base_xy) translate([0,0,collar_h-1]) cylinder(d=3.6,h=flange+2);
        // Align with tub strap slots so the adapter cannot block the straps.
        for(x=[-32,32],y=[component_y-12,component_y+12])
            translate([x,y,collar_h+flange/2]) cube([2.2,12,flange+1],center=true);
        if(honeycomb) translate([0,-2,collar_h+flange/2]) cube([44,46,flange+1],center=true);
        // Connector passage from servo cavity to upper electronics, outside holder.
        translate([-10,27,collar_h]) cube([20,8,flange+1]);
    }
}
module side_port(side) {
    translate([side*outer[0]/2,service_y,service_z])
        cube([wall*3,service_size[0],service_size[1]],center=true);
}
module front_slot(x,z) {
    hull() for(xx=[x[0],x[1]])
        translate([xx,-outer[1]/2-wall,z]) rotate([-90,0,0]) cylinder(d=3.4,h=3*wall);
}
module battery_fence() {
    translate([0,component_y,battery_z]) difference() {
        rounded([battery[0]+2*component_clearance+4,battery[1]+2*component_clearance+4,4],2);
        translate([0,0,-eps]) rounded([battery[0]+2*component_clearance,battery[1]+2*component_clearance,4+2*eps],1);
        // End access for holder leads, straps and lifting.
        translate([-15,-40,-eps]) cube([30,80,5]);
    }
}
module tray_rails() {
    difference() {
        union() {
            for(side=[-1,1]) {
                // A 45-degree underside supports the 5 mm inward ledge.
                hull() {
                    translate([side*(inside_size[0]/2-0.3),component_y,tray_z-5]) cube([0.6,64,0.4],center=true);
                    translate([side*(inside_size[0]/2-2.5),component_y,tray_z-0.2]) cube([5,64,0.4],center=true);
                }
            }
            // End stops leave 0.6 mm longitudinal clearance at each tray end.
            for(x=[-31,31],y=[component_y-29.6,component_y+29.6])
                translate([x,y,tray_z+0.8]) cube([5,2,2.4],center=true);
        }
        // Retaining straps must pass under tray slots, not sit on solid rails.
        for(side=[-1,1],y=[component_y-14,component_y+14])
            translate([side*31.1,y,tray_z-0.8]) cube([4.6,12,2.4],center=true);
    }
}
module lid_bosses() {
    // Floor-supported pillars avoid suspended nut bosses and retain the lid.
    four(lid_xy) translate([0,0,battery_z-eps]) cylinder(d=9.6,h=roof_z-battery_z+eps);
}
module ir_tabs() {
    // Universal tie tabs, no unmeasured receiver-board screw pattern.
    for(x=[-13,13]) translate([x,-inside_size[1]/2+2,ir_z]) difference() {
        cube([5,6,16],center=true);
        cube([2,10,8],center=true);
    }
}
module rear_bay() {
    // 32 x 14 mm shelf for an upright future module; strap, no pin-specific socket.
    translate([0,inside_size[1]/2-6.8,40]) difference() {
        cube([32,14.4,2],center=true);
        for(x=[-11,11]) translate([x,0,0]) cube([2,9,4],center=true);
    }
    // Shelf gussets grow from the rear wall at ~45 degrees.
    for(x=[-13,13]) hull() {
        translate([x,inside_size[1]/2-0.4,27]) cube([3,1,0.4],center=true);
        translate([x,inside_size[1]/2-6.8,39.5]) cube([3,14.4,1],center=true);
    }
}
module tub_assembled() {
    difference() {
        union() {
            difference() {
                translate([0,0,tub_z]) rounded([outer[0],outer[1],roof_z-tub_z]);
                translate([0,0,tub_z+floor_t]) rounded([inside_size[0],inside_size[1],roof_z],2);
            }
            battery_fence();
            tray_rails();
            lid_bosses();
            ir_tabs();
            rear_bay();
        }
        four(base_xy) translate([0,0,tub_z-1]) cylinder(d=3.6,h=floor_t+2);
        translate([-10,27,tub_z-1]) cube([20,8,floor_t+2]);
        // Battery retaining straps thread through floor outside the holder.
        for(x=[-32,32],y=[component_y-12,component_y+12])
            translate([x,y,tub_z+floor_t/2]) cube([2.2,12,floor_t+2],center=true);
        four(lid_xy) {
            translate([0,0,roof_z-9]) cylinder(d=3.4,h=10);
            translate([0,0,roof_z-2.8]) rotate([0,0,30]) cylinder(d=5.8/cos(30),h=3.5,$fn=6);
        }
        if(honeycomb) {
            wall_lightening();
            translate([0,component_y,tub_z+floor_t/2]) hex_panel([44,36],floor_t+1);
        }
        for(side=[-1,1]) side_port(side);
        // Open optical path: receiver lens immediately behind front wall.
        translate([0,-outer[1]/2,ir_z]) cube([ir_size[0],3*wall,ir_size[1]],center=true);
        for(z=oled_slot_z) {
            front_slot(oled_slot_x,z);
            front_slot([-oled_slot_x[1],-oled_slot_x[0]],z);
        }
        // OLED cable passage above display, under top lip.
        translate([0,-outer[1]/2,77]) cube([10,3*wall,4],center=true);
    }
}
module tray_assembled() {
    translate([0,component_y,tray_z]) difference() {
        union() {
            rounded([tray_size[0],tray_size[1],tray_t],2);
            // Four insulating pads: protect shield underside/solder joints.
            for(x=[-26,26],y=[-20,20]) translate([x,y,tray_t]) cylinder(d=6,h=board_gap);
        }
        for(x=[-31.5,31.5],y=[-14,14])
            translate([x,y,tray_t/2]) cube([2,10,tray_t+2],center=true);
        if(honeycomb) translate([0,0,tray_t/2]) hex_panel([44,32],tray_t+1);
        // Finger grip and wire route at front/back.
        for(y=[-tray_size[1]/2,tray_size[1]/2])
            translate([0,y,-eps]) cylinder(d=14,h=tray_t+1);
    }
}
module lid_assembled() {
    difference() {
        union() {
            translate([0,0,roof_z]) rounded([outer[0],outer[1],lid_t]);
            // Locating skirt, with corner clearance for nut bosses.
            difference() {
                translate([0,0,roof_z-1.6]) rounded([inside_size[0]-0.6,inside_size[1]-0.6,1.7],2);
                translate([0,0,roof_z-2]) rounded([inside_size[0]-3,inside_size[1]-3,3],1);
                four(lid_xy) translate([0,0,roof_z-2]) cylinder(d=11,h=4);
            }
        }
        four(lid_xy) translate([0,0,roof_z-1]) cylinder(d=3.4,h=lid_t+2);
        if(honeycomb) translate([0,0,roof_z+lid_t/2]) hex_panel([outer[0]-24,outer[1]-24],lid_t+1);
    }
}
module mock_components() {
    color([0.20,0.22,0.25]) translate([0,component_y,battery_z+battery[2]/2]) cube(battery,center=true);
    // Battery pack envelope is measured including cells; avoid fictitious contacts.
    color([0.15,0.52,0.35]) translate([0,component_y,board_z+shield[2]/2]) cube(shield,center=true);
    color([0.15,0.30,0.70]) translate([0,36,56]) cube([26,8,30],center=true);
    color([0.75,0.42,0.15]) translate([23,29,29]) cube([16,14,10],center=true);
    color([0.18,0.18,0.20]) translate([0,-43.5,ir_z]) cube([8,5,8],center=true);
    color([0.07,0.12,0.20]) translate([0,-outer[1]/2-2,59.5]) cube([35,3,35],center=true);
    // Illustrative OLED eyes, not a physical screen/render qualification.
    for(x=[-7,7]) color([0.1,0.8,1]) translate([x,-outer[1]/2-3.7,59.5]) cube([8,0.4,7],center=true);
}
module adapter_print() { translate([0,0,tub_z]) mirror([0,0,1]) adapter_assembled(); }
module tub_print() { translate([0,0,-tub_z]) tub_assembled(); }
module tray_print() { translate([0,-component_y,-tray_z]) tray_assembled(); }
module lid_print() { translate([0,0,roof_z+lid_t]) mirror([0,0,1]) lid_assembled(); }

if(part=="adapter") adapter_print();
else if(part=="tub") tub_print();
else if(part=="tray") tray_print();
else if(part=="lid") lid_print();
else if(part=="plate") {
    translate([36,46,0]) tub_print();
    translate([120,46,0]) adapter_print();
    translate([36,150,0]) lid_print();
    translate([117,133,0]) tray_print();
}
else if(part=="assembly" || part=="inside") {
    color([0.35,0.43,0.49]) adapter_assembled();
    color([0.88,0.65,0.12])
        if(part=="inside") intersection() {
            tub_assembled();
            // Remove right and front half to expose tray and battery.
            translate([-100,-5,-1]) cube([100,120,120]);
        } else tub_assembled();
    color([0.50,0.60,0.65]) tray_assembled();
    if(part=="assembly") color([0.93,0.72,0.17]) lid_assembled();
    mock_components();
} else assert(false,"Unknown part");
