from prompt_toolkit.formatted_text.html import HTML
from prompt_toolkit.history import FileHistory
from prompt_toolkit.shortcuts import PromptSession

from minisweagent import global_config_dir

_history = FileHistory(global_config_dir / "interactive_history.txt")


class _LazyPromptSession:
    def __init__(self, *, multiline: bool = False):
        self.multiline = multiline
        self._session = None

    def prompt(self, *args, **kwargs):
        if self._session is None:
            self._session = PromptSession(history=_history, multiline=self.multiline)
        return self._session.prompt(*args, **kwargs)


prompt_session = _LazyPromptSession()
_multiline_prompt_session = _LazyPromptSession(multiline=True)


def _multiline_prompt() -> str:
    return _multiline_prompt_session.prompt(
        "",
        bottom_toolbar=HTML(
            "Submit message: <b fg='yellow' bg='black'>Esc, then Enter</b> | "
            "Navigate history: <b fg='yellow' bg='black'>Arrow Up/Down</b> | "
            "Search history: <b fg='yellow' bg='black'>Ctrl+R</b>"
        ),
    )
