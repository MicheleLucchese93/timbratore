#!/usr/bin/env python3
"""Apply only SonoQui log redaction to the existing gateway configuration.

Run on the deployment host. Default is a dry run; --apply validates the full
Caddy configuration and reloads it. Unrelated gateway routing is preserved.
"""
import argparse
import datetime
import os
from pathlib import Path
import re
import subprocess

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--apply', action='store_true')
parser.add_argument('--target', type=Path, default=Path('/opt/infra/caddy/sites.d/sonoqui.caddy'))
args = parser.parse_args()


def block(text, marker):
    start = text.index(marker)
    opening = text.index('{', start)
    depth = 1
    for i in range(opening + 1, len(text)):
        depth += (text[i] == '{') - (text[i] == '}')
        if depth == 0:
            return start, i + 1
    raise ValueError('Unbalanced Caddy snippet')


source = Path(__file__).with_name('caddy-sonoqui.snippet').read_text()
start, end = block(source, '(access_log_docs)')
snippet = source[start:end]
original = args.target.read_text()
updated = original
if '(access_log_docs)' in updated:
    start, end = block(updated, '(access_log_docs)')
    updated = updated[:start] + snippet + updated[end:]
else:
    updated = snippet + '\n\n' + updated
# Every SonoQui ingress in this file gets the same filter, including proxies.
updated = re.sub(r'(?m)^([ \t]*import[ \t]+)access_log[ \t]*$', r'\1access_log_docs', updated)
print(f'SonoQui privacy log imports: {updated.count("import access_log_docs")}')
if original == updated:
    print('Gateway source already has the required log filter.')
elif not args.apply:
    print('Gateway log redaction needs synchronization; rerun with --apply.')
else:
    backup = args.target.with_name(args.target.name + '.security-' + datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ'))
    fd = os.open(backup, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    with os.fdopen(fd, 'w') as f:
        f.write(original)
    args.target.write_text(updated)
    try:
        for command in ['validate', 'reload']:
            result = subprocess.run(
                ['docker', 'exec', 'gateway', 'caddy', command, '--config', '/etc/caddy/Caddyfile', '--adapter', 'caddyfile'],
                capture_output=True, text=True, timeout=30,
            )
            if result.returncode:
                raise RuntimeError(f'Caddy {command} failed: {result.stderr[-1500:]}')
        print('Gateway validated and reloaded with document metadata redaction.')
    except BaseException:
        args.target.write_text(original)
        # The reload may have applied before its response was lost. Restore
        # both disk and running configuration, retaining the restrictive backup.
        subprocess.run(['docker', 'exec', 'gateway', 'caddy', 'reload', '--config', '/etc/caddy/Caddyfile', '--adapter', 'caddyfile'], capture_output=True, timeout=30)
        raise
