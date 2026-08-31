import logging
from typing import List, Dict, Any
from datasets import load_dataset

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def load_uit_vsmec_dataset() -> Dict[str, List[Dict[str, Any]]]:
    """
    Load dataset from HuggingFace visolex/UIT-VSMEC.
    If 'test' split is not directly available, split from train dataset (80/20).
    """
    logger.info("Loading dataset visolex/UIT-VSMEC...")
    try:
        ds = load_dataset("visolex/UIT-VSMEC")
        keys = list(ds.keys())
        logger.info(f"Available splits: {keys}")
        
        if "test" in ds:
            test_data = [x for x in ds["test"]]
            train_data = [x for x in ds["train"]]
        else:
            # If dataset only has 'train', split 20% for test evaluation
            all_data = [x for x in ds[keys[0]]]
            split_idx = int(len(all_data) * 0.8)
            train_data = all_data[:split_idx]
            test_data = all_data[split_idx:]
            
        logger.info(f"Loaded successfully: Train={len(train_data)}, Test={len(test_data)}")
        return {
            "train": train_data,
            "test": test_data
        }
    except Exception as e:
        logger.error(f"Failed to load dataset: {e}")
        raise e


if __name__ == "__main__":
    data = load_uit_vsmec_dataset()
    print("Test set size:", len(data["test"]))
    if len(data["test"]) > 0:
        print("Sample item:", data["test"][0])
