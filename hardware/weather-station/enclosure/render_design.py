"""CPU render of the actual CAD meshes; no generated or invented geometry."""
from pathlib import Path
import json, math
import os
import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT=Path(__file__).resolve().parent
MESH=json.loads((ROOT/'render_meshes.json').read_text())
P=json.loads((ROOT/'design_parameters.json').read_text())
FONT=os.environ.get('WEATHER_FONT', 'DejaVuSans.ttf')
BOLD=os.environ.get('WEATHER_BOLD_FONT', 'DejaVuSans-Bold.ttf')

def fnt(size,bold=False): return ImageFont.truetype(BOLD if bold else FONT,size)

COLORS={
'03_Main_Shell_With_Sensor_Pod':(190,215,220),
'assembled_rear':(60,88,100),'assembled_pod_rear':(60,88,100),
'LCD PCB':(42,119,83),'LCD bezel':(29,42,46),'LCD glass':(19,71,106),
'Battery holder':(46,54,59),'21700 cell':(235,147,51),
'ESP32 S2 Mini PCB':(125,80,174),'ESP USB':(185,193,199),'ESP chip':(43,45,48),
'Charger PCB':(38,113,157),'Charge USB':(185,193,199),
'Boost PCB':(30,133,151),'Boost inductor':(62,67,70),
'DHT breakout':(44,112,83),'DHT11 body':(53,144,204),
}

def projection(normal,target,scale,w,h):
    n=np.array(normal,float);n/=np.linalg.norm(n)
    right=np.cross(n,[0,1,0]);right/=np.linalg.norm(right)
    up=np.cross(right,n)
    mat=np.stack([right,up,n],axis=1)
    target=np.array(target,float)
    def project(points):
        v=(np.array(points,float)-target)@mat
        return np.stack([w/2+v[:,0]*scale,h/2-v[:,1]*scale,v[:,2]],axis=1)
    return project,n

def render(names,normal,target,w=1600,h=1050,scale=5.8):
    project,n=projection(normal,target,scale,w,h)
    img=np.empty((h,w,3),np.uint8);img[:]=[248,250,251]
    zbuf=np.full((h,w),-1e10,dtype=np.float32)
    light=np.array([-0.35,0.72,-0.62]);light/=np.linalg.norm(light)
    if normal[2]>0:
        light=np.array([0.25,0.75,0.6]);light/=np.linalg.norm(light)
    triangles=[]
    for name in names:
        data=MESH[name]; vv=np.array(data['v']); ff=np.array(data['f']); sp=project(vv)
        col=np.array(COLORS.get(name,(200,210,216)),float)
        for face in ff:
            a,b,c=vv[face]
            norm=np.cross(b-a,c-a);ln=np.linalg.norm(norm)
            if ln<1e-10: continue
            norm/=ln
            # Surface winding from the tessellator is retained; both sides can draw.
            shade=0.50+0.43*max(0,float(norm@light))+0.07*abs(float(norm@n))
            color=np.clip(col*shade,0,255).astype(np.uint8)
            triangles.append((sp[face],color))
    for p,color in triangles:
        xmin=max(0,int(math.floor(p[:,0].min())));xmax=min(w-1,int(math.ceil(p[:,0].max())))
        ymin=max(0,int(math.floor(p[:,1].min())));ymax=min(h-1,int(math.ceil(p[:,1].max())))
        if xmax<xmin or ymax<ymin: continue
        x0,y0,z0=p[0];x1,y1,z1=p[1];x2,y2,z2=p[2]
        den=(y1-y2)*(x0-x2)+(x2-x1)*(y0-y2)
        if abs(den)<1e-9:continue
        xx,yy=np.meshgrid(np.arange(xmin,xmax+1)+.5,np.arange(ymin,ymax+1)+.5)
        aa=((y1-y2)*(xx-x2)+(x2-x1)*(yy-y2))/den
        bb=((y2-y0)*(xx-x2)+(x0-x2)*(yy-y2))/den
        cc=1-aa-bb
        zz=aa*z0+bb*z1+cc*z2
        region=zbuf[ymin:ymax+1,xmin:xmax+1]
        mask=(aa>=-1e-5)&(bb>=-1e-5)&(cc>=-1e-5)&(zz>=region)
        region[mask]=zz[mask]
        img[ymin:ymax+1,xmin:xmax+1][mask]=color
    return Image.fromarray(img),project

def display_texture():
    g={
    ' ':['00000']*7,
    'T':['11111','00100','00100','00100','00100','00100','00100'],
    'E':['11111','10000','10000','11110','10000','10000','11111'],
    'M':['10001','11011','10101','10101','10001','10001','10001'],
    'P':['11110','10001','10001','11110','10000','10000','10000'],
    'H':['10001','10001','10001','11111','10001','10001','10001'],
    'U':['10001','10001','10001','10001','10001','10001','01110'],
    'R':['11110','10001','10001','11110','10100','10010','10001'],
    'C':['01110','10001','10000','10000','10000','10001','01110'],
    ':':['00000','00100','00100','00000','00100','00100','00000'],
    '.':['00000','00000','00000','00000','00000','00100','00100'],
    '%':['11001','11010','00100','01000','10110','00110','00000'],
    '0':['01110','10001','10011','10101','11001','10001','01110'],
    '2':['01110','10001','00001','00010','00100','01000','11111'],
    '3':['11110','00001','00001','01110','00001','00001','11110'],
    '4':['00010','00110','01010','10010','11111','00010','00010'],
    '8':['01110','10001','10001','01110','10001','10001','01110']}
    im=Image.new('RGB',(792,192),(14,66,104));d=ImageDraw.Draw(im)
    for row,text in enumerate(['TEMP: 23.0 C    ','HUM : 48 % RH   ']):
        for k,ch in enumerate(text[:16]):
            pattern=g.get(ch,g[' '])
            for yy,line in enumerate(pattern):
                for xx,bit in enumerate(line):
                    if bit=='1':
                        x=14+k*48+xx*8;y=17+row*94+yy*8
                        d.rectangle((x,y,x+5,y+6),fill=(169,235,221))
    return im

def apply_screen(im,project):
    # Source pixel corners map to the exact 66 x 16 mm LCD viewing rectangle.
    cx,cy=P['lcd_cx'],P['lcd_cy']
    dst=project([(cx-33,cy+8,.8),(cx+33,cy+8,.8),(cx+33,cy-8,.8),(cx-33,cy-8,.8)])[:,:2]
    tex=display_texture().convert('RGBA');src=[(0,0),(792,0),(792,192),(0,192)]
    aa=[];bb=[]
    for (x,y),(u,v) in zip(dst,src):
        aa.extend([[x,y,1,0,0,0,-u*x,-u*y],[0,0,0,x,y,1,-v*x,-v*y]])
        bb.extend([u,v])
    coef=np.linalg.solve(np.array(aa),np.array(bb))
    layer=tex.transform(im.size,Image.Transform.PERSPECTIVE,coef,Image.Resampling.BICUBIC)
    return Image.alpha_composite(im.convert('RGBA'),layer).convert('RGB')

def card(draw,x,y,w,title,value):
    draw.rounded_rectangle((x,y,x+w,y+98),radius=14,fill=(232,241,243))
    draw.text((x+20,y+16),title,font=fnt(18),fill=(71,94,105))
    draw.text((x+20,y+47),value,font=fnt(25,True),fill=(20,53,66))

def make_preview():
    names=['03_Main_Shell_With_Sensor_Pod','assembled_rear','assembled_pod_rear']+list(COLORS)[3:]
    # Deduplicate and keep only meshes.
    names=list(dict.fromkeys(n for n in names if n in MESH))
    im,proj=render(names,(.55,.34,-1),(100,54,29),1600,1000,6.15)
    im=apply_screen(im,proj)
    canvas=Image.new('RGB',(1760,1370),(248,250,251));canvas.paste(im,(80,175))
    d=ImageDraw.Draw(canvas)
    d.text((75,52),'WEATHER STATION',font=fnt(43,True),fill=(18,52,67))
    d.text((77,113),'Room for jumper wires. A lighter honeycomb shell.',font=fnt(26),fill=(76,99,110))
    d.rounded_rectangle((1450,58,1685,110),radius=26,fill=(225,239,235))
    d.text((1481,70),'PRINTABLE V1',font=fnt(22,True),fill=(45,106,88))
    # Callout to the detached-air sensor chamber.
    podpt=proj([(183,54,0)])[0]+np.array([80,175,0])
    d.line([(1510,267),(1560,267),(float(podpt[0]),float(podpt[1]))],fill=(67,113,130),width=3)
    d.text((1235,211),'DHT11 sensor pod',font=fnt(23,True),fill=(27,75,94))
    d.text((1235,243),'8 mm air gap from main box',font=fnt(18),fill=(76,99,110))
    y=1160;cw=390
    card(d,75,y,cw,'MAIN BOX','150 x 110 x 75 mm')
    card(d,480,y,cw,'OVERALL, WITH POD','200 x 110 x 75 mm')
    card(d,885,y,cw,'CONNECTOR PASSAGE','12 x 8 mm')
    card(d,1290,y,395,'RECHARGEABLE BATTERY','1 x 21700 in holder')
    d.text((77,1300),'Print the LCD and fastener/connector tests first. Component sizes are provisional; display values are illustrative.',font=fnt(20),fill=(94,110,118))
    canvas.save(ROOT/'Weather_Station_V1_Preview.png')
    return canvas

def make_inside():
    names=['03_Main_Shell_With_Sensor_Pod']+[n for n in COLORS if n not in ['03_Main_Shell_With_Sensor_Pod','assembled_rear','assembled_pod_rear']]
    im,proj=render(names,(.35,.30,1),(100,55,35),1560,1070,5.9)
    canvas=Image.new('RGB',(1760,1420),(248,250,251));canvas.paste(im,(100,170))
    d=ImageDraw.Draw(canvas)
    d.text((75,48),'COMPONENT LAYOUT',font=fnt(41,True),fill=(18,52,67))
    d.text((77,110),'Rear covers hidden to show the mounting positions and wire space.',font=fnt(24),fill=(76,99,110))
    notes=[('1','LCD 1602A','Mounted to front'),('2','21700 + holder','Below display'),('3','ESP32-S2 Mini','On rear cover'),('4','Charger + 5 V boost','On rear cover'),('5','DHT11','Separate air chamber')]
    pts=[(75,80,12),(75,25,32),(132,52,68),(19,74,68),(179,51,37)]
    for number,label,sub in notes:
        i=int(number)-1;pp=proj([pts[i]])[0];x,y=pp[0]+100,pp[1]+170
        d.ellipse((x-19,y-19,x+19,y+19),fill=(15,68,89),outline=(255,255,255),width=2)
        d.text((x-7,y-13),number,font=fnt(20,True),fill='white')
        lx=75+i*336
        d.text((lx,1240),f'{number}  {label}',font=fnt(20,True),fill=(18,52,67))
        d.text((lx,1277),sub,font=fnt(18),fill=(76,99,110))
    d.text((77,1355),'Illustrative hardware envelopes. Route flexible jumper loops through the clear centre; keep the ESP antenna free of wire bundles.',font=fnt(20),fill=(94,110,118))
    canvas.save(ROOT/'Weather_Station_V1_Inside.png')
    return canvas

if __name__=='__main__':
    make_preview();print('Preview ready',flush=True)
    make_inside();print('Inside view ready',flush=True)
