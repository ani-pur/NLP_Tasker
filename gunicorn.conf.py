# Gunicorn reads ./gunicorn.conf.py from the working directory on its own, so
# this applies even when the compose file overrides the command. Flags on the
# command line (-b, -w, --threads) still win over anything set here.
import os
import sys

sys.path.insert(0, os.getcwd())

from gunicorn.glogging import Logger

from logic import applog


class TaskerLogger(Logger):
    """Gunicorn's own lines (boot, worker exit, errors) in the app's log format."""

    def setup(self, cfg):
        super().setup(cfg)
        for handler in self.error_log.handlers:
            handler.setFormatter(applog.LineFormatter(actor="gunicorn", area="server"))


logger_class = TaskerLogger
