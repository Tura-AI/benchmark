import subprocess, sys, tomllib
from pathlib import Path
root=Path.cwd()
bin=Path((root/'REFERENCE_BINARY.txt').read_text().strip())
port=[sys.executable, str(root/'executable')]
fail=[]; total=0
for toml in sorted((root/'rust-reference'/'tests'/'cmd').glob('*.toml')):
    data=tomllib.loads(toml.read_text())
    args=data.get('bin',{}).get('args') or data.get('args')
    if not args: continue
    import shlex
    argv=shlex.split(args)
    total+=1
    o=subprocess.run([str(bin),*argv], cwd=root/'rust-reference', stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    a=subprocess.run([*port,*argv], cwd=root/'rust-reference', stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if (o.returncode,o.stdout,o.stderr)!=(a.returncode,a.stdout,a.stderr):
        fail.append((toml.name,argv,o.returncode,a.returncode,o.stdout,a.stdout,o.stderr,a.stderr))
print(f'cmd_tests total={total} pass={total-len(fail)} fail={len(fail)}')
for item in fail[:6]:
    name,argv,oe,ae,osout,asout,oerr,aerr=item
    print('CASE',name,argv,'EXIT',oe,ae)
    print('ORACLE_OUT',osout.decode('utf-8','replace')[:800])
    print('ACTUAL_OUT',asout.decode('utf-8','replace')[:800])
    print('ORACLE_ERR',oerr.decode('utf-8','replace')[:300])
    print('ACTUAL_ERR',aerr.decode('utf-8','replace')[:300])
raise SystemExit(1 if fail else 0)