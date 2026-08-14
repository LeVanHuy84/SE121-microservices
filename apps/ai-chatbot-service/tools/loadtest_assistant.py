from __future__ import annotations

import argparse
import asyncio
import os
import random
import statistics
import time
from dataclasses import dataclass

import httpx
from dotenv import load_dotenv

load_dotenv()


@dataclass
class SampleResult:
    ok: bool
    status_code: int
    latency_ms: float
    error: str = ""


def percentile(values: list[float], p: int) -> float:
    if not values:
        return 0.0
    sorted_values = sorted(values)
    rank = max(0, min(len(sorted_values) - 1, int((p / 100) * len(sorted_values) + 0.999999) - 1))
    return round(float(sorted_values[rank]), 2)


def build_message(i: int) -> str:
    corpus = [
        "Cach dang bai viet moi tren Sentimeta?",
        "Huong dan tim nhom cong nghe tren Sentimeta.",
        "Lam sao de chinh quyen rieng tu ho so?",
        "Toi muon xem goi y ban be theo so thich.",
        "Vi sao tin nhan cua toi khong realtime?",
        "Cach tim bai viet da chia se trong nhom?",
    ]
    return corpus[i % len(corpus)]


async def hit_once(
    client: httpx.AsyncClient,
    endpoint: str,
    headers: dict[str, str],
    user_id: str,
    index: int,
    timeout_s: float,
) -> SampleResult:
    payload = {
        "userId": user_id,
        "message": build_message(index),
        "clientMessageId": f"00000000-0000-0000-0000-{index:012d}",
        "contexts": [],
    }
    started = time.perf_counter()
    try:
        response = await client.post(
            endpoint,
            headers=headers,
            json=payload,
            timeout=timeout_s,
        )
        latency_ms = (time.perf_counter() - started) * 1000
        ok = response.status_code < 400
        return SampleResult(ok=ok, status_code=response.status_code, latency_ms=latency_ms)
    except Exception as exc:
        latency_ms = (time.perf_counter() - started) * 1000
        return SampleResult(ok=False, status_code=0, latency_ms=latency_ms, error=str(exc))


async def run_load(
    base_url: str,
    path: str,
    headers: dict[str, str],
    total_requests: int,
    concurrency: int,
    timeout_s: float,
    warmup_requests: int,
) -> list[SampleResult]:
    endpoint = f"{base_url.rstrip('/')}/{path.lstrip('/')}"
    limits = httpx.Limits(max_keepalive_connections=concurrency, max_connections=max(concurrency * 2, 10))
    async with httpx.AsyncClient(limits=limits) as client:
        for i in range(warmup_requests):
            _ = await hit_once(client, endpoint, headers, "warmup-user", i, timeout_s)

        sem = asyncio.Semaphore(concurrency)
        results: list[SampleResult] = []

        async def worker(i: int):
            async with sem:
                user_suffix = random.randint(1, max(3, concurrency // 2))
                user_id = f"load-user-{user_suffix}"
                res = await hit_once(client, endpoint, headers, user_id, i, timeout_s)
                results.append(res)

        await asyncio.gather(*[worker(i) for i in range(total_requests)])
        return results


def print_report(results: list[SampleResult], started_at: float):
    elapsed_s = max(0.0001, time.perf_counter() - started_at)
    total = len(results)
    oks = [r for r in results if r.ok]
    fails = [r for r in results if not r.ok]
    latencies = [r.latency_ms for r in oks]
    all_latencies = [r.latency_ms for r in results]

    print("\n=== Assistant Load Test Report ===")
    print(f"Total requests: {total}")
    print(f"Success: {len(oks)}")
    print(f"Failed: {len(fails)}")
    print(f"Error rate: {round((len(fails) / total) * 100, 2) if total else 0}%")
    print(f"Elapsed: {round(elapsed_s, 2)}s")
    print(f"Throughput: {round(total / elapsed_s, 2)} req/s")
    print("")
    if latencies:
        print(f"Latency p50 (success): {percentile(latencies, 50)} ms")
        print(f"Latency p95 (success): {percentile(latencies, 95)} ms")
        print(f"Latency p99 (success): {percentile(latencies, 99)} ms")
        print(f"Latency mean (success): {round(statistics.fmean(latencies), 2)} ms")
    print(f"Latency p95 (all): {percentile(all_latencies, 95)} ms")

    if fails:
        status_count: dict[int, int] = {}
        for item in fails:
            status_count[item.status_code] = status_count.get(item.status_code, 0) + 1
        print("\nFailure breakdown by status:")
        for code, count in sorted(status_count.items(), key=lambda x: x[0]):
            print(f"  {code}: {count}")
        first_error = next((x.error for x in fails if x.error), "")
        if first_error:
            print(f"\nExample exception: {first_error}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Load test assistant endpoint.")
    parser.add_argument("--base-url", default=os.getenv("LOADTEST_BASE_URL", "http://localhost:4015"))
    parser.add_argument("--path", default=os.getenv("LOADTEST_PATH", "/assistant/respond"))
    parser.add_argument("--requests", type=int, default=int(os.getenv("LOADTEST_REQUESTS", "200")))
    parser.add_argument("--concurrency", type=int, default=int(os.getenv("LOADTEST_CONCURRENCY", "20")))
    parser.add_argument("--timeout", type=float, default=float(os.getenv("LOADTEST_TIMEOUT_SECONDS", "20")))
    parser.add_argument("--warmup", type=int, default=int(os.getenv("LOADTEST_WARMUP", "10")))
    parser.add_argument("--internal-key", default=os.getenv("INTERNAL_SERVICE_KEY", ""))
    parser.add_argument("--bearer-token", default=os.getenv("LOADTEST_BEARER_TOKEN", ""))
    return parser.parse_args()


async def main():
    args = parse_args()
    headers: dict[str, str] = {"Content-Type": "application/json"}
    if args.internal_key:
        headers["x-internal-key"] = args.internal_key
    if args.bearer_token:
        headers["Authorization"] = f"Bearer {args.bearer_token}"

    started_at = time.perf_counter()
    results = await run_load(
        base_url=args.base_url,
        path=args.path,
        headers=headers,
        total_requests=max(1, args.requests),
        concurrency=max(1, args.concurrency),
        timeout_s=max(1.0, args.timeout),
        warmup_requests=max(0, args.warmup),
    )
    print_report(results, started_at)


if __name__ == "__main__":
    asyncio.run(main())

