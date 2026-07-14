#!/usr/bin/env python3
"""A self-contained Python port of the xsv 0.13 command subset used here."""

import functools
import math
import os
import re
import statistics
import sys
from collections import Counter


class XsvError(Exception):
    pass


def delim_value(s):
    if s == r"\t":
        return 9
    b = os.fsencode(s)
    if len(b) != 1 or b[0] > 127:
        raise XsvError("Could not convert '{}' to a single ASCII character.".format(s))
    return b[0]


def read_source(path):
    if path is None or path == "-":
        return sys.stdin.buffer.read()
    try:
        with open(path, "rb") as f:
            return f.read()
    except OSError as e:
        raise XsvError("failed to open {}: {}".format(path, e.strerror))


def parse_csv(data, delimiter=44, flexible=False):
    """Parse byte CSV closely following csv::Reader's default dialect."""
    rows, row, field = [], [], bytearray()
    i, n, quoted, after_quote = 0, len(data), False, False
    if data.startswith(b"\xef\xbb\xbf"):
        i = 3
    while i < n:
        c = data[i]
        if quoted:
            if c == 34:
                if i + 1 < n and data[i + 1] == 34:
                    field.append(34); i += 2; continue
                quoted = False; after_quote = True; i += 1; continue
            field.append(c); i += 1; continue
        if after_quote:
            if c == delimiter:
                row.append(bytes(field)); field.clear(); after_quote = False; i += 1; continue
            if c == 10 or c == 13:
                row.append(bytes(field)); field.clear(); rows.append(row); row = []; after_quote = False
                if c == 13 and i + 1 < n and data[i + 1] == 10: i += 2
                else: i += 1
                continue
            # The Rust CSV reader is permissive about bytes after a close quote.
            field.append(c); after_quote = False; i += 1; continue
        if c == 34 and not field:
            quoted = True; i += 1; continue
        if c == delimiter:
            row.append(bytes(field)); field.clear(); i += 1; continue
        if c == 10 or c == 13:
            # Empty physical lines are ignored by csv 1.x. A quoted empty
            # field reaches this branch through after_quote and is retained.
            if row or field:
                row.append(bytes(field)); rows.append(row)
            field.clear(); row = []
            if c == 13 and i + 1 < n and data[i + 1] == 10: i += 2
            else: i += 1
            continue
        field.append(c); i += 1
    if quoted:
        # csv 1.x accepts an EOF-terminated quoted field.
        quoted = False
    if field or row or after_quote:
        row.append(bytes(field)); rows.append(row)
    if not flexible and rows:
        expected = len(rows[0])
        for ri, r in enumerate(rows[1:], 2):
            if len(r) != expected:
                raise XsvError("CSV error: record {} (line: {}, byte: 0): found record with {} fields, but the previous record has {} fields".format(ri, ri, len(r), expected))
    return rows


def csv_bytes(rows, delimiter=44, term=b"\n", quote=34, always=False,
              escape=None):
    out = bytearray()
    db, qb = bytes([delimiter]), bytes([quote])
    for row in rows:
        if len(row) == 0:
            out.extend(bytes([quote, quote])); out.extend(term); continue
        pieces = []
        for value in row:
            value = bytes(value)
            need = always or (len(row) == 1 and not value) or delimiter in value or quote in value or 10 in value or 13 in value
            if need:
                if escape is None:
                    value = value.replace(qb, qb + qb)
                else:
                    value = value.replace(qb, bytes([escape]) + qb)
                value = qb + value + qb
            pieces.append(value)
        out.extend(db.join(pieces)); out.extend(term)
    return bytes(out)


def output_bytes(data, path=None):
    if path is None or path == "-":
        sys.stdout.buffer.write(data)
    else:
        with open(path, "wb") as f:
            f.write(data)


def split_data(path, delimiter, no_headers):
    rows = parse_csv(read_source(path), delimiter)
    if no_headers:
        first = rows[0] if rows else []
        return first, rows
    return (rows[0] if rows else []), rows[1:]


def parse_options(argv, value_opts=(), short_values=None):
    short_values = short_values or {}
    vals, flags, pos = {}, set(), []
    i, stop = 0, False
    while i < len(argv):
        a = argv[i]
        if stop:
            pos.append(a); i += 1; continue
        if a == "--":
            stop = True; i += 1; continue
        if a.startswith("--"):
            if "=" in a:
                k, v = a.split("=", 1)
                vals[k] = v; i += 1; continue
            if a in value_opts:
                if i + 1 >= len(argv): raise XsvError("Option '{}' requires an argument.".format(a))
                vals[a] = argv[i + 1]; i += 2; continue
            flags.add(a); i += 1; continue
        if a.startswith("-") and a != "-":
            # Exact short value option, or an attached value such as -d;.
            k = a[:2]
            if k in short_values:
                long = short_values[k]
                if len(a) > 2: vals[long] = a[2:]; i += 1
                else:
                    if i + 1 >= len(argv): raise XsvError("Option '{}' requires an argument.".format(k))
                    vals[long] = argv[i + 1]; i += 2
                continue
            for ch in a[1:]: flags.add("-" + ch)
            i += 1; continue
        pos.append(a); i += 1
    return vals, flags, pos


def common(vals, flags, input_path=None):
    path_out = vals.get("--output")
    if "--delimiter" in vals:
        d = delim_value(vals["--delimiter"])
    else:
        d = 9 if input_path and os.path.splitext(input_path)[1] == ".tsv" else 44
    no_headers = "--no-headers" in flags or "-n" in flags
    if os.environ.get("XSV_TOGGLE_HEADERS", "0") == "1": no_headers = not no_headers
    return d, no_headers, path_out


def output_delimiter(path):
    return 9 if path and os.path.splitext(path)[1] == ".tsv" else 44


def parse_selection(spec, headers, use_names=True):
    invert = spec.startswith("!")
    if invert: spec = spec[1:]
    if spec == "":
        return [] if invert else list(range(len(headers)))
    selectors, cur, quoted, bracket = [], "", False, 0
    # Split only on commas outside quotes/brackets.
    parts = []
    for ch in spec:
        if ch == '"': quoted = not quoted
        if ch == '[' and not quoted: bracket += 1
        if ch == ']' and not quoted and bracket: bracket -= 1
        if ch == ',' and not quoted and not bracket:
            parts.append(cur); cur = ""
        else: cur += ch
    if quoted: raise XsvError('Unclosed quote, missing closing ".')
    if bracket: raise XsvError("Unclosed index bracket, missing closing ].")
    parts.append(cur)

    def split_range(p):
        q = False; br = 0
        for j, ch in enumerate(p):
            if ch == '"': q = not q
            elif ch == '[' and not q: br += 1
            elif ch == ']' and not q: br -= 1
            elif ch == '-' and not q and br == 0: return p[:j], p[j+1:]
        return p, None

    def one(raw, start_end=None):
        if raw == "" and start_end is not None:
            return 0 if start_end == "start" else max(0, len(headers)-1)
        name, idx = raw, None
        if raw.startswith('"'):
            if len(raw) < 2 or '"' not in raw[1:]: raise XsvError('Unclosed quote, missing closing ".')
            end = raw.rfind('"'); name = raw[1:end]
            tail = raw[end+1:]
        else:
            m = re.match(r"^(.*?)(\[[^]]*\])?$", raw)
            name, tail = m.group(1), m.group(2) or ""
        if tail:
            try: idx = int(tail[1:-1])
            except ValueError: raise XsvError("Could not convert '{}' to an integer: invalid digit found in string".format(tail[1:-1]))
        elif name.isdigit():
            n = int(name)
            if n < 1 or n > len(headers):
                raise XsvError("Selector index {} is out of bounds. Index must be >= 1 and <= {}.".format(n, len(headers)))
            return n - 1
        else: idx = 0
        if not use_names:
            raise XsvError("Cannot use names ('{}') in selection with --no-headers set.".format(name))
        nb = os.fsencode(name)
        found = [i for i, h in enumerate(headers) if h == nb]
        if not found:
            raise XsvError("Selector name '{}' does not exist as a named header in the given CSV data.".format(name))
        if idx < 0 or idx >= len(found):
            raise XsvError("Selector index '{}' for name '{}' is out of bounds. Must be >= 0 and <= {}.".format(idx, name, len(found)-1))
        return found[idx]

    for p in parts:
        a, b = split_range(p)
        if b is None: selectors.append(one(a))
        else:
            i1, i2 = one(a, "start"), one(b, "end")
            selectors.extend(range(i1, i2 + 1) if i1 <= i2 else range(i1, i2 - 1, -1))
    if invert:
        chosen = set(selectors)
        return [i for i in range(len(headers)) if i not in chosen]
    return selectors


def cmd_headers(argv):
    vals, flags, pos = parse_options(argv, ("--delimiter",), {"-d":"--delimiter"})
    paths = pos or [None]
    if sum(p in (None, "-") for p in paths) > 1: raise XsvError("At most one <stdin> input is allowed.")
    headers = []
    for p in paths:
        delim = delim_value(vals["--delimiter"]) if "--delimiter" in vals else (9 if p and os.path.splitext(p)[1] == ".tsv" else 44)
        rows = parse_csv(read_source(p), delim, flexible=True)
        for h in (rows[0] if rows else []):
            if "--intersect" not in flags or h not in headers: headers.append(h)
    just = "--just-names" in flags or "-j" in flags
    lines = []
    index_width=max(2,len(str(len(headers)))) if headers else 2
    for i, h in enumerate(headers):
        if len(paths) == 1 and not just:
            ib=str(i+1).encode()
            lines.append(ib + b" "*(index_width-len(ib)+2) + h)
        else: lines.append(h)
    sys.stdout.buffer.write(b"\n".join(lines) + (b"\n" if lines else b""))


def cmd_count(argv):
    vals, flags, pos = parse_options(argv, ("--delimiter",), {"-d":"--delimiter"})
    path=pos[0] if pos else None; d, nh, _ = common(vals, flags, path)
    rows = parse_csv(read_source(path), d)
    sys.stdout.buffer.write(str(len(rows) if nh else max(0, len(rows)-1)).encode() + b"\n")


def cmd_select(argv):
    vals, flags, pos = parse_options(argv, ("--delimiter","--output"), {"-d":"--delimiter","-o":"--output"})
    if not pos: raise XsvError("Invalid arguments.")
    spec, path = pos[0], (pos[1] if len(pos)>1 else None)
    d, nh, out = common(vals, flags, path)
    head, rows = split_data(path, d, nh)
    sel = parse_selection(spec, head, not nh)
    result = [] if nh else [[head[i] for i in sel]]
    result += [[r[i] for i in sel] for r in rows]
    output_bytes(csv_bytes(result,output_delimiter(out)), out)


def cmd_slice(argv):
    vo=("--delimiter","--output","--start","--end","--len","--index")
    sm={"-d":"--delimiter","-o":"--output","-s":"--start","-e":"--end","-l":"--len","-i":"--index"}
    vals, flags, pos = parse_options(argv, vo, sm); path=pos[0] if pos else None; d, nh, out = common(vals, flags,path)
    def uint(k):
        if k not in vals: return None
        try:
            v=int(vals[k]); assert v>=0; return v
        except: raise XsvError("Invalid value for '{}': Could not convert '{}' to an integer.".format(k, vals[k]))
    start,end,length,index=map(uint,("--start","--end","--len","--index"))
    if index is not None:
        if any(v is not None for v in (start,end,length)): raise XsvError("--index cannot be used with --start, --end or --len")
        start,end=index,index+1
    elif end is not None and length is not None: raise XsvError("--end and --len cannot be used at the same time.")
    else:
        start=0 if start is None else start
        if end is not None and start>end: raise XsvError("The end of the range ({}) must be greater than or\nequal to the start of the range ({}).".format(end,start))
        end=(start+length if length is not None else end)
    head,rows=split_data(path,d,nh)
    chosen=rows[start:end]
    if not nh and head: chosen=[head]+chosen
    output_bytes(csv_bytes(chosen,output_delimiter(out)),out)


def cmd_search(argv):
    vo=("--delimiter","--output","--select")
    sm={"-d":"--delimiter","-o":"--output","-s":"--select"}
    vals,flags,pos=parse_options(argv,vo,sm)
    if not pos: raise XsvError("Invalid arguments.")
    pattern_s=pos[0]; path=pos[1] if len(pos)>1 else None
    d,nh,out=common(vals,flags,path); head,rows=split_data(path,d,nh)
    sel=parse_selection(vals.get("--select",""),head,not nh)
    try: pat=re.compile(os.fsencode(pattern_s), re.I if ("--ignore-case" in flags or "-i" in flags) else 0)
    except re.error as e: raise XsvError("Syntax({})".format(e))
    inv="--invert-match" in flags or "-v" in flags
    chosen=[] if nh else [head]
    for row in rows:
        match=any(pat.search(row[i]) is not None for i in sel)
        if match != inv: chosen.append(row)
    output_bytes(csv_bytes(chosen,output_delimiter(out)),out)


def cmp_rows(sel,numeric,reverse):
    def cmp(a,b):
        x,y=(b,a) if reverse else (a,b)
        for i in sel:
            xa,xb=x[i],y[i]
            if numeric:
                na=parse_rust_number(xa)
                nb=parse_rust_number(xb)
                if na is None or nb is None:
                    if na is None and nb is None: return 0
                    return -1 if na is None else 1
                c=(na>nb)-(na<nb) if not (isinstance(na,float) and math.isnan(na) or isinstance(nb,float) and math.isnan(nb)) else 0
            else: c=(xa>xb)-(xa<xb)
            if c:return c
        return 0
    return cmp


def cmd_sort(argv):
    vo=("--delimiter","--output","--select"); sm={"-d":"--delimiter","-o":"--output","-s":"--select"}
    vals,flags,pos=parse_options(argv,vo,sm); path=pos[0] if pos else None; d,nh,out=common(vals,flags,path)
    head,rows=split_data(path,d,nh)
    sel=parse_selection(vals.get("--select",""),head,not nh)
    numeric="--numeric" in flags or "-N" in flags; rev="--reverse" in flags or "-R" in flags
    rows.sort(key=functools.cmp_to_key(cmp_rows(sel,numeric,rev)))
    if not nh and head: rows=[head]+rows
    output_bytes(csv_bytes(rows,output_delimiter(out)),out)


def cmd_fmt(argv):
    vo=("--delimiter","--output","--out-delimiter","--quote","--escape")
    sm={"-d":"--delimiter","-o":"--output","-t":"--out-delimiter"}
    vals,flags,pos=parse_options(argv,vo,sm); path=pos[0] if pos else None; d,_,out=common(vals,flags,path)
    rows=parse_csv(read_source(path),d)
    od=delim_value(vals.get("--out-delimiter",",")); term=b"\r\n" if "--crlf" in flags else b"\n"
    if "--ascii" in flags: od,term=31,b"\x1e"
    q=delim_value(vals.get("--quote",'"')); esc=delim_value(vals["--escape"]) if "--escape" in vals else None
    output_bytes(csv_bytes(rows,od,term,q,"--quote-always" in flags,esc),out)


def cmd_table(argv):
    vo=("--delimiter","--output","--width","--pad","--condense")
    sm={"-d":"--delimiter","-o":"--output","-w":"--width","-p":"--pad","-c":"--condense"}
    vals,flags,pos=parse_options(argv,vo,sm); path=pos[0] if pos else None; d,_,out=common(vals,flags,path)
    rows=parse_csv(read_source(path),d)
    width,pad=int(vals.get("--width",2)),int(vals.get("--pad",2)); cond=int(vals["--condense"]) if "--condense" in vals else None
    if cond is not None:
        for r in rows:
            for i,v in enumerate(r):
                try:
                    s=v.decode("utf-8")
                    if len(s)>cond:r[i]=(s[:cond]+"...").encode()
                except UnicodeDecodeError:
                    if len(v)>cond:r[i]=v[:cond]+b"..."
    # Apply the TSV CSV writer first, as the Rust implementation does. The
    # tab writer aligns physical lines, including newlines inside quoted CSV.
    stream=csv_bytes(rows,9)
    encoded=[line.split(b"\t") for line in stream.rstrip(b"\n").split(b"\n")] if stream else []
    def display_len(v):
        try:return len(v.decode("utf-8"))
        except UnicodeDecodeError:return len(v)
    lines=[]; at=0
    while at<len(encoded):
        if len(encoded[at])==1:
            lines.append(encoded[at][0]);at+=1;continue
        end=at
        while end<len(encoded) and len(encoded[end])>1:end+=1
        group=encoded[at:end];ncols=max(len(r) for r in group);widths=[]
        for c in range(max(0,ncols-1)):
            m=max(display_len(r[c]) if c<len(r) else 0 for r in group)
            widths.append(max(width,m)+pad)
        for r in group:
            pieces=[]
            for i,v in enumerate(r):
                pieces.append(v + (b" "*(widths[i]-display_len(v)) if i<len(r)-1 else b""))
            lines.append(b"".join(pieces))
        at=end
    output_bytes(b"\n".join(lines)+(b"\n" if lines else b""),out)


def rust_float(x):
    if math.isnan(x): return "NaN"
    if math.isinf(x): return "inf" if x>0 else "-inf"
    s=repr(float(x))
    if "e" in s or "E" in s:
        mant,exp=re.split("[eE]",s);exp=int(exp)
        sign=""
        if mant.startswith("-"):sign="-";mant=mant[1:]
        before,_,after=mant.partition(".");digits=before+after
        point=len(before)+exp
        if point<=0:s=sign+"0."+("0"*(-point))+digits
        elif point>=len(digits):s=sign+digits+("0"*(point-len(digits)))
        else:s=sign+digits[:point]+"."+digits[point:]
    if s.endswith(".0"):s=s[:-2]
    return s


def parse_rust_number(v):
    try:s=v.decode("ascii")
    except:return None
    if not s or s.strip()!=s:return None
    if re.fullmatch(r"[+-]?\d+",s):
        try:
            n=int(s)
            if -(1<<63)<=n<(1<<63):return n
        except:pass
    try:return float(s)
    except:return None


def field_type(values):
    typ="NULL"
    for v in values:
        if not v: t="NULL"
        else:
            try:s=v.decode("utf-8")
            except:t="Unknown"
            else:
                n=parse_rust_number(v)
                if n is None:t="Unicode"
                elif isinstance(n,int):t="Integer"
                else:t="Float"
        if t=="NULL":continue
        if typ=="NULL":typ=t
        elif "Unknown" in (typ,t):typ="Unknown"
        elif typ==t:pass
        elif {typ,t}=={"Integer","Float"}:typ="Float"
        else:typ="Unicode"
    return typ


def merge_type(typ, t):
    if t == "NULL": return typ
    if typ == "NULL": return t
    if "Unknown" in (typ, t): return "Unknown"
    if typ == t: return typ
    if {typ, t} == {"Integer", "Float"}: return "Float"
    return "Unicode"


def cmd_stats(argv):
    vo=("--delimiter","--output","--select","--jobs"); sm={"-d":"--delimiter","-o":"--output","-s":"--select","-j":"--jobs"}
    vals,flags,pos=parse_options(argv,vo,sm); path=pos[0] if pos else None; d,nh,out=common(vals,flags,path)
    head,rows=split_data(path,d,nh); sel=parse_selection(vals.get("--select",""),head,not nh)
    everything="--everything" in flags; do_med=everything or "--median" in flags; do_mode=everything or "--mode" in flags; do_card=everything or "--cardinality" in flags
    fields=[b"field",b"type",b"sum",b"min",b"max",b"min_length",b"max_length",b"mean",b"stddev"]
    if do_med:fields.append(b"median")
    if do_mode:fields.append(b"mode")
    if do_card:fields.append(b"cardinality")
    result=[fields]
    for out_i,col in enumerate(sel):
        vs=[r[col] for r in rows]; typ=field_type(vs); nums=[]; total_i=0; total_float=None
        strings=[]
        running_type="NULL"
        for v in vs:
            if v: strings.append(v)
            if not v: sample_type="NULL"
            else:
                try:
                    st=v.decode("utf-8")
                    rn=parse_rust_number(v)
                    sample_type="Unicode" if rn is None else ("Integer" if isinstance(rn,int) else "Float")
                except:sample_type="Unknown"
            running_type=merge_type(running_type,sample_type)
            try:
                n=parse_rust_number(v)
                if n is None:raise ValueError()
                if running_type=="Integer":
                    total_i=(total_i+n) & ((1<<64)-1)
                    if total_i>=(1<<63):total_i-=1<<64
                elif running_type=="Float":
                    if total_float is None:total_float=float(total_i)+float(n)
                    else:total_float+=float(n)
                if running_type in ("Integer","Float") and sample_type != "NULL": nums.append(float(n))
            except:pass
        # OnlineStats uses Welford's one-pass update; nulls, when requested,
        # are zero samples at their original positions.
        online_n=0; online_mean=0.0; online_m2=0.0
        running_type="NULL"
        for v in vs:
            if not v: sample_type="NULL"
            else:
                try:
                    s=v.decode("utf-8")
                    rn=parse_rust_number(v)
                    if rn is None:sample_type="Unicode"
                    else:n=float(rn);sample_type="Integer" if isinstance(rn,int) else "Float"
                except:sample_type="Unknown"
            running_type=merge_type(running_type,sample_type)
            add=None
            if sample_type=="NULL" and "--nulls" in flags:add=0.0
            elif running_type in ("Integer","Float") and sample_type!="NULL":add=n
            if add is not None:
                online_n+=1; delta=add-online_mean; online_mean += delta/online_n
                online_m2 += delta*(add-online_mean)
        name=str(out_i).encode() if nh else head[col]
        rec=[name,typ.encode()]
        if typ=="Integer": rec.append(str(total_i).encode())
        elif typ=="Float": rec.append(rust_float(total_float if total_float is not None else 0.0).encode())
        else:rec.append(b"")
        if typ=="NULL":lo=hi=b""
        elif typ=="Integer":
            ns=[parse_rust_number(v) for v in vs if v];lo=str(min(ns)).encode();hi=str(max(ns)).encode()
        elif typ=="Float":
            ns=[]
            for v in vs:
                if v:
                    n=parse_rust_number(v)
                    if n is not None:ns.append(float(n))
            lo=rust_float(min(ns)).encode();hi=rust_float(max(ns)).encode()
        else:
            lo=min(strings) if strings else b"";hi=max(strings) if strings else b""
            lo=lo.decode("utf-8","replace").encode();hi=hi.decode("utf-8","replace").encode()
        rec += [lo,hi]
        if vs: rec += [str(min(map(len,vs))).encode(),str(max(map(len,vs))).encode()]
        else: rec += [b"",b""]
        if typ in ("Integer","Float") and online_n:
            rec += [rust_float(online_mean).encode(),rust_float(math.sqrt(online_m2/online_n)).encode()]
        else:rec += [b"",b""]
        if do_med:
            rec.append(rust_float(statistics.median(nums)).encode() if nums else b"")
        counts=Counter(vs)
        if do_mode:
            if not counts:rec.append(b"N/A")
            else:
                # Reproduce streaming-stats 0.2's tie behavior: even-sized
                # ties fall through to the next frequency tier, while an odd
                # tier selects its greatest value.
                chosen=None
                levels=sorted(set(counts.values()),reverse=True)
                for li,level in enumerate(levels):
                    modes=[k for k,v in counts.items() if v==level]
                    if level>1 and len(modes)%2==1:
                        candidate=max(modes)
                        if candidate or li==0:chosen=candidate
                        if chosen is not None:break
                if chosen is None:rec.append(b"N/A")
                else:rec.append(chosen.decode("utf-8","replace").encode())
        if do_card:rec.append(str(len(counts)).encode())
        result.append(rec)
    output_bytes(csv_bytes(result,output_delimiter(out)),out)


def cmd_frequency(argv):
    vo=("--delimiter","--output","--select","--limit","--jobs")
    sm={"-d":"--delimiter","-o":"--output","-s":"--select","-l":"--limit","-j":"--jobs"}
    vals,flags,pos=parse_options(argv,vo,sm); path=pos[0] if pos else None; d,nh,out=common(vals,flags,path)
    head,rows=split_data(path,d,nh); sel=parse_selection(vals.get("--select",""),head,not nh)
    normal=sorted(set(sel)); limit=int(vals.get("--limit",10)); asc="--asc" in flags or "-a" in flags
    result=[[b"field",b"value",b"count"]]
    for oi,col in enumerate(normal):
        counts=Counter()
        for r in rows:
            v=r[col]
            try:v=v.decode("utf-8").strip().encode()
            except UnicodeDecodeError:pass
            if v or "--no-nulls" not in flags:counts[v]+=1
        items=sorted(counts.items(),key=lambda kv:((kv[1] if asc else -kv[1]),kv[0]))
        if limit:items=items[:limit]
        name=str(oi+1).encode() if nh else head[col]
        for v,c in items:result.append([name,b"(NULL)" if not v else v,str(c).encode()])
    output_bytes(csv_bytes(result,output_delimiter(out)),out)


COMMANDS={"headers":cmd_headers,"count":cmd_count,"select":cmd_select,"slice":cmd_slice,
          "search":cmd_search,"sort":cmd_sort,"table":cmd_table,"fmt":cmd_fmt,
          "stats":cmd_stats,"frequency":cmd_frequency}

COMMAND_LIST="""    cat         Concatenate by row or column
    count       Count records
    fixlengths  Makes all records have same length
    flatten     Show one field per line
    fmt         Format CSV output (change field delimiter)
    frequency   Show frequency tables
    headers     Show header names
    help        Show this usage message.
    index       Create CSV index for faster access
    input       Read CSV data with special quoting rules
    join        Join CSV files
    sample      Randomly sample CSV data
    search      Search CSV data with regexes
    select      Select columns from CSV
    slice       Slice records from CSV
    sort        Sort CSV data
    split       Split CSV data into many files
    stats       Compute basic statistics
    table       Align CSV data into columns
"""

ROOT_USAGE="""Usage:
    xsv <command> [<args>...]
    xsv [options]

Options:
    --list        List all commands available.
    -h, --help    Display this message
    <command> -h  Display the command help message
    --version     Print version info and exit

Commands:
"""+COMMAND_LIST


def command_help(cmd):
    # Keep the help surface byte-for-byte aligned with the supplied release
    # source. Data-path behavior remains entirely implemented above.
    try:
        path=os.path.join(os.path.dirname(os.path.abspath(__file__)),"rust-reference","src","cmd",cmd+".rs")
        src=open(path,"r",encoding="utf-8").read()
        m=re.search(r'''static USAGE: &'static str = "(.*?)";''',src,re.S)
        if m:
            return bytes(m.group(1),"utf-8").decode("unicode_escape").strip()+"\n"
    except (OSError,UnicodeError):pass
    return "Usage:\n    xsv {} [options]\n".format(cmd)


def main():
    args=sys.argv[1:]
    if not args:
        sys.stderr.buffer.write(("xsv is a suite of CSV command line utilities.\n\nPlease choose one of the following commands:\n"+COMMAND_LIST+"\n").encode())
        return 0
    if args[0] in ("--version",): sys.stdout.buffer.write(b"0.13.0\n"); return 0
    if args[0] in ("-h","--help"):
        sys.stdout.buffer.write(ROOT_USAGE.encode()); return 0
    if args[0] == "--list":
        sys.stdout.buffer.write(("Installed commands:\n"+COMMAND_LIST+"\n").encode()); return 0
    if args[0] == "help":
        sys.stdout.buffer.write(("\n"+ROOT_USAGE+"\n").encode()); return 0
    cmd=args[0]
    if cmd not in COMMANDS:
        variants='["Cat", "Count", "FixLengths", "Flatten", "Fmt", "Frequency", "Headers", "Help", "Index", "Input", "Join", "Partition", "Sample", "Search", "Select", "Slice", "Sort", "Split", "Stats", "Table"]'
        sys.stderr.buffer.write(("Could not match '{}' with any of the allowed variants: {}\n".format(cmd,variants)).encode()); return 1
    if any(a in ("-h","--help") for a in args[1:]):
        sys.stdout.buffer.write(command_help(cmd).encode()); return 0
    try:COMMANDS[cmd](args[1:]); return 0
    except BrokenPipeError:return 0
    except (XsvError,OSError,IndexError,ValueError) as e:
        sys.stderr.buffer.write((str(e)+"\n").encode("utf-8", "replace")); return 1


if __name__=="__main__":
    sys.exit(main())
