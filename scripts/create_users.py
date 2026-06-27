#!/usr/bin/env python3
"""
nagadb load test — create N user accounts and see if the database can take it.

It talks to the engine's HTTP API using the fast bulk endpoint (/api/put_batch),
which writes a whole batch with a single disk sync (group commit). That's the
only way a million inserts finishes in a sensible amount of time.

Usage:

    python3 create_users.py "nagadb://id:key@HOST:9000/id?ssl=require"
    python3 create_users.py "<connection-url>" --count 1000000 --batch 1000 --workers 12

No third-party packages required (standard library only).
"""

import argparse
import concurrent.futures
import hashlib
import json
import random
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, timedelta


# --------------------------------------------------------------------------- #
# Connection string parsing
# --------------------------------------------------------------------------- #
def parse_connection(url: str):
    """Pull the host, port and database id out of a nagadb:// connection URL."""
    parsed = urllib.parse.urlparse(url)
    if not parsed.hostname:
        sys.exit(f"Could not parse host from: {url}")
    host = parsed.hostname
    port = parsed.port or 9000
    db_id = parsed.path.strip("/") or "default"
    base_url = f"http://{host}:{port}"
    return base_url, db_id


# --------------------------------------------------------------------------- #
# One user account (realistic, varied data)
# --------------------------------------------------------------------------- #
FIRST_NAMES = [
    "James", "Mary", "John", "Patricia", "Robert", "Jennifer", "Michael",
    "Linda", "David", "Elizabeth", "William", "Barbara", "Sofia", "Mateo",
    "Olivia", "Liam", "Emma", "Noah", "Ava", "Lucas", "Mia", "Ethan",
    "Isabella", "Aarav", "Priya", "Wei", "Yuki", "Omar", "Fatima", "Chen",
    "Ananya", "Hiroshi", "Amara", "Diego", "Zara", "Ivan", "Nina", "Kofi",
]
LAST_NAMES = [
    "Smith", "Johnson", "Williams", "Brown", "Jones", "Garcia", "Miller",
    "Davis", "Rodriguez", "Martinez", "Hernandez", "Lopez", "Gonzalez",
    "Wilson", "Anderson", "Patel", "Kim", "Nguyen", "Chen", "Singh",
    "Kumar", "Sato", "Tanaka", "Ali", "Khan", "Okafor", "Mensah", "Rossi",
    "Muller", "Schmidt", "Ivanov", "Petrov", "Silva", "Santos", "Costa",
]
DOMAINS = [
    "gmail.com", "yahoo.com", "outlook.com", "hotmail.com", "icloud.com",
    "proton.me", "fastmail.com",
]
LOCATIONS = [
    ("US", "New York"), ("US", "San Francisco"), ("GB", "London"),
    ("CA", "Toronto"), ("DE", "Berlin"), ("FR", "Paris"), ("JP", "Tokyo"),
    ("IN", "Mumbai"), ("BR", "Sao Paulo"), ("AU", "Sydney"), ("NG", "Lagos"),
    ("AE", "Dubai"), ("SG", "Singapore"), ("ES", "Madrid"), ("NL", "Amsterdam"),
]
# Weighted so most users are on the free plan, like a real product.
PLANS = ["free", "free", "free", "free", "pro", "pro", "enterprise"]
TODAY = date(2026, 6, 28)


def make_user(i: int) -> tuple[str, str]:
    """Return (key, value-json) for a realistic, randomly-generated user `i`.

    Seeding the RNG with `i` keeps it reproducible AND varied, and the `i` in
    the email guarantees uniqueness across millions of rows.
    """
    rnd = random.Random(i)
    first = rnd.choice(FIRST_NAMES)
    last = rnd.choice(LAST_NAMES)
    domain = rnd.choice(DOMAINS)
    email = f"{first.lower()}.{last.lower()}{i}@{domain}"
    country, city = rnd.choice(LOCATIONS)
    age = rnd.randint(18, 75)
    phone = f"+{rnd.randint(1, 99)}-{rnd.randint(200, 999)}-{rnd.randint(1000000, 9999999)}"
    plan = rnd.choice(PLANS)
    created = (TODAY - timedelta(days=rnd.randint(0, 1095))).isoformat()
    # A fast hash (sha256). Real apps use bcrypt/argon2, but those are
    # deliberately slow and would dominate a throughput test of the *database*.
    pw_hash = hashlib.sha256(f"{email}:{rnd.random()}".encode()).hexdigest()
    value = json.dumps(
        {
            "id": i,
            "name": f"{first} {last}",
            "email": email,
            "age": age,
            "country": country,
            "city": city,
            "phone": phone,
            "plan": plan,
            "verified": rnd.random() < 0.8,
            "password_sha256": pw_hash,
            "created_at": created,
        },
        separators=(",", ":"),
    )
    return email, value


def encode_batch(start: int, end: int, db_id: str, namespace: bool) -> bytes:
    """Build the request body for users [start, end): url-enc(key)\\tval per line."""
    quote = urllib.parse.quote
    lines = []
    for i in range(start, end):
        email, value = make_user(i)
        # Namespacing makes the rows show up under this database in the console,
        # exactly like the console's own writes (db:<id>:<key>).
        key = f"db:{db_id}:user:{email}" if namespace else f"user:{email}"
        lines.append(f"{quote(key, safe='')}\t{quote(value, safe='')}")
    return "\n".join(lines).encode()


# --------------------------------------------------------------------------- #
# HTTP helpers
# --------------------------------------------------------------------------- #
def post(base_url: str, path: str, body: bytes, timeout: float = 60.0) -> dict:
    req = urllib.request.Request(
        base_url + path,
        data=body,
        method="POST",
        headers={"Content-Type": "text/plain"},
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode())


def get(base_url: str, path: str, timeout: float = 30.0) -> dict:
    with urllib.request.urlopen(base_url + path, timeout=timeout) as resp:
        return json.loads(resp.read().decode())


# --------------------------------------------------------------------------- #
# Main
# --------------------------------------------------------------------------- #
def main() -> None:
    ap = argparse.ArgumentParser(description="Create N users in a nagadb database.")
    ap.add_argument("url", help="nagadb connection URL")
    ap.add_argument("--count", type=int, default=1_000_000, help="users to create")
    ap.add_argument("--batch", type=int, default=1000, help="users per request")
    ap.add_argument("--workers", type=int, default=12, help="parallel requests")
    ap.add_argument("--no-namespace", action="store_true",
                    help="write raw keys (won't show under the db in the console)")
    args = ap.parse_args()

    base_url, db_id = parse_connection(args.url)
    namespace = not args.no_namespace

    print(f"Target   : {base_url}  (db: {db_id})")
    print(f"Creating : {args.count:,} users")
    print(f"Batch    : {args.batch}  |  Workers: {args.workers}")
    print("-" * 60)

    # Make sure the server is reachable before we start.
    try:
        stats = get(base_url, "/api/stats")
        print(f"Connected. Existing entries: {stats.get('entries', '?')}")
    except Exception as e:  # noqa: BLE001
        sys.exit(f"Cannot reach the engine at {base_url}: {e}\n"
                 f"Is it running and is port {base_url.rsplit(':', 1)[-1]} open?")

    # Preflight: confirm the bulk endpoint exists. Older servers don't have it
    # and would 404 on every batch — fail early with a clear instruction.
    try:
        post(base_url, "/api/put_batch", encode_batch(0, 1, db_id, namespace))
    except urllib.error.HTTPError as e:
        if e.code == 404:
            sys.exit(
                "\n*** Your server's engine is OUT OF DATE. ***\n"
                "It does not have the /api/put_batch endpoint yet.\n\n"
                "Fix: SSH into your server (206.206.76.106) and run:\n\n"
                "  curl -fsSL https://raw.githubusercontent.com/Legendary-Community/"
                "nagadb/main/deploy/install.sh | sudo bash\n\n"
                "Then run this script again."
            )
        raise

    done = 0
    done_lock = threading.Lock()
    start_time = time.time()

    def send(batch_start: int):
        nonlocal done
        batch_end = min(batch_start + args.batch, args.count)
        body = encode_batch(batch_start, batch_end, db_id, namespace)
        result = post(base_url, "/api/put_batch", body)
        n = result.get("count", 0)
        with done_lock:
            done += n
            # Progress line every ~25k users.
            if done % (args.batch * 25) < args.batch or done >= args.count:
                elapsed = time.time() - start_time
                rate = done / elapsed if elapsed else 0
                eta = (args.count - done) / rate if rate else 0
                print(f"  {done:>9,} / {args.count:,}  "
                      f"({rate:>10,.0f} users/sec)  ETA {eta:5.1f}s")

    batch_starts = range(0, args.count, args.batch)
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = [pool.submit(send, s) for s in batch_starts]
        for f in concurrent.futures.as_completed(futures):
            f.result()  # surface any error

    elapsed = time.time() - start_time
    print("-" * 60)
    print(f"DONE: {done:,} users in {elapsed:.1f}s  "
          f"=>  {done / elapsed:,.0f} users/sec")

    # Verify a few accounts actually landed.
    print("\nVerifying a sample...")
    ok = 0
    for i in (0, args.count // 2, args.count - 1):
        email, _ = make_user(i)
        key = f"db:{db_id}:user:{email}" if namespace else f"user:{email}"
        res = get(base_url, "/api/get?key=" + urllib.parse.quote(key, safe=""))
        if res.get("found"):
            ok += 1
            print(f"  ✓ {email}")
        else:
            print(f"  ✗ {email}  (not found)")

    stats = get(base_url, "/api/stats")
    print(f"\nEngine now reports {stats.get('entries', '?'):,} entries, "
          f"{stats.get('sstables', '?')} SSTables on disk.")
    print(f"Sample verification: {ok}/3 found.")


if __name__ == "__main__":
    main()
