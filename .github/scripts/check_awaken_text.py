from pathlib import Path
import re
from collections import Counter
pairs=[(Path('Awakening/Messages (K)'),Path('Awakening/Messages (J)')),(Path('Awakening/DLC Message (K)'),Path('Awakening/DLC Message (J)'))]
head=re.compile(r'^(MID_[^:]+): ',re.M); dead=re.compile(r'_(?:PCM[23]|PCF[23])(?:$|_)')
def mids(s):
 ms=list(head.finditer(s)); return {m.group(1):s[m.end():(ms[i+1].start() if i+1<len(ms) else len(s))].rstrip('\r\n') for i,m in enumerate(ms)}
def cc(s): return Counter(re.findall(r'\$(?:t[012]|Wm|Ws|Wa|b)',s))
def compact(s): return s[:260].replace('\n','\\n').replace('\r','')
mal=[]; diff=[]
for kr,jp in pairs:
 if not kr.exists(): continue
 for f in sorted(kr.glob('*.txt')):
  txt=f.read_text('utf-8'); km=mids(txt)
  for mid,b in km.items():
   if dead.search(mid): continue
   for m in re.finditer(r'\\(?!n)',b): mal.append((str(f),mid,'bad-backslash',compact(b[max(0,m.start()-80):m.start()+100])))
   for m in re.finditer(r'\$t(?![012])',b): mal.append((str(f),mid,'bad-t-style',compact(b[max(0,m.start()-80):m.start()+100])))
   for m in re.finditer(r'\$(?=$|\s|\\)',b): mal.append((str(f),mid,'bare-dollar',compact(b[max(0,m.start()-80):m.start()+100])))
  jf=jp/f.name
  if not jf.exists(): continue
  try: jm=mids(jf.read_text('utf-8'))
  except UnicodeDecodeError: continue
  for mid,kb in km.items():
   if dead.search(mid) or mid not in jm: continue
   a,b=cc(jm[mid]),cc(kb)
   if a!=b:
    d={x:(a[x],b[x]) for x in sorted(set(a)|set(b)) if a[x]!=b[x]}
    diff.append((str(f),mid,d,compact(jm[mid]),compact(kb)))
lines=[f'MALFORMED_COUNT={len(mal)}']
for x in mal: lines.append('BAD\t'+'\t'.join(x))
lines.append(f'STRUCTURAL_DIFF_COUNT={len(diff)}')
for p,mid,d,j,k in diff: lines.append(f'DIFF\t{p}\t{mid}\tDELTA={d}\tJP={j}\tKR={k}')
Path('.github/AWAKEN_CONTROL_AUDIT.txt').write_text('\n'.join(lines)+'\n',encoding='utf-8')
print('MALFORMED',len(mal),'STRUCTURAL',len(diff))