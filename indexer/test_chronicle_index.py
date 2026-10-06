import json
import os
import tempfile
import unittest
from pathlib import Path

import chronicle_index as ci


def write_jsonl(path: Path, rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(json.dumps(r) for r in rows) + "\n", encoding="utf-8")


def assistant(tool_uses=(), model="claude-opus-5-5", usage=None, ts="2026-10-01T00:00:01Z"):
    content = [{"type": "tool_use", "name": n, "input": i} for n, i in tool_uses]
    return {"type": "assistant", "timestamp": ts, "message": {"model": model, "content": content, "usage": usage or {"input_tokens": 1, "output_tokens": 2, "cache_read_input_tokens": 30}}}


class IndexerTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.claude = self.root / ".claude"
        self.out = self.root / "out"
        proj = self.claude / "projects" / "-work-app"
        write_jsonl(proj / "s1.jsonl", [
            {"type": "user", "cwd": "/work/app", "timestamp": "2026-10-01T00:00:00Z", "message": {"content": "add a settings tab please"}},
            assistant([("Bash", {"command": "terraform apply -auto-approve"}), ("Edit", {"file_path": "/work/app/a.ts"}), ("Agent", {"subagent_type": "code-reviewer"})]),
            {"type": "user", "message": {"content": [{"type": "tool_result", "is_error": True, "content": "The user doesn't want to proceed"}]}},
            {"type": "assistant", "isApiErrorMessage": True, "message": {"content": [{"type": "text", "text": "You've hit your session limit · resets 1pm"}]}},
            {"type": "system", "subtype": "compact_boundary", "timestamp": "2026-10-01T00:05:00Z", "compactMetadata": {"trigger": "auto", "preTokens": 990000}},
            {"type": "system", "subtype": "turn_duration", "durationMs": 5000},
            {"type": "ai-title", "aiTitle": "Settings tab"},
        ])
        write_jsonl(proj / "s1" / "subagents" / "agent-1.jsonl", [assistant([("Read", {"file_path": "x"})], model="claude-sonnet-5-5")])
        write_jsonl(self.claude / "projects" / "-secret" / "s2.jsonl", [
            {"type": "user", "cwd": "/secret/case", "timestamp": "2026-10-01T00:00:00Z", "message": {"content": "confidential"}},
        ])
        write_jsonl(self.claude / "history.jsonl", [
            {"display": "再開", "project": "/work/app", "timestamp": 1759276800000},
            {"display": "/model", "project": "/work/app", "timestamp": 1759276800000},
            {"display": "secret prompt", "project": "/secret/case", "timestamp": 1759276800000},
        ])

    def tearDown(self):
        self.tmp.cleanup()

    def test_summarizes_session_counts(self):
        digest = ci.build(self.claude, self.out, ci.make_options(excludes=["/secret"], risky=["terraform apply"]))
        [s] = digest["sessions"]
        self.assertEqual(s["title"], "Settings tab")
        self.assertEqual(s["firstPrompt"], "add a settings tab please")
        self.assertEqual(s["risky"], {"terraform apply": 1})
        self.assertEqual(s["agents"], {"code-reviewer": 1})
        self.assertEqual(s["editExts"], {".ts": 1})
        self.assertEqual(s["apiErrors"], {"rateLimit": 1})
        self.assertEqual(s["denials"], 1)
        self.assertEqual(s["compactions"][0]["preTokens"], 990000)
        self.assertEqual(s["subTools"], {"Read": 1})
        self.assertEqual(s["usageByModel"]["claude-opus-5-5"]["cacheRead"], 30)

    def test_excluded_project_is_absent_everywhere(self):
        digest = ci.build(self.claude, self.out, ["/secret"])
        raw = (self.out / "digest.json").read_text(encoding="utf-8")
        self.assertNotIn("confidential", raw)
        self.assertNotIn("/secret", raw)
        self.assertEqual(digest["history"]["prompts"], 2)
        self.assertEqual(digest["history"]["resumePrompts"], 1)
        self.assertEqual(digest["history"]["slash"], {"/model": 1})

    def test_second_run_reuses_cache(self):
        ci.build(self.claude, self.out, [])
        again = ci.build(self.claude, self.out, [])
        self.assertEqual(again["stats"]["scanned"], 0)
        self.assertEqual(again["stats"]["reused"], 2)

    def test_changing_excludes_invalidates_cache(self):
        ci.build(self.claude, self.out, [])
        digest = ci.build(self.claude, self.out, ["/secret"])
        self.assertEqual(len(digest["sessions"]), 1)

    def test_removed_transcript_summary_is_kept(self):
        ci.build(self.claude, self.out, ["/secret"])
        (self.claude / "projects" / "-work-app" / "s1.jsonl").unlink()
        digest = ci.build(self.claude, self.out, ["/secret"])
        self.assertEqual([s["id"] for s in digest["sessions"]], ["s1"])



class ExclusionTest(unittest.TestCase):
    """Regression tests for the excludeProjects privacy guarantee (fail closed)."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(os.path.realpath(self.tmp.name))
        self.secret = self.root / "work" / "customer"
        (self.secret / "sub").mkdir(parents=True)
        (self.root / "work" / "customer2").mkdir()
        os.symlink(self.secret, self.root / "link")
        self.claude = self.root / ".claude"
        cases = {
            "exact": str(self.secret),
            "trailing": str(self.secret) + "/",
            "sub": str(self.secret / "sub"),
            "dotdot": str(self.root / "work" / "customer2" / ".." / "customer"),
            "viasymlink": str(self.root / "link"),
            "upper": str(self.secret).upper(),
            "nocwd": None,
            "similar": str(self.root / "work" / "customer2"),
        }
        for name, cwd in cases.items():
            first = {"type": "user", "timestamp": "2026-10-01T00:00:00Z", "message": {"content": "confidential " + name}}
            if cwd:
                first["cwd"] = cwd
            write_jsonl(self.claude / "projects" / "p" / f"{name}.jsonl", [first, assistant()])

    def tearDown(self):
        self.tmp.cleanup()

    def test_only_unrelated_project_survives(self):
        for exclude in (str(self.secret), str(self.secret) + "/"):
            digest = ci.build(self.claude, self.root / ("out" + str(len(exclude))), [exclude])
            self.assertEqual([s["id"] for s in digest["sessions"]], ["similar"], exclude)

    def test_session_that_moves_into_excluded_dir_is_dropped(self):
        write_jsonl(self.claude / "projects" / "p" / "moved.jsonl", [
            {"type": "user", "cwd": str(self.root / "work" / "customer2"), "message": {"content": "a"}},
            {"type": "user", "cwd": str(self.secret / "sub"), "message": {"content": "b"}},
        ])
        digest = ci.build(self.claude, self.root / "out", [str(self.secret)])
        self.assertNotIn("moved", [s["id"] for s in digest["sessions"]])

    def test_output_is_owner_only(self):
        out = self.root / "out"
        ci.build(self.claude, out, [str(self.secret)])
        self.assertEqual(os.stat(out).st_mode & 0o777, 0o700)
        self.assertEqual(os.stat(out / "digest.json").st_mode & 0o777, 0o600)
        self.assertEqual(os.stat(out / "cache.json").st_mode & 0o777, 0o600)


class RobustnessTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.claude = self.root / ".claude"
        self.proj = self.claude / "projects" / "-w"

    def tearDown(self):
        self.tmp.cleanup()

    def test_non_object_lines_are_skipped(self):
        path = self.proj / "s.jsonl"
        path.parent.mkdir(parents=True)
        path.write_text('null\n123\n[]\n"x"\n' + json.dumps({"type": "user", "cwd": "/w", "message": {"content": "hi"}}) + "\n", encoding="utf-8")
        (self.claude / "history.jsonl").write_text('null\n{"display": 5, "project": 7}\n', encoding="utf-8")
        digest = ci.build(self.claude, self.root / "out", [])
        self.assertEqual(digest["sessions"][0]["firstPrompt"], "hi")

    def test_usage_counted_once_per_message_id(self):
        u = {"input_tokens": 1, "output_tokens": 10, "cache_read_input_tokens": 100}
        rec = lambda tool: {"type": "assistant", "message": {"id": "m1", "model": "claude-x", "usage": u, "content": [{"type": "tool_use", "name": tool, "input": {}}]}}
        write_jsonl(self.proj / "s.jsonl", [{"type": "user", "cwd": "/w", "message": {"content": "a"}}, rec("Read"), rec("Grep")])
        [s] = ci.build(self.claude, self.root / "out", [])["sessions"]
        self.assertEqual(s["usageByModel"]["claude-x"]["cacheRead"], 100)
        self.assertEqual(s["tools"], {"Read": 1, "Grep": 1})

    def test_denials_and_note_cli_are_classified(self):
        res = lambda text: {"type": "user", "message": {"content": [{"type": "tool_result", "is_error": True, "content": text}]}}
        write_jsonl(self.proj / "s.jsonl", [
            {"type": "user", "cwd": "/w", "message": {"content": "a"}},
            assistant([("Bash", {"command": "cd vault && notes search 'x'"}), ("Bash", {"command": "git push --force-with-lease"})]),
            res("The user doesn't want to proceed with this tool use."),
            res("bash: /etc/x: Permission denied"),
            res("! [rejected] main -> main (non-fast-forward)"),
        ])
        [s] = ci.build(self.claude, self.root / "out", [])["sessions"]
        self.assertEqual((s["denials"], s["toolErrors"]), (1, 2))
        self.assertEqual(s["bashHeads"].get("notes"), 1)
        self.assertEqual(s["risky"], {})

    def test_exclude_change_keeps_deleted_history_and_negative_cache_skips_rereads(self):
        write_jsonl(self.proj / "old.jsonl", [{"type": "user", "cwd": "/w/keep", "message": {"content": "a"}}])
        write_jsonl(self.proj / "sec.jsonl", [{"type": "user", "cwd": "/w/secret", "message": {"content": "b"}}])
        ci.build(self.claude, self.root / "out", [])
        (self.proj / "old.jsonl").unlink()
        digest = ci.build(self.claude, self.root / "out", ["/w/secret"])
        self.assertEqual([s["id"] for s in digest["sessions"]], ["old"])
        again = ci.build(self.claude, self.root / "out", ["/w/secret"])
        self.assertEqual((again["stats"]["scanned"], again["stats"]["reused"]), (0, 1))


    def test_subagent_output_tokens_take_the_max_across_records(self):
        write_jsonl(self.proj / "s.jsonl", [{"type": "user", "cwd": "/w", "message": {"content": "a"}}])
        sub = lambda out: {"type": "assistant", "message": {"id": "m9", "model": "claude-sonnet-x", "usage": {"input_tokens": 3, "output_tokens": out}, "content": []}}
        write_jsonl(self.proj / "s" / "subagents" / "agent-1.jsonl", [sub(5), sub(110), sub(40)])
        [s] = ci.build(self.claude, self.root / "out", [])["sessions"]
        self.assertEqual(s["subUsage"]["claude-sonnet-x"], {"in": 3, "out": 110, "cacheRead": 0, "cacheWrite": 0})

    def test_deleted_multi_cwd_session_is_dropped_when_later_cwd_is_excluded(self):
        write_jsonl(self.proj / "multi.jsonl", [
            {"type": "user", "cwd": "/w/keep", "message": {"content": "a"}},
            {"type": "user", "cwd": "/w/secret/x", "message": {"content": "b"}},
        ])
        ci.build(self.claude, self.root / "out", [])
        (self.proj / "multi.jsonl").unlink()
        digest = ci.build(self.claude, self.root / "out", ["/w/secret"])
        self.assertEqual(digest["sessions"], [])
        self.assertNotIn("/w/secret", (self.root / "out" / "digest.json").read_text(encoding="utf-8"))


    def test_corrupt_cache_entries_are_dropped_not_fatal(self):
        out = self.root / "out"
        out.mkdir()
        (out / "cache.json").write_text(json.dumps({"schema": 0, "excludes": [], "sessions": {"x": 5, "y": {"data": {"project": "/w"}, "cwds": [1, None]}}}), encoding="utf-8")
        digest = ci.build(self.claude, out, ["/w/secret"])
        self.assertEqual([s["project"] for s in digest["sessions"]], [])


    def test_bash_heads_skip_assignments_and_exe_and_risky_is_not_double_counted(self):
        write_jsonl(self.proj / "s.jsonl", [
            {"type": "user", "cwd": "/w", "message": {"content": "a"}},
            assistant([("Bash", {"command": "FOO=1 notes search x && C:\\tools\\notes.exe get y"}), ("Bash", {"command": "sudo ls"})]),
        ])
        [s] = ci.build(self.claude, self.root / "out", ci.make_options(risky=["sudo"]))["sessions"]
        self.assertEqual(s["bashHeads"].get("notes"), 2)
        self.assertEqual(s["risky"], {"sudo": 1})

    def test_naive_timestamps_and_stale_excluded_markers(self):
        write_jsonl(self.proj / "naive.jsonl", [{"type": "user", "cwd": "/w", "timestamp": "2020-01-01T00:00:00", "message": {"content": "a"}}])
        write_jsonl(self.proj / "sec.jsonl", [{"type": "user", "cwd": "/w/secret", "message": {"content": "b"}}])
        out = self.root / "out"
        opts = ci.make_options(excludes=["/w/secret"], retention_days=30)
        ci.build(self.claude, out, opts)
        (self.proj / "naive.jsonl").unlink()
        (self.proj / "sec.jsonl").unlink()
        digest = ci.build(self.claude, out, opts)
        self.assertEqual(digest["sessions"], [])
        self.assertEqual(json.loads((out / "cache.json").read_text(encoding="utf-8"))["sessions"], {})


class OptionsTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.claude = self.root / ".claude"
        self.proj = self.claude / "projects" / "-w"

    def tearDown(self):
        self.tmp.cleanup()

    def history(self, *displays):
        write_jsonl(self.claude / "history.jsonl", [{"display": d, "project": "/w", "timestamp": 1759276800000} for d in displays])

    def test_paths_are_not_counted_as_slash_commands(self):
        self.history("/home/me/notes.md please read", "/Users/me/x", "/model", "/plugin:cmd arg", "/tmp/file")
        h = ci.build(self.claude, self.root / "out", [])["history"]
        self.assertEqual(h["slash"], {"/model": 1, "/plugin:cmd": 1})

    def test_english_resume_and_correction_prompts_count(self):
        self.history("keep going", "Continue.", "that's wrong, try again", "it still doesn't work", "please add tests")
        h = ci.build(self.claude, self.root / "out", [])["history"]
        self.assertEqual((h["resumePrompts"], h["correctionPrompts"]), (2, 2))

    def test_memory_cues_follow_the_option(self):
        self.history("as we did last time", "check the Team Wiki")
        default = ci.build(self.claude, self.root / "a", [])["history"]["memoryCuePrompts"]
        custom = ci.build(self.claude, self.root / "b", ci.make_options(memory_cues=["Team Wiki"]))["history"]["memoryCuePrompts"]
        self.assertEqual((default, custom), (1, 1))

    def test_retention_applies_only_once_the_transcript_is_gone(self):
        old = [{"type": "user", "cwd": "/w", "timestamp": "2020-01-01T00:00:00Z", "message": {"content": "a"}}]
        write_jsonl(self.proj / "old.jsonl", old)
        write_jsonl(self.proj / "new.jsonl", [{"type": "user", "cwd": "/w", "timestamp": "2099-01-01T00:00:00Z", "message": {"content": "b"}}])
        opts = ci.make_options(retention_days=30)
        out = self.root / "out"
        # Claude Code still keeps the old transcript, so its summary stays and is not re-read.
        self.assertEqual([s["id"] for s in ci.build(self.claude, out, opts)["sessions"]], ["old", "new"])
        self.assertEqual(ci.build(self.claude, out, opts)["stats"]["scanned"], 0)
        # Once the transcript is deleted, the old summary falls outside the window and goes.
        (self.proj / "old.jsonl").unlink()
        self.assertEqual([s["id"] for s in ci.build(self.claude, out, opts)["sessions"]], ["new"])

    def test_purge_removes_what_the_indexer_wrote(self):
        out = self.root / "out"
        ci.build(self.claude, out, [])
        self.assertEqual(sorted(ci.purge(out)), ["cache.json", "digest.json"])
        self.assertFalse(out.exists())


if __name__ == "__main__":
    unittest.main()
