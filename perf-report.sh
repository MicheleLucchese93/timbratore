#!/bin/bash
# Per-route latency report for prod sonoQui, from the API container log.
#
# The http log line carries durMs / dbMs / bytes / tenant per request (see
# apps/backend/src/middleware/request-logger.ts); this aggregates it. Read-only:
# it runs `docker logs` and SELECTs pg_stat_statements, nothing else.
#
# Everything happens in ONE ssh session on purpose. Many rapid connections get
# the egress IP banned by the sshd fail2ban jail on this box.
#
# Scope note: the container log is capped (20MB x 5) and starts fresh on every
# deploy, so this only ever sees the current container's lifetime. For history
# across deploys use the weekly digest / request_metrics table instead.
#
# Usage:
#   ./perf-report.sh                       # whole retained log
#   ./perf-report.sh --since 2h            # last 2 hours
#   ./perf-report.sh --tenant 165dbe4a     # one tenant (id or prefix)
#   ./perf-report.sh --min 3 --top 40      # only routes with >=3 calls, 40 rows
set -euo pipefail

SERVER="ubuntu@57.131.52.5"
SSH_PORT=2222
SINCE=""
TENANT=""
MIN=3
TOP=40

while [ $# -gt 0 ]; do
  case "$1" in
    --since)  SINCE="${2:-}"; shift 2 ;;
    --tenant) TENANT="${2:-}"; shift 2 ;;
    --min)    MIN="${2:-}";    shift 2 ;;
    --top)    TOP="${2:-}";    shift 2 ;;
    -h|--help) sed -n '2,25p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done

# Validate before interpolating into the remote script — these values end up
# inside a command line on the server.
[[ -z "$SINCE"  || "$SINCE"  =~ ^[0-9]+[smhd]$        ]] || { echo "--since wants e.g. 30m, 2h, 3d" >&2; exit 2; }
[[ -z "$TENANT" || "$TENANT" =~ ^[0-9a-fA-F-]{4,36}$  ]] || { echo "--tenant wants a uuid or a hex prefix" >&2; exit 2; }
[[ "$MIN" =~ ^[0-9]+$ ]] || { echo "--min wants an integer" >&2; exit 2; }
[[ "$TOP" =~ ^[0-9]+$ ]] || { echo "--top wants an integer" >&2; exit 2; }

SINCE_ARG=""
[ -n "$SINCE" ] && SINCE_ARG="--since $SINCE"

# The parameters are prepended as assignments to the piped script rather than
# passed as an env prefix on the ssh command line: ssh flattens its command args
# into one string for the remote login shell, so `SINCE_ARG=--since 6h` there
# splits and the shell tries to run `6h`. %q keeps the quoting intact.
{
  printf 'MIN=%q\nTOP=%q\nTENANT=%q\nSINCE_ARG=%q\n' "$MIN" "$TOP" "$TENANT" "$SINCE_ARG"
  cat <<'REMOTE'
set -uo pipefail
echo "container started : $(docker inspect sonoqui-api --format '{{.State.StartedAt}}')"
echo "window            : ${SINCE_ARG:-whole retained log}${TENANT:+   tenant=$TENANT}"

docker logs sonoqui-api $SINCE_ARG 2>&1 | grep '"name":"http"' > /tmp/perf-http.jsonl || true
echo "http lines        : $(wc -l < /tmp/perf-http.jsonl)"
echo

MIN="$MIN" TOP="$TOP" TENANT="$TENANT" python3 <<'PY'
import json, os, collections

MIN, TOP, TENANT = int(os.environ['MIN']), int(os.environ['TOP']), os.environ['TENANT']
stats = collections.defaultdict(lambda: {'dur': [], 'db': [], 'app': [], 'bytes': 0, 's4': 0, 's5': 0})
total = kept = 0

for line in open('/tmp/perf-http.jsonl'):
    try:
        o = json.loads(line)
    except Exception:
        continue
    if o.get('durMs') is None:
        continue
    total += 1
    if o.get('route') == '/health':
        continue
    if TENANT and not (o.get('tenant') or '').startswith(TENANT):
        continue
    kept += 1
    s = stats[f"{o.get('method')} {o.get('route')}"]
    dur, db = o['durMs'], o.get('dbMs', 0)
    s['dur'].append(dur); s['db'].append(db); s['app'].append(max(0, dur - db))
    s['bytes'] = max(s['bytes'], o.get('bytes', 0))
    st = o.get('status', 0)
    if st >= 500: s['s5'] += 1
    elif st >= 400: s['s4'] += 1

def pct(v, p):
    v = sorted(v)
    return v[min(len(v) - 1, max(0, -(-len(v) * p // 100) - 1))] if v else 0

rows = []
for route, s in stats.items():
    rows.append((pct(s['dur'], 95), max(s['dur']), pct(s['dur'], 50),
                 pct(s['db'], 50), max(s['db']), pct(s['app'], 50), max(s['app']),
                 len(s['dur']), s['bytes'], s['s4'], s['s5'], route))
rows.sort(reverse=True)

print(f"non-health requests: {kept}  (of {total} incl. /health)")
print()
hdr = f"{'p95':>6}{'max':>7}{'p50':>6} | {'db50':>5}{'dbMax':>6} | {'app50':>6}{'appMax':>7} | {'n':>5}{'maxB':>8}{'4xx':>5}{'5xx':>5}  route"
print(hdr); print('-' * len(hdr))
shown = 0
for r in rows:
    if r[7] < MIN: continue
    if shown >= TOP: break
    shown += 1
    print(f"{r[0]:>6}{r[1]:>7}{r[2]:>6} | {r[3]:>5}{r[4]:>6} | {r[5]:>6}{r[6]:>7} | "
          f"{r[7]:>5}{r[8]:>8}{r[9] or '':>5}{r[10] or '':>5}  {r[11]}")
hidden = sum(1 for r in rows if r[7] >= MIN) - shown
below = sum(1 for r in rows if r[7] < MIN)
if hidden > 0 or below > 0:
    print(f"\n({hidden} more route(s) past --top {TOP}; {below} below --min {MIN} — not shown)")
PY

echo
echo "=== slowest individual requests ==="
jq -r --arg t "$TENANT" 'select(.durMs!=null and .route!="/health")
  | select($t=="" or ((.tenant//"")|startswith($t)))
  | [.durMs,.dbMs,.dbCalls,.bytes,.status,(.method+" "+.route),((.tenant//"-")[0:8]),.reqId] | @tsv' \
  /tmp/perf-http.jsonl | sort -rn | head -10 \
  | awk 'BEGIN{printf "%6s %6s %4s %8s %5s  %-40s %-9s %s\n","dur","db","nQ","bytes","st","route","tenant","reqId"}
         {printf "%6s %6s %4s %8s %5s  %-40s %-9s %s\n",$1,$2,$3,$4,$5,$6" "$7,$8,$9}'

echo
echo "=== warnings ==="
SR=$(docker logs sonoqui-api $SINCE_ARG 2>&1 | grep -c '"slow request"' || true)
SQ=$(docker logs sonoqui-api $SINCE_ARG 2>&1 | grep -c '"slow query"'   || true)
echo "slow requests: $SR    slow queries: $SQ"
[ "$SR" != "0" ] && docker logs sonoqui-api $SINCE_ARG 2>&1 | grep '"slow request"' \
  | jq -r '["  ",(.durMs|tostring)+"ms",(.dbMs|tostring)+"ms db",.route,((.tenant//"-")[0:8])]|@tsv' | sort -rn | head -8
[ "$SQ" != "0" ] && docker logs sonoqui-api $SINCE_ARG 2>&1 | grep '"slow query"' \
  | jq -r '["  ",(.durMs|tostring)+"ms",(.sql[0:100])]|@tsv' | sort -rn | head -8

echo
echo "=== pg_stat_statements: top 10 by mean (calls>=5) ==="
echo "    excluded as noise: the centrifugo outbox poll (~10x/s at ~0.03ms, it would"
echo "    otherwise fill every row), transaction control, and COPY (pg_dump backups —"
echo "    the application itself issues no COPY)"
docker exec postgres psql -U penno -d sonoqui -X -c "
  SELECT calls,
         mean_exec_time::numeric(10,1) AS mean_ms,
         max_exec_time::numeric(10,1)  AS max_ms,
         total_exec_time::numeric(12,0) AS total_ms,
         left(regexp_replace(query,'\s+',' ','g'), 95) AS query
    FROM pg_stat_statements
   WHERE calls >= 5
     AND query NOT LIKE '%centrifugo_outbox%'
     AND query NOT LIKE '%pg_advisory_xact_lock%'
     AND query NOT LIKE 'begin%' AND query NOT LIKE 'BEGIN%'
     AND query NOT LIKE 'COMMIT%' AND query NOT LIKE 'ROLLBACK%'
     AND query NOT LIKE 'COPY %'
   ORDER BY mean_exec_time DESC
   LIMIT 10;"

echo "=== request_metrics (persisted history, survives deploys) ==="
if ! docker exec postgres psql -U penno -d sonoqui -X -tAc \
      "SELECT to_regclass('public.request_metrics') IS NOT NULL" | grep -q '^t$'; then
  echo "  (table absent — migration 062 not applied on this database yet)"
  exit 0
fi
docker exec postgres psql -U penno -d sonoqui -X -c "
  SELECT date_trunc('day', bucket_start)::date AS day,
         sum(n)                AS requests,
         max(dur_p95)          AS worst_hour_p95_ms,
         max(dur_max)          AS max_ms,
         sum(n_5xx)            AS n_5xx
    FROM request_metrics
   GROUP BY 1 ORDER BY 1 DESC LIMIT 10;" 2>&1 | tail -16
REMOTE
} | ssh -o ConnectTimeout=15 -p "$SSH_PORT" "$SERVER" 'bash -s'
