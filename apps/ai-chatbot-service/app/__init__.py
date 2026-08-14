import sys

# List of modules to redirect from root "app.*" to "app.modules.analysis.*"
REDIRECT_MAP = {
    "app.services": "app.modules.analysis.services",
    "app.messaging": "app.modules.analysis.messaging",
    "app.processors": "app.modules.analysis.processors",
    "app.database": "app.modules.analysis.database",
    "app.enums": "app.modules.analysis.enums",
    "app.redis": "app.modules.analysis.redis",
    "app.core.services": "app.modules.analysis.core.services",
    "app.core.dto": "app.modules.analysis.core.dto",
}

class ServiceModuleRedirector:
    def find_spec(self, fullname, path, target=None):
        for prefix, replacement in REDIRECT_MAP.items():
            if fullname == prefix or fullname.startswith(prefix + "."):
                real_name = replacement + fullname[len(prefix):]
                try:
                    # Force-import the real module
                    __import__(real_name)
                    # Map the alias in sys.modules
                    sys.modules[fullname] = sys.modules[real_name]
                    return sys.modules[real_name].__spec__
                except ImportError:
                    return None
        return None

sys.meta_path.insert(0, ServiceModuleRedirector())
