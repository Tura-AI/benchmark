#!/usr/bin/env python3
import csv
import os
import random
import shutil
import string
import subprocess
import sys
import tempfile


ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
with open(os.path.join(ROOT, 'REFERENCE_BINARY.txt'), 'r', encoding='utf-8') as f:
    REF = f.read().strip()
PORT = os.path.join(ROOT, 'xsv_port.py')


def run(cmd, cwd, stdin=None):
    if cmd[0] == 'PORT':
        argv = [sys.executable, PORT] + cmd[1:]
    else:
        argv = [REF] + cmd[1:]
    p = subprocess.run(argv, cwd=cwd, input=stdin, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    return p.returncode, p.stdout, p.stderr


def write_csv(path, rows):
    with open(path, 'w', newline='', encoding='utf-8') as f:
        w = csv.writer(f, lineterminator='\n')
        w.writerows(rows)


def text(rng):
    alphabet = string.ascii_letters + string.digits + ' _-.'
    return ''.join(rng.choice(alphabet) for _ in range(rng.randrange(0, 12)))


def valid_rows(rng):
    cols = rng.randrange(1, 6)
    rows = [[text(rng) or ('h%d' % i) for i in range(cols)]]
    for _ in range(rng.randrange(0, 20)):
        rows.append([text(rng) for _ in range(cols)])
    return rows


def command_samples(rng, path):
    sels = ['1', '1-', '-1', '1-1', '!1', '1,1']
    regexes = ['a', '^a', '[0-9]', 'ZzZ']
    yield ['headers', path]
    yield ['headers', '--just-names', path]
    yield ['count', path]
    yield ['select', rng.choice(sels), path]
    yield ['slice', '--start', str(rng.randrange(0, 5)), '--len', str(rng.randrange(0, 5)), path]
    yield ['search', rng.choice(regexes), path]
    yield ['sort', path]
    yield ['sort', '--select', '1', path]
    yield ['table', path]
    yield ['fmt', path]
    yield ['frequency', path]
    yield ['frequency', '--limit', str(rng.randrange(1, 4)), path]
    yield ['stats', path]


def invalid_samples(path):
    return [
        ['select', '999', path],
        ['search', '[', path],
        ['count', '--delimiter', 'bad', path],
        ['headers', '__missing__.csv'],
    ]


def main():
    rng = random.Random(os.environ.get('VERIFIER_SEED'))
    with tempfile.TemporaryDirectory() as td:
        for i in range(16):
            name = 'data%d.csv' % i
            write_csv(os.path.join(td, name), valid_rows(rng))
            for args in command_samples(rng, name):
                oracle = run(['REF'] + args, td)
                actual = run(['PORT'] + args, td)
                if oracle != actual:
                    sys.stderr.write('mismatch valid %r\nref=%r\nport=%r\n' % (args, oracle, actual))
                    return 1
        write_csv(os.path.join(td, 'bad.csv'), valid_rows(rng))
        for args in invalid_samples('bad.csv'):
            oracle = run(['REF'] + args, td)
            actual = run(['PORT'] + args, td)
            if oracle != actual:
                sys.stderr.write('mismatch invalid %r\nref=%r\nport=%r\n' % (args, oracle, actual))
                return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
