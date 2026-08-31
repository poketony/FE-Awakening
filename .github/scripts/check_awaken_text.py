from pathlib import Path
import re

pairs=[(Path('Awakening/Messages (K)'),Path('Awakening/Messages (J)')),(Path('Awakening/DLC Message (K)'),Path('Awakening/DLC Message (J)'))]
head=re.compile(r'^(MID_[^:]+): ',re.M)
dead=re.compile(r'_(?:PCM[23]|PCF[23])(?:$|_)')

def split_mids(s):
    ms=list(head.finditer(s)); out={}
    for i,m in enumerate(ms):
        out[m.group(1)]=s[m.end():(ms[i+1].start() if i+1<len(ms) else len(s))].rstrip('\r\n')
    return out

def controls(s):
    # compare only staging-sensitive opcodes; ignore payload details
    out=[]
    for m in re.finditer(r'\$(?:t[01]|W[m saq]|E[^$\\\n\s]*|Svp[^$\\\n\s]*|b|k|p|Nu)',s):
        t=m.group(0).replace(' ','')
        if t.startswith('$E'): t='$E'
        elif t.startswith('$Svp'): t='$Svp'
        out.append(t)
    return out

bad=[]; mismatch=[]
for kr,jp in pairs:
  if not kr.exists(): continue
  for f in sorted(kr.glob('*.txt')):
    txt=f.read_text('utf-8'); km=split_mids(txt)
    for mid,body in km.items():
      if dead.search(mid): continue
      for m in re.finditer(r'\\(?!n)',body):
        bad.append((str(f),mid,'backslash',body[max(0,m.start()-45):m.start()+46]))
      for m in re.finditer(r'\$t(?![01])',body):
        bad.append((str(f),mid,'t-style',body[max(0,m.start()-45):m.start()+46]))
    jf=jp/f.name
    if not jf.exists(): continue
    jm=split_mids(jf.read_text('utf-8'))
    for mid,kb in km.items():
      if dead.search(mid) or mid not in jm: continue
      a=controls(jm[mid]); b=controls(kb)
      # player-name differences are localization-specific and low risk
      aa=[x for x in a if x!='$Nu']; bb=[x for x in b if x!='$Nu']
      if aa!=bb:
        mismatch.append((str(f),mid,aa,bb,jm[mid][:140],kb[:140]))
print('BAD',len(bad))
for x in bad: print('BADROW',repr(x))
print('MISMATCH',len(mismatch))
for x in mismatch: print('MMROW',repr(x))