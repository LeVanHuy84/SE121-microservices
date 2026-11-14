from __future__ import annotations

import re


class ActionFenceStreamFilter:
    """Filters out ```action ... ``` and ```json:action ... ``` blocks from in-flight streaming chunks."""

    def __init__(self) -> None:
        self.inside_action_fence = False
        self.buffer = ""

    def process_chunk(self, chunk: str) -> str:
        if not chunk:
            return ""
        self.buffer += chunk
        output: list[str] = []

        while self.buffer:
            if not self.inside_action_fence:
                idx = self.buffer.find("```")
                if idx == -1:
                    if self.buffer.endswith("``"):
                        to_yield = self.buffer[:-2]
                        self.buffer = "``"
                        return "".join(output) + to_yield
                    elif self.buffer.endswith("`"):
                        to_yield = self.buffer[:-1]
                        self.buffer = "`"
                        return "".join(output) + to_yield
                    else:
                        to_yield = self.buffer
                        self.buffer = ""
                        return "".join(output) + to_yield
                else:
                    if idx > 0:
                        output.append(self.buffer[:idx])
                        self.buffer = self.buffer[idx:]
                    newline_idx = self.buffer.find("\n")
                    if newline_idx == -1 and len(self.buffer) < 20:
                        break
                    tag_line = (
                        self.buffer[:newline_idx]
                        if newline_idx != -1
                        else self.buffer[:20]
                    )
                    if re.match(
                        r"^```(?:action|json:action)(?:\s|$)", tag_line, re.IGNORECASE
                    ):
                        self.inside_action_fence = True
                        if newline_idx != -1:
                            self.buffer = self.buffer[newline_idx + 1 :]
                        else:
                            self.buffer = self.buffer[len(tag_line) :]
                    else:
                        output.append(self.buffer[:3])
                        self.buffer = self.buffer[3:]
            else:
                close_idx = self.buffer.find("```")
                if close_idx == -1:
                    self.buffer = ""
                    break
                else:
                    self.inside_action_fence = False
                    self.buffer = self.buffer[close_idx + 3 :]
                    if self.buffer.startswith("\r\n"):
                        self.buffer = self.buffer[2:]
                    elif self.buffer.startswith("\n"):
                        self.buffer = self.buffer[1:]

        return "".join(output)

    def flush(self) -> str:
        if not self.inside_action_fence and self.buffer:
            res = self.buffer
            self.buffer = ""
            return res
        self.buffer = ""
        return ""
