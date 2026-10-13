import subprocess, os, sys
R='/home/claude/dev'; O=sys.argv[1]; T=os.path.join(O,'_txt'); os.makedirs(T,exist_ok=True)
B='/usr/share/fonts/opentype/inter/Inter-Bold.otf'; M='/usr/share/fonts/opentype/inter/Inter-Medium.otf'; L='/usr/share/fonts/opentype/inter/Inter-Regular.otf'
for f in (B,M,L): assert os.path.exists(f),f
n=[0]
def tf(s):
    n[0]+=1; p=os.path.join(T,f't{n[0]}.txt'); open(p,'w').write(s); return p
def dt(s,font,size,x,y,color='white',extra=''):
    return f"drawtext=fontfile={font}:textfile={tf(s)}:fontsize={size}:fontcolor={color}:x={x}:y={y}{extra}"
LABEL="SIMULACIÓN CONCEPTUAL — gemelo preliminar · mockup ilustrativo, no publicar"
def stamp(): return dt(LABEL,M,22,'w-tw-36','h-52','white@0.85',':box=1:boxcolor=black@0.55:boxborderw=10')
def run(a): subprocess.run(['ffmpeg','-v','error','-y']+a,check=True)
enc=['-c:v','libx264','-pix_fmt','yuv420p','-r','25','-crf','18','-preset','medium','-an']
fade=lambda d:f"fade=t=in:st=0:d=0.6,fade=t=out:st={d-0.6}:d=0.6"
# 1 apertura 8s: Ken Burns sobre foto del Obelisco
d=8
vf=(f"scale=3840:-2,crop=3840:2160:0:(ih-2160)/2,zoompan=z='1+0.06*on/{d*25}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d={d*25}:s=1920x1080:fps=25,"
    "drawbox=x=0:y=0:w=iw:h=ih:color=black@0.35:t=fill,drawbox=x=0:y=ih-380:w=iw:h=380:color=black@0.5:t=fill,"
    +dt("EL TRUST · Obelisco, Buenos Aires",M,34,'120','h-330','white@0.9',":alpha='if(lt(t,0.8),0,min(1,(t-0.8)/0.6))'")+','
    +dt("TRUST × McDonald's",B,92,'116','h-280','white',":alpha='if(lt(t,1.4),0,min(1,(t-1.4)/0.6))'")+','
    +dt("Un edificio. Un momento. Una marca.",L,40,'120','h-160','white@0.9',":alpha='if(lt(t,2.2),0,min(1,(t-2.2)/0.6))'")+','
    +stamp()+','+fade(d))
run(['-loop','1','-i',f'{R}/apps/control/public/experience/obelisco-wide.jpg','-t',str(d),'-vf',vf]+enc+[f'{T}/s1.mp4'])
# 2 takeover 15s (material existente, ya rotulado)
run(['-i',f'{R}/docs/screenshots/master-of-trust-mcd-demo-15s.mp4','-vf',stamp()+',fade=t=in:st=0:d=0.4,fade=t=out:st=14.6:d=0.4']+enc+[f'{T}/s2.mp4'])
# 3 un show, tres sistemas 8s
d=8
rows=[("Pantallas Corrientes + Pellegrini","Aprobación y versión vigente: funciona hoy en TRUST CONTROL",2.0),
      ("Fachada RGBW","Simulación — se implementará",3.0),
      ("Reloj","Simulación — se implementará",4.0)]
vf=("scale=1920:1080,zoompan=z='1+0.04*on/200':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=200:s=1920x1080:fps=25,"
    "drawbox=x=0:y=0:w=900:h=ih:color=black@0.66:t=fill,"
    +dt("Un show, tres sistemas",B,60,'80','200','white',":alpha='if(lt(t,0.6),0,min(1,(t-0.6)/0.5))'"))
y=360
for a,b,t0 in rows:
    al=f":alpha='if(lt(t,{t0}),0,min(1,(t-{t0})/0.5))'"
    vf+=','+dt(a,B,36,'80',str(y),'white',al)+','+dt(b,L,26,'80',str(y+50),'#FFC72C',al); y+=150
vf+=','+dt("Sincronía entre sistemas: simulada, no medida",L,24,'80','h-140','white@0.75')+','+stamp()+','+fade(d)
run(['-loop','1','-i',f'{R}/docs/screenshots/hero-16x9-signature.png','-t',str(d),'-vf',vf]+enc+[f'{T}/s3.mp4'])
# 4 cierre 6s
d=6
vf=("color=c=black:s=1920x1080:r=25:d=6,"
    +dt("TRUST",B,120,'(w-tw)/2','(h/2)-150','white')+','
    +dt("Control y aprobación de contenido para el edificio del Obelisco",L,36,'(w-tw)/2','(h/2)+10','white@0.9')+','
    +dt("Propuesta preliminar · condiciones a definir",L,28,'(w-tw)/2','(h/2)+80','#FFC72C')+','
    +stamp()+','+fade(d))
run(['-f','lavfi','-i',vf.split(',',1)[0],'-vf',vf.split(',',1)[1]]+enc+[f'{T}/s4.mp4'])
open(f'{T}/list.txt','w').write(''.join(f"file 's{i}.mp4'\n" for i in range(1,5)))
run(['-f','concat','-safe','0','-i',f'{T}/list.txt','-c','copy','-movflags','+faststart',f'{O}/trust-mcd-kit-corte1.mp4'])
# visuales (b)
vis=[('apps/control/public/experience/obelisco-wide.jpg','01-obelisco-noche',"scale=1920:-2,crop=1920:1080"),
     ('docs/screenshots/hero-16x9-takeover.png','02-takeover',"scale=1920:1080"),
     ('docs/screenshots/hero-16x9-signature.png','03-firma-sincronizada',"scale=1920:1080"),
     ('docs/screenshots/03-brand-reveal.png','04-brand-reveal',"scale=1920:1080")]
for src,name,sc in vis:
    run(['-i',f'{R}/{src}','-vf',sc+','+stamp(),'-frames:v','1',f'{O}/{name}.png'])
