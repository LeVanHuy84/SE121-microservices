import tempfile
import requests

class AudioDownloader:
    def download(self, url: str):
        response = requests.get(url, stream=True, timeout=10)
        response.raise_for_status()

        with tempfile.NamedTemporaryFile(delete=False, suffix=".mp3") as tmp:
            for chunk in response.iter_content(8192):
                if chunk:
                    tmp.write(chunk)

        return tmp.name