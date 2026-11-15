from __future__ import annotations

import asyncio
from concurrent.futures import ThreadPoolExecutor
import functools
from typing import Callable, TypeVar

T = TypeVar("T")

CHATBOT_ML_EXECUTOR = ThreadPoolExecutor(
    max_workers=4,
    thread_name_prefix="chatbot-ml",
)

ANALYSIS_ML_EXECUTOR = ThreadPoolExecutor(
    max_workers=1,
    thread_name_prefix="analysis-ml",
)


async def run_in_chatbot_executor(
    func: Callable[..., T],
    *args: object,
    **kwargs: object,
) -> T:
    """Run a blocking ML/ONNX function on the dedicated interactive chatbot pool."""
    loop = asyncio.get_running_loop()
    call = (
        functools.partial(func, *args, **kwargs)
        if kwargs
        else functools.partial(func, *args)
    )
    return await loop.run_in_executor(CHATBOT_ML_EXECUTOR, call)


async def run_in_analysis_executor(
    func: Callable[..., T],
    *args: object,
    **kwargs: object,
) -> T:
    """Run a blocking ML/indexing function on the dedicated background analysis pool."""
    loop = asyncio.get_running_loop()
    call = (
        functools.partial(func, *args, **kwargs)
        if kwargs
        else functools.partial(func, *args)
    )
    return await loop.run_in_executor(ANALYSIS_ML_EXECUTOR, call)


def shutdown_executors(wait: bool = False) -> None:
    """Drain and shut down dedicated ML thread pools during application teardown."""
    CHATBOT_ML_EXECUTOR.shutdown(wait=wait, cancel_futures=True)
    ANALYSIS_ML_EXECUTOR.shutdown(wait=wait, cancel_futures=True)
