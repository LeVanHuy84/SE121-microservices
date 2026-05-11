import asyncio
import argparse

from app.services.rag_document_service import rag_document_service


async def main():
    parser = argparse.ArgumentParser(description="Index assistant markdown documents into Elasticsearch")
    parser.add_argument(
        "--force",
        action="store_true",
        help="Force reindex even if docs signature has not changed",
    )
    args = parser.parse_args()
    result = await rag_document_service.index_assistant_docs(force_reindex=args.force)
    print(result)


if __name__ == "__main__":
    asyncio.run(main())
