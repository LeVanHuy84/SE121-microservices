import sys
import logging
from typing import List, Dict, Any
from datasets import load_dataset

# Ensure UTF-8 output encoding on Windows console
if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# ViHSD Label Mapping
# 0: CLEAN (Safe)
# 1: OFFENSIVE (Profanity / Venting)
# 2: HATE (Hate speech / Direct insult)
VIHSD_LABEL_NAMES = ["CLEAN", "OFFENSIVE", "HATE"]

# Candidate repositories on Hugging Face (visolex/ViHSD is public, ungated)
VIHSD_DATASET_CANDIDATES = [
    "visolex/ViHSD",
    "visolex/vihsd",
    "uitnlp/vihsd"
]


def load_uit_vihsd_dataset() -> Dict[str, List[Dict[str, Any]]]:
    """
    Load dataset from HuggingFace (visolex/ViHSD or uitnlp/vihsd).
    Provides train, dev, and test splits with standardized format.
    """
    ds = None
    loaded_name = None

    for candidate in VIHSD_DATASET_CANDIDATES:
        try:
            logger.info(f"Attempting to load baseline dataset '{candidate}' from HuggingFace...")
            ds = load_dataset(candidate)
            loaded_name = candidate
            logger.info(f"Successfully loaded '{candidate}'! Splits: {list(ds.keys())}")
            break
        except Exception as e:
            logger.warning(f"Could not load '{candidate}': {e}")
            continue

    if not ds:
        logger.error("Failed to load ViHSD dataset from all HuggingFace candidates.")
        return {"train": [], "dev": [], "test": []}

    try:
        train_data = [x for x in ds["train"]] if "train" in ds else []
        dev_data = [x for x in ds["validation"]] if "validation" in ds else ([x for x in ds["dev"]] if "dev" in ds else [])
        test_data = [x for x in ds["test"]] if "test" in ds else []

        if not test_data and train_data:
            # If dataset has no separate test split, split 80/20 from train
            split_idx = int(len(train_data) * 0.8)
            test_data = train_data[split_idx:]
            train_data = train_data[:split_idx]

        if not dev_data and len(train_data) > 0:
            split_idx = int(len(train_data) * 0.9)
            dev_data = train_data[split_idx:]
            train_data = train_data[:split_idx]

        logger.info(
            f"Successfully formatted ViHSD ({loaded_name}): Train={len(train_data)}, Dev={len(dev_data)}, Test={len(test_data)}"
        )

        return {
            "train": train_data,
            "dev": dev_data,
            "test": test_data,
            "source": loaded_name
        }
    except Exception as e:
        logger.error(f"Error processing ViHSD dataset splits: {e}")
        return {"train": [], "dev": [], "test": []}


if __name__ == "__main__":
    data = load_uit_vihsd_dataset()
    print("Train set size:", len(data["train"]))
    print("Test set size:", len(data["test"]))
    if len(data["test"]) > 0:
        print("Sample test item:", data["test"][0])
