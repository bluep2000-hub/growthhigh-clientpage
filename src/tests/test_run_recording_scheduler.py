import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock


SRC = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SRC))

from run_recording_scheduler import (  # noqa: E402
    PROCESS_SCRIPT,
    console_python,
    rotate_log,
    run_once,
)


class RecordingSchedulerRunnerTests(unittest.TestCase):
    def test_console_python_uses_sibling_of_pythonw(self):
        with tempfile.TemporaryDirectory() as temp:
            folder = Path(temp)
            pythonw = folder / "pythonw.exe"
            python = folder / "python.exe"
            pythonw.touch()
            python.touch()

            self.assertEqual(console_python(pythonw), python)

    def test_rotate_log_keeps_one_previous_copy(self):
        with tempfile.TemporaryDirectory() as temp:
            log = Path(temp) / "scheduler.log"
            log.write_text("12345", encoding="utf-8")

            rotate_log(log, max_bytes=5)

            self.assertFalse(log.exists())
            self.assertEqual(
                (Path(temp) / "scheduler.log.1").read_text(encoding="utf-8"),
                "12345",
            )

    @mock.patch("run_recording_scheduler.subprocess.run")
    def test_run_once_calls_pipeline_and_records_result(self, run):
        run.return_value.returncode = 0
        with tempfile.TemporaryDirectory() as temp:
            log = Path(temp) / "scheduler.log"
            fake_python = Path(temp) / "python.exe"
            fake_python.touch()

            result = run_once(log_path=log, python_executable=fake_python)

            self.assertEqual(result, 0)
            command = run.call_args.args[0]
            self.assertEqual(command, [str(fake_python), str(PROCESS_SCRIPT)])
            self.assertEqual(run.call_args.kwargs["cwd"], PROCESS_SCRIPT.parents[1])
            self.assertIs(run.call_args.kwargs["stderr"], subprocess.STDOUT)
            contents = log.read_text(encoding="utf-8")
            self.assertIn("자동화 시작", contents)
            self.assertIn("자동화 종료 code=0", contents)


if __name__ == "__main__":
    unittest.main()
