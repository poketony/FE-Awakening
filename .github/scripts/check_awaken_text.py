from pathlib import Path
import re

pairs=[(Path('Awakening/Messages (K)'),Path('Awakening/Messages (J)')),
       (Path('Awakening/DLC Message (K)'),Path('Awakening/DLC Message (J)'))]
head=re.compile(r'^(MID_[^:]+): ',re.M)
dead=re.compile(r'_(?:PCM[23]|PCF[23])(?:$|_)')

def split_mids(s):
    ms=list(head.finditer(s)); out={}
    for i,m in enumerate(ms):
        out[m.group(1)]=s[m.end():(ms[i+1].start() if i+1<len(ms) else len(s))].rstrip('\r\n')
    return out

def opcodes(s):
    out=[]
    token_re=re.compile(r'\$(?:t[01]|W[mMsSaAqQ]|E[^$\\\n\s]*|Svp[^$\\\n\s]*|b|k|p|Nu)')
    for m in token_re.finditer(s):
        t=m.group(0)
        if t.startswith('$E'): t='$E'
        elif t.startswith('$Svp'): t='$Svp'
        elif t.startswith('$W'): t='$W'+t[2:].lower()
        out.append(t)
    return out

bad=[]; mm=[]
for kr,jp in pairs:
    if not kr.exists(): continue
    for f in sorted(kr.glob('*.txt')):
        txt=f.read_text('utf-8'); km=split_mids(txt)
        for mid,body in km.items():
            if dead.search(mid): continue
            checks=[('bad-backslash',r'\\(?!n)'),('bad-t-style',r'\$t(?![01])'),('bad-W-code',r'\$W(?![mMsSaAqQ])'),('bare-dollar',r'\$(?=$|[ \\])')]
            for typ,pat in checks:
                for m in re.finditer(pat,body):
                    bad.append((str(f),mid,typ,body[max(0,m.start()-55):m.start()+56]))
        jf=jp/f.name
        if not jf.exists(): continue
        try: jm=split_mids(jf.read_text('utf-8'))
        except UnicodeDecodeError: continue
        for mid,kb in km.items():
            if dead.search(mid) or mid not in jm: continue
            a=[x for x in opcodes(jm[mid]) if x!='$Nu']
            b=[x for x in opcodes(kb) if x!='$Nu']
            if a!=b:
                mm.append((str(f),mid,a,b,jm[mid][:220],kb[:220]))

lines=[f'MALFORMED_COUNT={len(bad)}']
for x in bad:
    lines.append('BAD\t'+'\t'.join([x[0],x[1],x[2],x[3].replace('\n','\\n')]))
lines.append(f'HIGHRISK_MISMATCH_COUNT={len(mm)}')
for x in mm:
    lines.append('MM\t'+x[0]+'\t'+x[1]+'\tJP='+repr(x[2])+'\tKR='+repr(x[3])+'\tJPCTX='+x[4].replace('\n','\\n')+'\tKRCTX='+x[5].replace('\n','\\n'))
Path('.github/AWAKEN_CONTROL_AUDIT.txt').write_text('\n'.join(lines)+'\n',encoding='utf-8')
print('\n'.join(lines[:80]))
print('REPORT=.github/AWAKEN_CONTROL_AUDIT.txt')
