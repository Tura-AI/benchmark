import subprocess, sys, shlex, tomllib
from pathlib import Path
root=Path.cwd(); bin=Path((root/'REFERENCE_BINARY.txt').read_text().strip()); port=[sys.executable,str(root/'executable')]
for args in [['tests/itest','--absolute','-R'], ['tests/itest','--long','--icons=always']]:
    o=subprocess.run([str(bin),*args],cwd=root/'rust-reference',stdout=subprocess.PIPE,stderr=subprocess.PIPE)
    a=subprocess.run([*port,*args],cwd=root/'rust-reference',stdout=subprocess.PIPE,stderr=subprocess.PIPE)
    ol=o.stdout.decode('utf-8','replace').splitlines(); al=a.stdout.decode('utf-8','replace').splitlines()
    print('ARGS',args,'lines',len(ol),len(al),'exit',o.returncode,a.returncode)
    for i,(x,y) in enumerate(zip(ol,al),1):
        if x!=y:
            print('FIRST_DIFF',i); print('O',repr(x)); print('A',repr(y)); break
    else:
        if len(ol)!=len(al): print('LEN_DIFF next', repr((ol+[''])[min(len(ol),len(al))]), repr((al+[''])[min(len(ol),len(al))]))