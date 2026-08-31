from pathlib import Path
import re
from collections import Counter

pairs=[(Path('Awakening/Messages (K)'),Path('Awakening/Messages (J)')),
       (Path('Awakening/DLC Message (K)'),Path('Awakening/DLC Message (J)'))]
head=re.compile(r'^(MID_[^:]+): ',re.M)
dead=re.compile(r'_(?:PCM[23]|PCF[23])(?:$|_)')

def mids(s):
    ms=list(head.finditer(s)); out={}
    for i,m in enumerate(ms): out[m.group(1)]=s[m.end():(ms[i+1].start() if i+1<len(ms) else len(s))].rstrip('\r\n')
    return out

def counts(s):
    return Counter(re.findall(r'\$(?:t[01]|Wm|Ws|Wa|E(?=[^A-Za-z]|$)|Svp|b)',s))

def compact(s):
    return s[:180].replace('\n','\\n').replace('\r','')

mal=[]; diffs=[]
for kr,jp in pairs:
  if not kr.exists(): continue
  for f in sorted(kr.glob('*.txt')):
    txt=f.read_text('utf-8'); km=mids(txt)
    for mid,b in km.items():
      if dead.search(mid): continue
      for m in re.finditer(r'\\(?!n)',b): mal.append((str(f),mid,'bad-backslash',compact(b[max(0,m.start()-60):m.start()+80])))
      for m in re.finditer(r'\$t(?![01])',b): mal.append((str(f),mid,'bad-t-style',compact(b[max(0,m.start()-60):m.start()+80])))
      for m in re.finditer(r'\$(?=$|\s|\\)',b): mal.append((str(f),mid,'bare-dollar',compact(b[max(0,m.start()-60):m.start()+80])))
    jf=jp/f.name
    if not jf.exists(): continue
    try: jm=mids(jf.read_text('utf-8'))
    except UnicodeDecodeError: continue
    for mid,kb in km.items():
      if dead.search(mid) or mid not in jm: continue
      jc=counts(jm[mid]); kc=counts(kb)
      if jc==kc: continue
      # Rank only count differences in breakage-prone staging controls.
      delta={x:(jc[x],kc[x]) for x in sorted(set(jc)|set(kc)) if jc[x]!=kc[x]}
      score=0
      for op,(a,b) in delta.items():
        weight={'$t0':10,'$t1':10,'$Wm':8,'$Ws':8,'$Wa':6,'$b':5,'$Svp':4,'$E':3}.get(op,1)
        score += weight*abs(a-b)
      diffs.append((score,str(f),mid,delta,compact(jm[mid]),compact(kb)))

diffs.sort(reverse=True)
lines=[f'MALFORMED_COUNT={len(mal)}']
for x in mal: lines.append('BAD\t'+'\t'.join(x))
lines.append(f'CRITICAL_COUNT_DIFF_TOTAL={len(diffs)}')
lines.append('TOP_CANDIDATES=120')
for score,p,mid,d,j,k in diffs[:120]:
    lines.append(f'DIFF\tSCORE={score}\t{p}\t{mid}\tDELTA={d}\tJP={j}\tKR={k}')
Path('.github/AWAKEN_CONTROL_AUDIT.txt').write_text('\n'.join(lines)+'\n',encoding='utf-8')
print('MALFORMED_COUNT=',len(mal),'CRITICAL_COUNT_DIFF_TOTAL=',len(diffs),'TOP=',min(120,len(diffs)))
