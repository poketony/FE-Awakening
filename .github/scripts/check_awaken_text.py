from pathlib import Path
import re
from collections import Counter

pairs=[(Path('Awakening/Messages (K)'),Path('Awakening/Messages (J)')),
       (Path('Awakening/DLC Message (K)'),Path('Awakening/DLC Message (J)'))]
head=re.compile(r'^(MID_[^:]+): ',re.M)
dead=re.compile(r'_(?:PCM[23]|PCF[23])(?:$|_)')

def split_mids(s):
    ms=list(head.finditer(s)); out={}
    for i,m in enumerate(ms):
        out[m.group(1)]=s[m.end():(ms[i+1].start() if i+1<len(ms) else len(s))].rstrip('\r\n')
    return out

def critical(s):
    # Only controls likely to break portrait/window/expression/voice/staging.
    out=[]
    for m in re.finditer(r'\$(?:t[01]|W[mMsSaAqQ]|E[^$\\\n\s]*|Svp[^$\\\n\s]*|b)',s):
        t=m.group(0)
        if t.startswith('$E'): t='$E'
        elif t.startswith('$Svp'): t='$Svp'
        elif t.startswith('$W'): t='$W'+t[2:].lower()
        out.append(t)
    return out

bad=[]; diff=[]
for kr,jp in pairs:
    if not kr.exists(): continue
    for f in sorted(kr.glob('*.txt')):
        txt=f.read_text('utf-8'); km=split_mids(txt)
        for mid,body in km.items():
            if dead.search(mid): continue
            checks=[('bad-backslash',r'\\(?!n)'),('bad-t-style',r'\$t(?![01])'),('bad-W-code',r'\$W(?![mMsSaAqQ])'),('bare-dollar',r'\$(?=$|[ \\])')]
            for typ,pat in checks:
                for m in re.finditer(pat,body):
                    bad.append((str(f),mid,typ,body[max(0,m.start()-45):m.start()+46]))
        jf=jp/f.name
        if not jf.exists(): continue
        try: jm=split_mids(jf.read_text('utf-8'))
        except UnicodeDecodeError: continue
        for mid,kb in km.items():
            if dead.search(mid) or mid not in jm: continue
            a=critical(jm[mid]); b=critical(kb)
            if a!=b:
                kind='COUNT' if Counter(a)!=Counter(b) else 'ORDER'
                diff.append((str(f),mid,kind,a,b,jm[mid][:150],kb[:150]))

lines=[f'MALFORMED_COUNT={len(bad)}']
for x in bad:
    lines.append('BAD\t'+'\t'.join([x[0],x[1],x[2],x[3].replace('\n','\\n')]))
lines.append(f'CRITICAL_DIFF_COUNT={len(diff)}')
for x in diff:
    lines.append('DIFF\t'+x[0]+'\t'+x[1]+'\t'+x[2]+'\tJP='+repr(x[3])+'\tKR='+repr(x[4])+'\tJPCTX='+x[5].replace('\n','\\n')+'\tKRCTX='+x[6].replace('\n','\\n'))
Path('.github/AWAKEN_CONTROL_AUDIT.txt').write_text('\n'.join(lines)+'\n',encoding='utf-8')
print('MALFORMED_COUNT',len(bad))
print('CRITICAL_DIFF_COUNT',len(diff))
print('COUNT_DIFF',sum(x[2]=='COUNT' for x in diff),'ORDER_DIFF',sum(x[2]=='ORDER' for x in diff))
