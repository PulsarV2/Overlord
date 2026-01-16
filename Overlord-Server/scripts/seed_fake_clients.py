import argparse
import os
import random
import sqlite3
import string
import time
import uuid
from typing import Iterable, Tuple

SCHEMA = """
CREATE TABLE IF NOT EXISTS clients (
  id TEXT PRIMARY KEY,
  hwid TEXT,
  role TEXT,
  host TEXT,
  os TEXT,
  arch TEXT,
  version TEXT,
  user TEXT,
  monitors INTEGER,
  country TEXT,
  last_seen INTEGER,
  online INTEGER,
  ping_ms INTEGER
);
"""

ROLES = ["client", "viewer"]
OSES = ["windows", "linux", "darwin", "ubuntu", "debian", "arch", "kali", "fedora"]
ARCHES = ["amd64", "arm64", "x86", "arm"]
COUNTRIES = [
    "US",
    "GB",
    "DE",
    "FR",
    "ES",
    "CA",
    "AU",
    "IN",
    "BR",
    "ZA",
    "JP",
    "KR",
    "CN",
    "SG",
    "SE",
    "NO",
    "DK",
    "FI",
    "PL",
    "MX",
]


def random_host() -> str:
    prefix = random.choice(["desk", "laptop", "vm", "srv", "pc"])
    suffix = "".join(random.choices(string.ascii_lowercase + string.digits, k=6))
    return f"{prefix}-{suffix}"


def random_user() -> str:
    first = random.choice(
        ["alice", "bob", "carol", "dave", "erin", "frank", "grace", "heidi"]
    )
    num = random.randint(1, 9999)
    return f"{first}{num}"


def random_version() -> str:
    return f"{random.randint(0, 5)}.{random.randint(0, 20)}.{random.randint(0, 9)}"


def random_row(now_ms: int) -> Tuple:
    client_id = uuid.uuid4().hex
    hwid = uuid.uuid4().hex
    role = random.choice(ROLES)
    host = random_host()
    os_name = random.choice(OSES)
    arch = random.choice(ARCHES)
    version = random_version()
    user = random_user()
    monitors = random.randint(1, 3)
    country = random.choice(COUNTRIES)
    last_seen = now_ms - random.randint(0, 7 * 24 * 60 * 60 * 1000)
    online = random.choice([0, 1])
    ping_ms = random.choice([None, random.randint(10, 400), random.randint(400, 2000)])
    return (
        client_id,
        hwid,
        role,
        host,
        os_name,
        arch,
        version,
        user,
        monitors,
        country,
        last_seen,
        online,
        ping_ms,
    )


def batched_rows(count: int, batch_size: int = 500) -> Iterable[Tuple[Tuple, ...]]:
    now_ms = int(time.time() * 1000)
    batch = []
    for _ in range(count):
        batch.append(random_row(now_ms))
        if len(batch) >= batch_size:
            yield tuple(batch)
            batch = []
    if batch:
        yield tuple(batch)


def ensure_schema(conn: sqlite3.Connection) -> None:
    conn.execute(SCHEMA)


def seed(db_path: str, count: int, truncate: bool) -> None:
    conn = sqlite3.connect(db_path)
    try:
        ensure_schema(conn)
        if truncate:
            conn.execute("DELETE FROM clients")
            conn.commit()
        sql = (
            "INSERT INTO clients (id, hwid, role, host, os, arch, version, user, monitors, country, last_seen, online, ping_ms) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
        )
        total = 0
        for batch in batched_rows(count):
            conn.executemany(sql, batch)
            conn.commit()
            total += len(batch)
            print(f"Inserted {total}/{count}...")
        print(f"Done. Inserted {total} rows into {db_path}")
    finally:
        conn.close()


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Seed fake clients into overlord.db for load testing."
    )
    parser.add_argument(
        "--db",
        default="overlord.db",
        help="Path to overlord.db (default: overlord.db in CWD)",
    )
    parser.add_argument(
        "--count",
        type=int,
        default=100000,
        help="How many rows to insert (default: 10000)",
    )
    parser.add_argument(
        "--truncate", action="store_true", help="Delete existing rows before seeding"
    )
    args = parser.parse_args()

    db_path = os.path.abspath(args.db)
    print(f"Seeding {args.count} clients into {db_path} (truncate={args.truncate})")
    seed(db_path, args.count, args.truncate)


if __name__ == "__main__":
    main()
