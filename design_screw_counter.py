"""ScrewCounter revision 4. Python 3.10+, CadQuery 2.6+; all dimensions in mm.
Edit SETTINGS or use CLI: --rows 4 --columns 10 --screw M2 --joint screws.
Rows = screws per batch. Columns = number of batches. +X = pull direction.
Preset head sizes are design assumptions, NOT screw-standard guarantees.
"""
from dataclasses import dataclass, replace, asdict
from pathlib import Path
import argparse, json, math
import cadquery as cq

@dataclass(frozen=True)
class Settings:
    detent: bool = True              # one light click per batch
    detent_spring_width: float = 1.2  # in-plane beam width; tune gently
    rows: int = 4
    columns: int = 10
    screw: str = 'M2'                 # 'M1.5', 'M2', 'M3'
    joint: str = 'screws'             # 'screws' (4 x M2x8) or 'glue'
    magnet_diameter: float = 6.0
    magnet_thickness: float = 2.0
    magnet_diameter_clearance: float = 0.3
    magnet_depth_clearance: float = 0.15
    slide_clearance: float = 0.3      # per side, also above/below slider
    head_diameter: float | None = None # max measured head diameter; overrides preset
    shaft_diameter: float | None = None
    slot_width: float | None = None
    pitch: float | None = None

# CHANGE THESE THREE VALUES FOR A DIFFERENT CAPACITY / SCREW:
SETTINGS = Settings(rows=4, columns=10, screw='M2', joint='screws')
PRESETS = {
    'M1.5': {'shaft': 1.5, 'head': 3.0, 'slot': 2.1, 'pitch': 8.0},
    'M2':   {'shaft': 2.0, 'head': 4.4, 'slot': 2.6, 'pitch': 8.0},
    'M3':   {'shaft': 3.0, 'head': 6.0, 'slot': 3.6, 'pitch': 10.0},
}

def box(x,y,z,dx,dy,dz):
    return cq.Workplane('XY').box(dx,dy,dz,centered=False).translate((x,y,z))
def cylinder(x,y,z,r,h):
    return cq.Workplane('XY').workplane(offset=z).center(x,y).circle(r).extrude(h)
def rounded(x,y,z,dx,dy,dz,r):
    return box(x,y,z,dx,dy,dz).edges('|Z').fillet(r)
def dimension(c):
    if c.screw not in PRESETS: raise ValueError('screw must be M1.5, M2 or M3')
    if type(c.rows) is not int or type(c.columns) is not int or c.rows<1 or c.columns<1:
        raise ValueError('rows and columns must be positive integers')
    if c.joint not in ('screws','glue'): raise ValueError('joint must be screws or glue')
    if not (3<=c.magnet_diameter<=8 and 1<=c.magnet_thickness<=3):
        raise ValueError('Supported magnet range: diameter 3..8, thickness 1..3')
    if not (.15<=c.slide_clearance<=.6): raise ValueError('slide_clearance must be .15.. .6')
    if not (0<=c.magnet_diameter_clearance<=.6 and 0<=c.magnet_depth_clearance<=.3):
        raise ValueError('Magnet clearance outside supported range')
    if not (1.0<=c.detent_spring_width<=1.5): raise ValueError('detent_spring_width must be 1.0..1.5')
    p=PRESETS[c.screw]
    shaft=p['shaft'] if c.shaft_diameter is None else c.shaft_diameter
    head=p['head'] if c.head_diameter is None else c.head_diameter
    slot=p['slot'] if c.slot_width is None else c.slot_width
    if not (shaft>0 and shaft+.3<=slot<=head-.6):
        raise ValueError('Need shaft+0.3 <= slot <= head-0.6; measure actual screw')
    drop=head+1.2; window=head+1.6
    pitch=(max(p['pitch'], math.ceil(window+2)) if c.pitch is None else c.pitch)
    if pitch<window+1.8: raise ValueError('Pitch needs >= window+1.8 for separated batches')
    rim=max(10.,c.magnet_diameter+4)
    wall=rim-1.3; sy=wall+c.slide_clearance
    margin=max(rim+drop/2+1.5,sy+window/2+2.5)
    if c.detent: margin=max(margin,sy+window/2+c.detent_spring_width+2.3)
    release_x=max(14.,8+window/2+2)
    xs=[release_x+pitch*(i+1) for i in range(c.columns)]
    ys=[margin+pitch*i for i in range(c.rows)]
    length=xs[-1]+rim+drop/2+1.5
    width=2*margin+(c.rows-1)*pitch
    # Keep a usable lid opening, guide width and handle even for a single row.
    width=max(width,2*rim+12)
    ys=[width/2 + pitch*(i-(c.rows-1)/2) for i in range(c.rows)]
    floor=1.6; sz=floor+c.slide_clearance; thickness=2
    join_z=sz+thickness+c.slide_clearance
    deck_top=join_z+3
    top=max(14.,deck_top+6.8)
    return dict(shaft=shaft,head=head,slot=slot,drop=drop,window=window,pitch=pitch,
                rim=rim,wall=wall,sy=sy,release_x=release_x,xs=xs,ys=ys,L=length,W=width,
                floor=floor,sz=sz,t=thickness,join_z=join_z,deck_top=deck_top,top=top)

def build(c=SETTINGS):
    d=dimension(c); L,W=d['L'],d['W']; rim=d['rim']; wall=d['wall']; J=d['join_z']; T=d['top']
    # Lower guide: an open U channel. No hidden roof is printed here.
    base=rounded(0,0,0,L,W,J,4)
    base=base.cut(box(7.7,wall,d['floor'],L,W-2*wall,J+1))
    base=base.cut(box(7.7,wall+3,-.1,L,W-2*(wall+3),J+1))
    # Upper tray: continuous flat underside; vertical holes, upright perimeter wall.
    deck=rounded(0,0,J,L,W,3,4)
    rim_part=rounded(0,0,d['deck_top'],L,W,T-d['deck_top'],4)
    rim_part=rim_part.cut(rounded(rim,rim,d['deck_top']-.1,L-2*rim,W-2*rim,T,3))
    rim_part=rim_part.edges('>Z').fillet(.65)
    tray=deck.union(rim_part)
    for x in d['xs']:
        for y in d['ys']:
            tray=tray.cut(cylinder(x,y,J-.1,d['drop']/2,3.3))
            cone=cq.Solid.makeCone(d['drop']/2,d['drop']/2+.6,.6,cq.Vector(x,y,d['deck_top']-.6))
            tray=tray.cut(cone)
    # Four hollow registration bosses. Underneath: glue or separate M2 assembly screws.
    # Locations are distinct from the magnets and the screw-counting apertures.
    joint_x=[min(18.,L/2-4),max(L-18.,L/2+4)]
    joints=[(x,y) for x in joint_x for y in [wall/2,W-wall/2]]
    for x,y in joints:
        peg=cylinder(x,y,J,2,1.2).edges('>Z').chamfer(.2)
        base=base.union(peg)
        tray=tray.cut(cylinder(x,y,J-.05,2.2,1.5))
        if c.joint=='screws':
            base=base.cut(cylinder(x,y,-.1,1.2,J+1.5))
            base=base.cut(cylinder(x,y,-.1,2.3,2.3))
            tray=tray.cut(cylinder(x,y,J+1.4,.85,5.6))
    # Moving comb: rounded release windows, rounded slot ends, rounded grip.
    sy=d['sy']; sw=W-2*sy; z=d['sz']; h=d['t']; last=d['xs'][-1]
    slider=rounded(8,sy,z,L-8,sw,h,1.5)
    grip=rounded(L,sy-3,z,19,sw+6,h,3)
    slider=slider.union(grip)
    slider=slider.cut(rounded(L+5,sy+3,z-.1,8,sw-6,h+.2,2))
    for y in d['ys']:
        long_slot=rounded(d['release_x']-1,y-d['slot']/2,z-.1,
                          last+3-(d['release_x']-1),d['slot'],h+.2,d['slot']/2-.02)
        window=rounded(d['release_x']-d['window']/2,y-d['window']/2,z-.1,
                       d['window'],d['window'],h+.2,.65)
        slider=slider.cut(long_slot.union(window))
    # Integral planar leaf spring on the side opposite the index scale.
    # Free tip x=12, root x=27; flexible length approximately 15 mm.
    # Relief is through-cut: the slider remains flat-printable, no supports.
    if c.detent:
        edge=W-sy; bw=c.detent_spring_width; gap=1.2
        slit=rounded(10,edge-bw-gap,z-.1,17,gap,h+.2,.45)
        mouth=box(10,edge-bw-gap+.4,z-.1,.8,bw+gap+2,h+.2)
        slider=slider.cut(slit.union(mouth))
        # Free semicircular protrusion blends into the spring tip.
        nose_y=edge-.2
        nose=cylinder(12,nose_y,z,1.0,h)
        slider=slider.union(nose)
        notch_x=[12+k*d['pitch'] for k in range(c.columns+1)]
        for nx in notch_x:
            base=base.cut(cylinder(nx,nose_y,-.1,1.2,J+.2))
        d['detent']={'tip_x':12.,'tip_y':nose_y,'nose_radius':1.,
                     'notch_radius':1.2,'notch_x':notch_x,'spring_length':15.,
                     'spring_width':bw,'spring_height':h,'relief_gap':gap,
                     'nominal_deflection':.8-c.slide_clearance,
                     'max_lateral_deflection':.8,
                     'note':'Elastic interference between stops is intentional; forces not calibrated.'}
    # Scale is revealed at the front edge as the slider is pulled.
    for i in range(c.columns+1):
        x=L-d['pitch']*i
        slider=slider.cut(box(x-.18,sy+.65,z+h-.3,.36,2.3,.4))
        number=cq.Workplane('XY').text(str(i),2.3,.4,combine=True).translate((x+1.8,sy+2,z+h-.3))
        slider=slider.cut(number)
    # Lid printed upside down: all four magnet pockets and locating lip face UP.
    lid=rounded(0,0,T,L,W,3.4,4)
    tab=rounded(L-1,W/2-7,T,6,14,3.4,2.5)
    lid=lid.union(tab).edges('>Z').fillet(.6)
    lip_outer=rounded(rim+.35,rim+.35,T-1.2,L-2*rim-.7,W-2*rim-.7,1.3,3.35)
    lip_inner=rounded(rim+1.75,rim+1.75,T-1.3,L-2*rim-3.5,W-2*rim-3.5,1.5,2)
    lid=lid.union(lip_outer.cut(lip_inner))
    mc=rim/2+.5
    magnets=[(x,y) for x in [mc,L-mc] for y in [mc,W-mc]]
    mr=(c.magnet_diameter+c.magnet_diameter_clearance)/2
    md=c.magnet_thickness+c.magnet_depth_clearance
    for x,y in magnets:
        tray=tray.cut(cylinder(x,y,T-md,mr,md+.1))
        lid=lid.cut(cylinder(x,y,T-.1,mr,md+.1))
    d.update(joints=joints,magnets=magnets,magnet_pocket_diameter=2*mr,magnet_pocket_depth=md)
    return {'base':base,'tray':tray,'slider':slider,'lid':lid},d

def common_volume(a,b):
    return sum(s.Volume() for s in a.intersect(b).solids().vals())
def verify(parts,d,c,full=True):
    result=[]
    for name,p in parts.items():
        assert len(p.solids().vals())==1 and p.val().isValid(),name+' invalid'
    names=list(parts)
    for i,a in enumerate(names):
        for b in names[i+1:]:
            v=common_volume(parts[a],parts[b]);assert v<1e-5,(a,b,v)
    result.append('4 valid single solids; no pairwise assembly interference')
    # Sample all release stations; between stations slider has constant rail profile.
    stations=range(c.columns+1) if full else [0,1,c.columns]
    for k in stations:
        moving=parts['slider'].translate((k*d['pitch'],0,0))
        for fixed in ['base','tray']:
            assert common_volume(parts[fixed],moving)<1e-5,(k,fixed)
        if k:
            x=d['xs'][k-1]
            for y in d['ys']:
                head=cylinder(x,y,-1,d['head']/2,d['deck_top']+2)
                for name,p in [('slider',moving),('tray',parts['tray']),('base',parts['base'])]:
                    assert common_volume(p,head)<1e-5,('release',k,name)
        # Heads in still-loaded columns must remain supported, shafts must fit.
        remaining=d['xs'][k:] if full else d['xs'][k:k+1]
        for x in remaining:
            for y in d['ys']:
                assert common_volume(moving,cylinder(x,y,d['sz']-.1,d['shaft']/2,d['t']+.2))<1e-5
                assert common_volume(moving,cylinder(x,y,d['sz'],d['head']/2,d['t']))>.5
    result.append('Release, retention and shaft clearance verified at selected stations')
    # Ideal 6x2 magnets fit their recesses and do not intersect the registration/fastener axes.
    md=d['magnet_pocket_depth'];r=c.magnet_diameter/2
    for x,y in d['magnets']:
        assert common_volume(parts['tray'],cylinder(x,y,d['top']-md,r,c.magnet_thickness))<1e-5
        assert common_volume(parts['lid'],cylinder(x,y,d['top']+md-c.magnet_thickness,r,c.magnet_thickness))<1e-5
        for jx,jy in d['joints']:
            assert math.hypot(x-jx,y-jy)>(d['magnet_pocket_diameter']/2+2.3+.5)
    if c.detent:
        # The undeformed spring is fully relaxed in each notch. Between notches,
        # only its nose may contact the rail; the main plate remains clear.
        dt=d['detent']; tip=cylinder(dt['tip_x'],dt['tip_y'],d['sz'],1,d['t'])
        rigid=parts['slider'].cut(tip)
        for fraction in [.25,.5,.75]:
            dx=d['pitch']*fraction
            assert common_volume(parts['base'],rigid.translate((dx,0,0)))<1e-5
            # Worst-case tip displaced inward 0.8 mm stays clear of the rail.
            assert common_volume(parts['base'],tip.translate((dx,-.8,0)))<1e-5
        assert dt['relief_gap']>dt['max_lateral_deflection']+.2
        result.append('Detent stations coincide with releases; inter-station contact confined to elastic nose; 0.8 mm tip travel clears rail')
    return result

def export(c,out,prefix=None,full=True):
    out=Path(out);out.mkdir(parents=True,exist_ok=True)
    parts,d=build(c); checks=verify(parts,d,c,full)
    prefix=prefix or f'ScrewCounter_{c.screw.replace(".","p")}_{c.rows}x{c.columns}'
    colors={'base':(.22,.31,.37),'tray':(.23,.51,.60),'slider':(.94,.65,.30),'lid':(.71,.79,.82)}
    a=cq.Assembly(name=prefix)
    for name,p in parts.items():a.add(p,name=name,color=cq.Color(*colors[name]))
    a.save(str(out/(prefix+'.step')))
    for name,p in parts.items():
        if name=='lid': p=p.rotate((0,0,0),(1,0,0),180)
        b=p.val().BoundingBox();p=p.translate((-b.xmin,-b.ymin,-b.zmin))
        cq.exporters.export(p,str(out/(prefix+'_'+name+'.stl')),tolerance=.04,angularTolerance=.15)
    report={'settings':asdict(c),'derived':d,'checks':checks,'physical_print_test':False,
            'print_orientation':'STLs lie flat; lid exterior face down; no slicer supports intended',
            'assembly_screws':'4 x M2x8; flat-underhead diameter <=4.2, height <=2.2; pilot 1.7' if c.joint=='screws' else 'adhesive on mating lands, keep out of slide path'}
    (out/(prefix+'_dimensions.json')).write_text(json.dumps(report,indent=2,ensure_ascii=False))
    print(prefix,':',round(d['L'],2),'x',round(d['W'],2),'mm, pitch',d['pitch'],'PASS',flush=True)
    return parts,d

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--detent-spring-width',type=float,default=SETTINGS.detent_spring_width)
    parser.add_argument('--no-detent',action='store_false',dest='detent',default=SETTINGS.detent)
    parser.add_argument('--rows',type=int,default=SETTINGS.rows)
    parser.add_argument('--columns',type=int,default=SETTINGS.columns)
    parser.add_argument('--screw',choices=PRESETS,default=SETTINGS.screw)
    parser.add_argument('--joint',choices=['screws','glue'],default=SETTINGS.joint)
    parser.add_argument('--magnet-diameter',type=float,default=SETTINGS.magnet_diameter)
    parser.add_argument('--magnet-thickness',type=float,default=SETTINGS.magnet_thickness)
    parser.add_argument('--head-diameter',type=float,default=SETTINGS.head_diameter)
    parser.add_argument('--slot-width',type=float,default=SETTINGS.slot_width)
    parser.add_argument('--pitch',type=float,default=SETTINGS.pitch)
    parser.add_argument('--out',type=Path,default=Path(__file__).resolve().parent/'generated')
    args=parser.parse_args();values=vars(args).copy();out=values.pop('out')
    c=replace(SETTINGS,**values);export(c,out)
if __name__=='__main__':main()
