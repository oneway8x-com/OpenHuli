"""Roomy weather-station enclosure, V1, all dimensions in millimetres.

Requires CadQuery 2.7 (pip install cadquery). Run: python weather_station_cad.py
STLs are oriented for printing; STEP contains assembled plastic parts only.
This is an unbuilt prototype. Verify your actual LCD and power hardware first.
"""
from pathlib import Path
import json, math, struct, zipfile
import xml.etree.ElementTree as ET
import cadquery as cq

OUT = Path(__file__).resolve().parent
P = dict(
    width=150.0, height=110.0, depth=75.0, wall=2.4, corner_r=6.0,
    lcd_pcb_w=80.0, lcd_pcb_h=36.0,
    lcd_bezel_w=71.2, lcd_bezel_h=25.2,
    lcd_open_w=73.2, lcd_open_h=27.2,
    lcd_hole_pitch_x=75.0, lcd_hole_pitch_y=31.0,
    lcd_cx=75.0, lcd_cy=80.0, lcd_pcb_front_z=9.4,
    holder_max_l=84.0, holder_max_w=28.0, holder_max_h=25.0,
    battery_bay_l=86.0, battery_bay_w=30.0,
    battery_cx=75.0, battery_cy=25.0, holder_base_z=6.4,
    pod_gap=8.0, pod_w=42.0, pod_h=80.0, pod_d=42.0, pod_y=7.0,
    sensor_max_w=26.0, sensor_max_h=38.0, sensor_max_depth=22.0,
    cable_duct_width=12.0, cable_duct_height=8.0,
    rear_board_support_z=66.6, esp_usb_y=52.0, charge_usb_y=82.0,
    usb_center_z=63.5, usb_width=20.0, usb_height=16.1, usb_slot_bottom_z=56.5,
    switch_bushing_hole=6.5, switch_x=75.0, switch_z=63.0,
    m3_clearance=3.4, m3_nut_af=5.9, m3_nut_thickness=2.8,
    m2_clearance=2.3, m2_nut_af=4.3, m2_nut_thickness=2.0,
    lip_clearance=0.45, lip_wall=1.4, lip_depth=2.0,
    honey_af=9.0, honey_web=1.8,
)

def box(x,y,z,w,h,d):
    return cq.Workplane('XY').box(w,h,d,centered=False).translate((x,y,z))

def rr(x,y,z,w,h,d,r):
    return box(x,y,z,w,h,d).edges('|Z').fillet(r)

def cylinder(x,y,z,r,h):
    return cq.Workplane('XY').center(x,y).circle(r).extrude(h).translate((0,0,z))

def hex_pocket(x,y,z,af,h):
    return cq.Workplane('XY').center(x,y).polygon(6,2*af/math.sqrt(3)).extrude(h).translate((0,0,z))

def honey_cutters(plane,rect,normal_start,thickness,exclude=(),af=None):
    """Open flat-top hexagons with a minimum solid web; only complete cells."""
    af=af or P['honey_af']; rr=af/math.sqrt(3)
    pitch=af+P['honey_web']; dx=pitch*math.sqrt(3)/2
    u0,v0,u1,v1=rect; shapes=[]
    i=0;u=u0+rr
    while u<=u1-rr+1e-5:
        v=v0+af/2+(i%2)*pitch/2
        while v<=v1-af/2+1e-5:
            bounds=(u-rr,v-af/2,u+rr,v+af/2)
            hit=any(not(bounds[2]<q[0] or bounds[0]>q[2] or bounds[3]<q[1] or bounds[1]>q[3]) for q in exclude)
            if not hit:
                s=cq.Workplane(plane).center(u,v).polygon(6,2*rr).extrude(thickness)
                offset={'XY':(0,0,normal_start),'YZ':(normal_start,0,0),'XZ':(0,normal_start,0)}[plane]
                shapes.append(s.translate(offset).val())
            v+=pitch
        i+=1;u=u0+rr+i*dx
    return cq.Compound.makeCompound(shapes) if shapes else None

def cut_honey(part,plane,rect,start,thickness,exclude=(),af=None):
    cut=honey_cutters(plane,rect,start,thickness,exclude,af)
    return part.cut(cut) if cut else part

def boss(x,y,z0,z1,size,hole,af,nut_z,nut_h,opening):
    """Sideloaded hex nut, opening along positive/negative X."""
    b=rr(x-size/2,y-size/2,z0,size,size,z1-z0,0.7)
    b=b.cut(cylinder(x,y,z0-0.1,hole/2,z1-z0+0.2))
    b=b.cut(hex_pocket(x,y,nut_z,af,nut_h))
    entry_x=x if opening>0 else x-size/2-0.2
    b=b.cut(box(entry_x,y-af/2,nut_z,size/2+0.2,af,nut_h))
    return b

def lcd_mounts(cx,cy):
    parts=[]
    for sx in [-1,1]:
        for sy in [-1,1]:
            x=cx+sx*P['lcd_hole_pitch_x']/2
            y=cy+sy*P['lcd_hole_pitch_y']/2
            b=boss(x,y,P['wall'],P['lcd_pcb_front_z'],6.8,
                   P['m2_clearance'],P['m2_nut_af'],5.2,
                   P['m2_nut_thickness'],sx)
            # Prevent square boss corners touching the metal LCD bezel.
            bezel=box(cx-(P['lcd_bezel_w']+0.8)/2,
                      cy-(P['lcd_bezel_h']+0.8)/2,2.39,
                      P['lcd_bezel_w']+0.8,P['lcd_bezel_h']+0.8,7.2)
            parts.append(b.cut(bezel))
    return parts

def main_screws():
    w,h=P['width'],P['height']
    return [(8,8),(w-8,8),(8,h-8),(w-8,h-8)]

def pod_origin():
    return P['width']+P['pod_gap'],P['pod_y']

def pod_screws():
    x,y=pod_origin()
    return [(x+5.5,y+5.5),(x+P['pod_w']-5.5,y+P['pod_h']-5.5)]

def side_usb_cut(x,y):
    # Open to the rear rim: a loaded cover can slide in with both USB ports.
    ww=P['usb_width']; z0=P['usb_slot_bottom_z']; z1=P['depth']+1
    pts=[(y-ww/2,z0),(y+ww/2,z0),(y+ww/2,z1),(y-ww/2,z1)]
    return cq.Workplane('YZ').polyline(pts).close().extrude(P['wall']+2).translate((x,0,0))

def front_shell(honey=True):
    w,h,d,t=P['width'],P['height'],P['depth'],P['wall']
    rim=d-t
    body=rr(0,0,0,w,h,rim,P['corner_r'])
    body=body.cut(rr(t,t,t,w-2*t,h-2*t,d,P['corner_r']-t))
    body=body.cut(rr(P['lcd_cx']-P['lcd_open_w']/2,
                     P['lcd_cy']-P['lcd_open_h']/2,-0.5,
                     P['lcd_open_w'],P['lcd_open_h'],t+1,0.5))
    for b in lcd_mounts(P['lcd_cx'],P['lcd_cy']): body=body.union(b)
    for x,y in main_screws():
        # These posts are cut only after the complete case/web union below.
        b=rr(x-5,y-5,t,10,10,rim-t,0.7)
        # Two short webs connect each long post to the case walls.
        x0=t-0.2 if x<w/2 else x
        ww=x-(t-0.2) if x<w/2 else w-t+0.2-x
        y0=t-0.2 if y<h/2 else y
        hh=y-(t-0.2) if y<h/2 else h-t+0.2-y
        body=body.union(b).union(box(x0,y-1,t,ww,2,rim-t))
        body=body.union(box(x-1,y0,t,2,hh,rim-t))
    # Battery tray. A commercial holder sits above two underfloor tie tunnels.
    bx,by=P['battery_cx'],P['battery_cy']
    bl,bw=P['battery_bay_l'],P['battery_bay_w']
    for xx in [bx-26,bx+26]:
        bar=box(xx-4,by-bw/2,t,8,bw,P['holder_base_z']-t)
        bar=bar.cut(box(xx-1.7,by-bw/2-0.2,t+0.8,3.4,bw+0.4,2.0))
        body=body.union(bar)
    for xx in [bx-bl/2-1.6,bx+bl/2]:
        body=body.union(box(xx,by-bw/2-0.1,t,1.6,bw+0.2,6.0))
    for yy in [by-bw/2-1.6,by+bw/2]:
        # Overlap the end rails; edge-only corner contact is not a manifold mesh.
        body=body.union(box(bx-bl/2-1.6,yy,t,bl+3.2,1.6,5.0))
    # Keep both tie entrances open after unioning the side rails.
    for xx in [bx-26,bx+26]:
        body=body.cut(box(xx-1.7,by-bw/2-1.8,t+0.8,3.4,bw+3.6,2.0))
    body=body.cut(side_usb_cut(-0.5,P['charge_usb_y']))
    body=body.cut(side_usb_cut(w-t-0.5,P['esp_usb_y']))
    # Round panel-mount switch; provisional M6 bushing, verify actual switch.
    sw=cq.Workplane('XZ').center(P['switch_x'],P['switch_z']).circle(P['switch_bushing_hole']/2).extrude(t+2).translate((0,h+1,0))
    body=body.cut(sw)
    # Small pod joined by an upper tab and a lower hollow cable bridge.
    px,py=pod_origin(); pw,ph,pd=P['pod_w'],P['pod_h'],P['pod_d']
    pod=rr(px,py,0,pw,ph,pd-t,4)
    pod=pod.cut(rr(px+t,py+t,t,pw-2*t,ph-2*t,pd,1.6))
    pod=cut_honey(pod,'XY',(px+6,py+20,px+pw-6,py+ph-13),-0.3,t+0.6,af=7.6)
    pod=cut_honey(pod,'YZ',(py+22,12,py+ph-18,33),px+pw-t-0.3,t+0.6,af=7.6)
    for x,y in pod_screws():
        b=rr(x-4.5,y-4.5,t,9,9,pd-2*t,0.7)
        # Connect pod posts to nearest wall without blocking the central bay.
        x0=px+t-0.2 if x<px+pw/2 else x
        ww=x-(px+t-0.2) if x<px+pw/2 else px+pw-t+0.2-x
        pod=pod.union(b).union(box(x0,y-1,t,ww,2,pd-2*t))
    duct_y=14.0; duct_w=P['cable_duct_width']
    bridge=box(w-t-0.2,duct_y-2,0,P['pod_gap']+2*t+0.4,duct_w+4,P['cable_duct_height']+6)
    body=body.union(pod).union(bridge)
    body=body.union(box(w-0.4,py+ph-16,0,P['pod_gap']+0.8,7,3.2))
    passage=box(w-t-0.6,duct_y,4,P['pod_gap']+2*t+1.2,
                duct_w,P['cable_duct_height'])
    body=body.cut(passage)
    # Recut nut spaces after adding wall webs, so the webs cannot fill a pocket.
    nut_cutters=[]
    for x,y in main_screws()+pod_screws():
        is_pod=x>w
        zz=(pd if is_pod else d)-8.8
        cutter=cylinder(x,y,t,P['m3_clearance']/2,(pd if is_pod else d)-t+0.2)
        size=9 if is_pod else 10
        inward=1 if (x<(px+pw/2) if is_pod else x<w/2) else -1
        # Core the long posts while retaining full material around the nut.
        cutter=cutter.union(cylinder(x,y,12,2.9,(pd if is_pod else d)-24))
        cutter=cutter.union(hex_pocket(x,y,zz,P['m3_nut_af'],P['m3_nut_thickness']))
        xx=x if inward>0 else x-size/2-0.2
        cutter=cutter.union(box(xx,y-P['m3_nut_af']/2,zz,size/2+0.2,P['m3_nut_af'],P['m3_nut_thickness']))
        nut_cutters.append(cutter.val())
    body=body.cut(cq.Compound.makeCompound(nut_cutters))
    if honey:
        # Preserve the tray rails, tie anchors and holder-contact end regions.
        protected=[(bx-bl/2-4,6,bx-bl/2+10,44),
                   (bx+bl/2-10,6,bx+bl/2+4,44),
                   (bx-30,6,bx-22,44),(bx+22,6,bx+30,44),
                   (bx-bl/2-3,37,bx+bl/2+3,44)]
        body=cut_honey(body,'XY',(16,15,w-16,59),-0.3,t+0.6,protected)
        body=cut_honey(body,'XY',(16,64,30,96),-0.3,t+0.6)
        body=cut_honey(body,'XY',(w-30,64,w-16,96),-0.3,t+0.6)
        # Left side is well away from the sensor pod.
        body=cut_honey(body,'YZ',(18,14,h-18,54),-0.3,t+0.6)
        # Right-side vents sit behind the pod, not directly beside its inlet.
        body=cut_honey(body,'YZ',(18,48,h-18,69),w-t-0.3,t+0.6,
                       [(P['esp_usb_y']-13,53,P['esp_usb_y']+13,74)])
        # Top and bottom panels keep solid corner frames and switch land.
        body=cut_honey(body,'XZ',(18,14,w-18,d-9),t+0.3,t+0.6)
        body=cut_honey(body,'XZ',(18,14,w-18,d-9),h+0.3,t+0.6,
                       [(P['switch_x']-11,P['switch_z']-11,P['switch_x']+11,P['switch_z']+11)])
    return body.clean()

def lip(w,h,t,z,rad,corner_cut=15):
    c,th=P['lip_clearance'],P['lip_wall']
    a=t+c
    part=rr(a,a,z,w-2*a,h-2*a,P['lip_depth'],max(0.8,rad-t-c))
    part=part.cut(rr(a+th,a+th,z-0.1,w-2*(a+th),h-2*(a+th),P['lip_depth']+0.2,0.6))
    for x in [0,w-corner_cut]:
        for y in [0,h-corner_cut]:
            part=part.cut(box(x,y,z-0.2,corner_cut,corner_cut,P['lip_depth']+0.4))
    return part

def rear_cover(honey=True):
    w,h,d,t=P['width'],P['height'],P['depth'],P['wall']
    p=rr(0,0,d-t,w,h,t,P['corner_r'])
    p=p.union(lip(w,h,t,d-t-P['lip_depth'],P['corner_r']))
    for x,y in main_screws(): p=p.cut(cylinder(x,y,d-6,P['m3_clearance']/2,7))
    # Generic adhesive pad areas plus tie slots; no invented PCB hole pattern.
    # (cx, cy, length along x, width along y)
    zones=[(17.4,82,30,24),(25,48,30,24),(130.45,52,34.3,25.4)]
    support=P['rear_board_support_z']
    for cx,cy,zw,zh in zones:
        # Skids under outer board edges. Add thin insulating foam as needed.
        for yy in [cy-zh/2+2.0,cy+zh/2-4.0]:
            p=p.union(box(cx-zw/2+3,yy,support,zw-6,2,d-t-support))
        for yy in [cy-zh/2-1.9,cy+zh/2+0.5]:
            p=p.cut(rr(cx-4.5,yy,d-t-0.2,9,1.4,t+0.4,0.35))
    # Vent the electronics chamber at the top, away from the lower sensor inlet.
    for yy in [90,96,102]:
        p=p.cut(rr(48,yy,d-t-0.2,47,2.6,t+0.4,0.7))
    if honey:
        exclude=[]
        for cx,cy,zw,zh in zones:
            exclude.append((cx-zw/2-4,cy-zh/2-4,cx+zw/2+4,cy+zh/2+4))
        exclude.extend([(44,86,99,107),(62,91,88,110)])
        p=cut_honey(p,'XY',(17,15,w-17,h-16),d-t-0.3,t+0.6,exclude)
    return p.clean()

def pod_cover():
    t=P['wall']; px,py=pod_origin(); w,h,d=P['pod_w'],P['pod_h'],P['pod_d']
    p=rr(px,py,d-t,w,h,t,4)
    p=p.union(lip(w,h,t,d-t-P['lip_depth'],4,12).translate((px,py,0)))
    for x,y in pod_screws(): p=p.cut(cylinder(x,y,d-6,P['m3_clearance']/2,7))
    # Two supports and four rear strap slots hold a breakout PCB, not its grille.
    cx,cy=px+w/2,py+43
    for xx in [cx-11,cx+9]:
        p=p.union(box(xx,cy-17,d-t-4,2,34,4))
    for xx in [cx-15,cx+13.6]:
        for yy in [cy-12,cy+7]:
            p=p.cut(rr(xx,yy,d-t-0.2,1.4,5,t+0.4,0.35))
    p=cut_honey(p,'XY',(cx-7,cy-18,cx+7,cy+18),d-t-0.3,t+0.6,af=7.6)
    return p.clean()

def lcd_coupon():
    cx,cy=45,23
    p=rr(0,0,0,90,46,P['wall'],3)
    p=p.cut(rr(cx-P['lcd_open_w']/2,cy-P['lcd_open_h']/2,-0.2,
                 P['lcd_open_w'],P['lcd_open_h'],P['wall']+0.4,0.5))
    for b in lcd_mounts(cx,cy): p=p.union(b)
    return p.clean()

def fastener_coupon():
    p=rr(0,0,0,62,22,2.4,2)
    p=p.union(boss(10,11,2.4,12,10,P['m3_clearance'],P['m3_nut_af'],5,2.8,1))
    p=p.union(boss(30,11,2.4,9.4,6.8,P['m2_clearance'],P['m2_nut_af'],5.2,2.0,-1))
    # The real 12 x 8 mm sensor-connector opening, including a bridge test.
    duct=box(42,4,2.4,16,14,12)
    duct=duct.cut(box(44,3.8,4.4,12,14.4,8))
    p=p.union(duct)
    return p.clean()

def orient_for_print(part,kind):
    if kind=='rear': return part.rotate((0,0,0),(1,0,0),180).translate((0,P['height'],P['depth']))
    if kind=='pod':
        px,py=pod_origin()
        return part.translate((-px,-py,0)).rotate((0,0,0),(1,0,0),180).translate((0,P['pod_h'],P['pod_d']))
    return part

def printable_parts():
    return {
        '01_LCD_Fit_Test':lcd_coupon(),
        '02_Fastener_Fit_Test':fastener_coupon(),
        '03_Main_Shell_With_Sensor_Pod':front_shell(),
        '04_Main_Rear_Cover':orient_for_print(rear_cover(),'rear'),
        '05_Sensor_Pod_Rear_Cover':orient_for_print(pod_cover(),'pod'),
    }

def component_solids():
    """Illustrative size envelopes only, never sent to the printable 3MF."""
    cx,cy=P['lcd_cx'],P['lcd_cy']; px,py=pod_origin()
    out={}
    out['LCD PCB']=box(cx-40,cy-18,9.4,80,36,1.6)
    bezel=rr(cx-35.6,cy-12.6,0.5,71.2,25.2,8.9,0.8)
    bezel=bezel.cut(box(cx-33,cy-8,0.3,66,16,2))
    out['LCD bezel']=bezel
    out['LCD glass']=box(cx-33,cy-8,0.9,66,16,0.4)
    holder=box(33,11,6.4,84,28,3)
    holder=holder.union(box(33,11,6.4,4,28,25))
    holder=holder.union(box(113,11,6.4,4,28,25))
    out['Battery holder']=holder
    out['21700 cell']=cq.Workplane('YZ').center(25,20.4).circle(10.5).extrude(70).translate((40,0,0))
    out['ESP32 S2 Mini PCB']=box(113.3,39.3,65,34.3,25.4,1.6)
    out['ESP USB']=rr(142,47.8,61.6,8,8.4,3.4,0.6)
    out['ESP chip']=box(121,47,63.2,6,6,1.8)
    out['Charger PCB']=box(2.4,70,65,30,24,1.6)
    out['Charge USB']=rr(0.5,77.8,61.6,8,8.4,3.4,0.6)
    out['Boost PCB']=box(10,36,65,30,24,1.6)
    out['Boost inductor']=box(18,43,60,8,8,5)
    out['DHT breakout']=box(px+10,py+27,34,22,32,1.6)
    out['DHT11 body']=box(px+15,py+38,28.5,12,15.5,5.5)
    return out

def mesh_data(part,tol=0.12):
    vs,fs=part.val().tessellate(tol,0.16)
    return [tuple(v.toTuple()) for v in vs],[tuple(f) for f in fs]

def write_3mf(parts,path):
    ns='http://schemas.microsoft.com/3dmanufacturing/core/2015/02'
    ET.register_namespace('',ns)
    root=ET.Element('{%s}model'%ns,{'unit':'millimeter','xml:lang':'en-US'})
    ET.SubElement(root,'{%s}metadata'%ns,{'name':'Title'}).text='Weather Station V1 - geometry only; fit tests first'
    resources=ET.SubElement(root,'{%s}resources'%ns); build=ET.SubElement(root,'{%s}build'%ns)
    # Bounding rectangle 254 x 244 mm. Fits a 300 mm-class bed; no slicer settings.
    positions={
      '03_Main_Shell_With_Sensor_Pod':(0,0),
      '04_Main_Rear_Cover':(0,122),
      '05_Sensor_Pod_Rear_Cover':(212,0),
      '01_LCD_Fit_Test':(162,122),
      '02_Fastener_Fit_Test':(165,180),
    }
    for i,(name,part) in enumerate(parts.items(),1):
        obj=ET.SubElement(resources,'{%s}object'%ns,{'id':str(i),'type':'model','name':name})
        mesh=ET.SubElement(obj,'{%s}mesh'%ns);verts=ET.SubElement(mesh,'{%s}vertices'%ns)
        vs,fs=mesh_data(part)
        for v in vs: ET.SubElement(verts,'{%s}vertex'%ns,dict(zip(['x','y','z'],[f'{q:.6f}' for q in v])))
        tris=ET.SubElement(mesh,'{%s}triangles'%ns)
        for f in fs: ET.SubElement(tris,'{%s}triangle'%ns,dict(zip(['v1','v2','v3'],map(str,f))))
        x,y=positions[name]
        ET.SubElement(build,'{%s}item'%ns,{'objectid':str(i),'transform':f'1 0 0 0 1 0 0 0 1 {x} {y} 0'})
    content_types='<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>'
    relationships='<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>'
    with zipfile.ZipFile(path,'w',zipfile.ZIP_DEFLATED) as z:
        z.writestr('[Content_Types].xml',content_types)
        z.writestr('_rels/.rels',relationships)
        z.writestr('3D/3dmodel.model',ET.tostring(root,encoding='utf-8',xml_declaration=True))

def generate():
    (OUT/'STL').mkdir(exist_ok=True)
    parts=printable_parts(); info={}
    for name,p in parts.items():
        shape=p.val(); bb=shape.BoundingBox()
        assert shape.isValid(),name+' is invalid'
        assert len(p.solids().vals())==1,name+' must be one connected solid'
        cq.exporters.export(p,str(OUT/'STL'/f'{name}.stl'),tolerance=0.10,angularTolerance=0.15)
        info[name]={'bounds_mm':[round(bb.xlen,3),round(bb.ylen,3),round(bb.zlen,3)],
                    'volume_cm3':round(shape.Volume()/1000,3),'valid_solid':shape.isValid()}
        print(name,info[name],flush=True)
    actual=sum(info[k]['volume_cm3'] for k in info if k.startswith(('03','04','05')))
    baseline=(front_shell(False).val().Volume()+rear_cover(False).val().Volume()+pod_cover().val().Volume())/1000
    info['material_comparison']={'honeycomb_geometry_cm3':round(actual,3),
         'same_enclosure_without_extra_honeycomb_cm3':round(baseline,3),
         'geometry_reduction_percent':round(100*(baseline-actual)/baseline,1),
         'note':'Geometric solid volume, not slicer filament usage; excludes fit coupons.'}
    print('material_comparison',info['material_comparison'],flush=True)
    assembly=cq.Assembly(name='Weather_Station_V1_Plastic_Assembly')
    assembly.add(front_shell(),name='Main_shell_and_pod',color=cq.Color(0.84,0.88,0.91))
    assembly.add(rear_cover(),name='Main_rear_cover',color=cq.Color(0.16,0.25,0.30))
    assembly.add(pod_cover(),name='Sensor_rear_cover',color=cq.Color(0.16,0.25,0.30))
    assembly.export(str(OUT/'Weather_Station_V1.step'))
    write_3mf(parts,OUT/'Weather_Station_V1_Parts.3mf')
    (OUT/'design_parameters.json').write_text(json.dumps(P,indent=2))
    (OUT/'geometry_report.json').write_text(json.dumps(info,indent=2))
    # Rendering interchange keeps illustrative electronics distinct from printable parts.
    meshes={name:{'v':mesh_data(p)[0],'f':mesh_data(p)[1]} for name,p in parts.items()}
    for name,p in [('assembled_rear',rear_cover()),('assembled_pod_rear',pod_cover())]+list(component_solids().items()):
        v,f=mesh_data(p);meshes[name]={'v':v,'f':f}
    (OUT/'render_meshes.json').write_text(json.dumps(meshes,separators=(',',':')))
    return parts

if __name__=='__main__': generate()
