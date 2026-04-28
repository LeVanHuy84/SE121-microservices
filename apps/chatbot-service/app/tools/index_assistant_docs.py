from app.services.rag_document_service import rag_document_service


def main():
    result = rag_document_service.index_assistant_docs()
    print(result)


if __name__ == "__main__":
    main()
