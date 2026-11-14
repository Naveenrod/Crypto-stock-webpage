"""
Thread pools that keep CPU-heavy ML work off the asyncio event loop.

Previously every endpoint was `async def` but called synchronous, CPU-bound
code directly, which froze the whole API (health checks included) for the
duration of each prediction. Interactive predictions now run on `ml_executor`
and the background Top-Picks scan on `scan_executor`, so a running scan can
at most halve the speed of a user's prediction instead of blocking it.

Pool sizes default to min(2, cpu_count) and can be tuned with ML_WORKERS /
SCAN_WORKERS. On a 1-vCPU VM both default to 1.
"""
import asyncio
import functools
import os
from concurrent.futures import ThreadPoolExecutor

_cpus = os.cpu_count() or 1
ML_WORKERS   = int(os.getenv("ML_WORKERS",   str(max(1, min(2, _cpus)))))
SCAN_WORKERS = int(os.getenv("SCAN_WORKERS", str(max(1, min(2, _cpus)))))

ml_executor   = ThreadPoolExecutor(max_workers=ML_WORKERS,   thread_name_prefix="ml")
scan_executor = ThreadPoolExecutor(max_workers=SCAN_WORKERS, thread_name_prefix="scan")


async def run_ml(fn, *args, **kwargs):
    """Await a blocking ML function on the interactive ML pool."""
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(ml_executor, functools.partial(fn, *args, **kwargs))
