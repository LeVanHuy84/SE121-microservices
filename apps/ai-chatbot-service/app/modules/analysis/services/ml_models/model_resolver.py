import logging
from pathlib import Path
from typing import Optional, Tuple, List
from huggingface_hub import hf_hub_download

logger = logging.getLogger(__name__)


def parse_huggingface_target(
    raw_target: str,
) -> Tuple[str, Optional[str], Optional[str]]:
    """
    Parse free-style Hugging Face path / URI into (repo_id, subfolder, filename).

    Examples:
      - "huyleit/phobert-vi-moderation-v1.1/onnx/phobert_moderation_fp32.onnx"
        -> repo_id="huyleit/phobert-vi-moderation-v1.1", subfolder="onnx", filename="phobert_moderation_fp32.onnx"
      - "huyleit/mert-v1-95m-music-emotion-int8/mert_emotion_int8.onnx"
        -> repo_id="huyleit/mert-v1-95m-music-emotion-int8", subfolder=None, filename="mert_emotion_int8.onnx"
      - "huyleit/phobert-emotion-social/onnx"
        -> repo_id="huyleit/phobert-emotion-social", subfolder="onnx", filename=None
      - "huyleit/phobert-emotion-social"
        -> repo_id="huyleit/phobert-emotion-social", subfolder=None, filename=None
    """
    cleaned = raw_target.strip()
    if cleaned.startswith("hf://"):
        cleaned = cleaned[5:]
    elif cleaned.startswith("https://huggingface.co/"):
        cleaned = cleaned[23:]
    elif cleaned.startswith("http://huggingface.co/"):
        cleaned = cleaned[22:]

    # Remove trailing slash
    cleaned = cleaned.rstrip("/")
    parts = cleaned.split("/")

    # HF repo_id is usually "owner/repo" (2 parts) or single name (1 part)
    if len(parts) == 1:
        return parts[0], None, None

    if len(parts) == 2:
        # e.g., "huyleit/phobert-emotion-social"
        return f"{parts[0]}/{parts[1]}", None, None

    repo_id = f"{parts[0]}/{parts[1]}"
    remaining_parts = parts[2:]

    # Check if the last part is a file (has extension like .onnx)
    if "." in remaining_parts[-1]:
        filename = remaining_parts[-1]
        subfolder_parts = remaining_parts[:-1]
        subfolder = "/".join(subfolder_parts) if subfolder_parts else None
        return repo_id, subfolder, filename

    # It's a subfolder without explicit filename
    subfolder = "/".join(remaining_parts)
    return repo_id, subfolder, None


def resolve_onnx_model(
    model_path_or_repo: str,
    explicit_onnx_path: str = "",
    precision: str = "fp32",
    model_type_hint: str = "phobert_emotion",
    candidate_local_dirs: Optional[List[Path]] = None,
) -> Tuple[str, str]:
    """
    Resolves local or remote ONNX model weights and tokenizer repo/path.

    Returns:
        (resolved_onnx_file_path, tokenizer_repo_or_dir)
    """
    precision = (precision or "fp32").lower()

    # -------------------------------------------------------------
    # 1. Check explicit ONNX path from env (if provided)
    # -------------------------------------------------------------
    if explicit_onnx_path:
        explicit_p = Path(explicit_onnx_path)
        if explicit_p.is_file():
            logger.info(
                "[ModelResolver] Found explicit local ONNX file: %s", explicit_p
            )
            return str(explicit_p.resolve()), model_path_or_repo
        if explicit_p.is_dir():
            for fname in [
                f"{model_type_hint}_{precision}.onnx",
                f"{model_type_hint}.onnx",
                "model.onnx",
            ]:
                target = explicit_p / fname
                if target.is_file():
                    logger.info(
                        "[ModelResolver] Found ONNX file in explicit directory: %s",
                        target,
                    )
                    return str(target.resolve()), model_path_or_repo
            onnx_files = list(explicit_p.glob("*.onnx"))
            if onnx_files:
                logger.info(
                    "[ModelResolver] Found ONNX file in explicit directory: %s",
                    onnx_files[0],
                )
                return str(onnx_files[0].resolve()), model_path_or_repo

    # -------------------------------------------------------------
    # 2. Check if model_path_or_repo points directly to local file/dir
    # -------------------------------------------------------------
    local_p = Path(model_path_or_repo)
    if local_p.is_file() and local_p.suffix == ".onnx":
        logger.info("[ModelResolver] Using local ONNX file: %s", local_p)
        tokenizer_source = str(local_p.parent.resolve())
        return str(local_p.resolve()), tokenizer_source

    if local_p.is_dir():
        for fname in [
            f"{model_type_hint}_{precision}.onnx",
            f"onnx/{model_type_hint}_{precision}.onnx",
            f"{model_type_hint}.onnx",
            "model.onnx",
        ]:
            target = local_p / fname
            if target.is_file():
                logger.info("[ModelResolver] Found local ONNX model in dir: %s", target)
                return str(target.resolve()), str(local_p.resolve())
        onnx_files = list(local_p.glob("**/*.onnx"))
        if onnx_files:
            logger.info(
                "[ModelResolver] Found local ONNX file in dir: %s", onnx_files[0]
            )
            return str(onnx_files[0].resolve()), str(local_p.resolve())

    # -------------------------------------------------------------
    # 3. Check Monorepo candidate local directories
    # -------------------------------------------------------------
    if candidate_local_dirs:
        candidate_filenames = [
            f"{model_type_hint}_{precision}.onnx",
            f"{model_type_hint}_int8.onnx"
            if precision != "int8"
            else f"{model_type_hint}_fp32.onnx",
            f"{model_type_hint}.onnx",
            "model.onnx",
        ]
        for cdir in candidate_local_dirs:
            for fname in candidate_filenames:
                target = cdir / fname
                if target.is_file():
                    logger.info(
                        "[ModelResolver] Found local monorepo ONNX weights at: %s",
                        target,
                    )
                    parsed_repo, _, _ = parse_huggingface_target(model_path_or_repo)
                    return str(target.resolve()), parsed_repo

    # -------------------------------------------------------------
    # 4. Hugging Face Hub (Free-Style URL/Repo/Subfolder/Filename)
    # -------------------------------------------------------------
    repo_id, subfolder, explicit_filename = parse_huggingface_target(model_path_or_repo)

    # 4a. If specific filename was provided in the target string
    if explicit_filename:
        try:
            logger.info(
                "[ModelResolver] Downloading specific file from Hugging Face Hub (repo: %s, file: %s, subfolder: %s)...",
                repo_id,
                explicit_filename,
                subfolder,
            )
            downloaded = hf_hub_download(
                repo_id=repo_id,
                filename=explicit_filename,
                subfolder=subfolder,
            )
            return downloaded, repo_id
        except Exception as err:
            logger.warning(
                "[ModelResolver] Could not download exact file %s from subfolder %s: %s. Trying fallback candidates...",
                explicit_filename,
                subfolder,
                err,
            )

    # 4b. Dynamic candidate resolution based on subfolder and precision
    download_candidates = []
    if subfolder:
        download_candidates.extend(
            [
                (f"{model_type_hint}_{precision}.onnx", subfolder),
                (f"{model_type_hint}.onnx", subfolder),
                (f"model_{precision}.onnx", subfolder),
                ("model.onnx", subfolder),
            ]
        )

    download_candidates.extend(
        [
            (f"{model_type_hint}_{precision}.onnx", "onnx"),
            (f"{model_type_hint}_{precision}.onnx", None),
            (
                f"{model_type_hint}_int8.onnx"
                if precision == "int8"
                else f"{model_type_hint}_fp32.onnx",
                "onnx",
            ),
            (
                f"{model_type_hint}_int8.onnx"
                if precision == "int8"
                else f"{model_type_hint}_fp32.onnx",
                None,
            ),
            (f"{model_type_hint}.onnx", "onnx"),
            (f"{model_type_hint}.onnx", None),
            ("model.onnx", "onnx"),
            ("model.onnx", None),
        ]
    )

    for fname, sfolder in download_candidates:
        try:
            logger.info(
                "[ModelResolver] Downloading ONNX from Hugging Face Hub (repo: %s, file: %s, subfolder: %s)...",
                repo_id,
                fname,
                sfolder,
            )
            downloaded = hf_hub_download(
                repo_id=repo_id,
                filename=fname,
                subfolder=sfolder,
            )
            logger.info(
                "[ModelResolver] ✓ Successfully downloaded %s from Hugging Face", fname
            )
            return downloaded, repo_id
        except Exception as exc:
            logger.debug(
                "[ModelResolver] Candidate (%s, subfolder=%s) not found: %s",
                fname,
                sfolder,
                exc,
            )
            continue

    raise FileNotFoundError(
        f"Could not resolve or download ONNX model for '{model_path_or_repo}' (precision: {precision}, hint: {model_type_hint})"
    )
