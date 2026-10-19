"""Run real Bash classifier against an isolated, synthetic Git repository."""
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

DEPLOY = Path(__file__).resolve().parents[1] / "scripts/deploy-production.sh"
COMPOSE = "services:\n  l2:\n    image: l2-old\n    healthcheck:\n      test: [old]\n      interval: 20s\n  web-blue:\n    image: web-unchanged\n"


@unittest.skipUnless(os.name == "posix" and shutil.which("bash") and shutil.which("git"), "requires existing Bash and Git; separately run on Linux host")
class DeployScopeTests(unittest.TestCase):
    def check(self, after, path="compose.web.yml"):
        text=DEPLOY.read_text(encoding="utf-8")
        start=text.index("compose_change_is_l2_health_only() {")
        end=text.index("\n}",text.index("classify_changed_path() {",start))+2
        functions=text[start:end]
        with tempfile.TemporaryDirectory(prefix="l2-health-scope-") as folder:
            root=Path(folder)
            def git(*args):
                return subprocess.check_output(["git","-C",folder,*args],stderr=subprocess.DEVNULL,text=True).strip()
            git("init","--quiet")
            f=root/"compose.web.yml";f.write_text(COMPOSE)
            git("add","compose.web.yml")
            git("-c","user.name=fixture","-c","user.email=fixture@localhost","-c","commit.gpgsign=false","commit","--quiet","-m","fixture base")
            before=git("rev-parse","HEAD")
            f.write_text(after)
            git("add","compose.web.yml")
            git("-c","user.name=fixture","-c","user.email=fixture@localhost","-c","commit.gpgsign=false","commit","--quiet","--allow-empty","-m","fixture target")
            after_sha=git("rev-parse","HEAD")
            body="set -eu\n"+functions+"\nweb_build_needed=0;trainer_build_needed=0;l2_build_needed=0;web_service_needed=0;trainer_service_needed=0;l2_service_needed=0;compose_changed=0;web_support_services_needed=0;paperclip_update_needed=0\nclassify_changed_path \"$PATH_UNDER_TEST\"\nprintf '%s %s %s %s %s %s %s' \"$web_build_needed\" \"$trainer_build_needed\" \"$l2_build_needed\" \"$web_service_needed\" \"$trainer_service_needed\" \"$l2_service_needed\" \"$compose_changed\"\n"
            env=dict(os.environ,REPO_DIR=folder,deployed_sha=before,target_sha=after_sha,PATH_UNDER_TEST=path)
            r=subprocess.run(["bash","-s"],input=body,env=env,capture_output=True,text=True,timeout=8)
            self.assertEqual(r.returncode,0,r.stderr)
            return list(map(int,r.stdout.split()))

    def test_only_l2_health_block_selects_l2_service(self):
        self.assertEqual(self.check(COMPOSE.replace("[old]","[new]").replace("interval: 20s","interval: 25s")),[0,0,0,0,0,1,0])

    def test_new_health_script_is_l2_build_input(self):
        self.assertEqual(self.check(COMPOSE,path="scripts/zijin_l2_healthcheck.py"),[0,0,1,0,0,1,0])

    def test_changed_l2_image_keeps_shared_compose_path(self):
        self.assertEqual(self.check(COMPOSE.replace("image: l2-old","image: l2-new"))[-1],1)

    def test_changed_web_alongside_health_keeps_shared_compose_path(self):
        self.assertEqual(self.check(COMPOSE.replace("[old]","[new]").replace("web-unchanged","web-changed"))[-1],1)

    def test_removed_health_block_keeps_shared_compose_path(self):
        self.assertEqual(self.check(COMPOSE.replace("    healthcheck:\n      test: [old]\n      interval: 20s\n",""))[-1],1)

    def test_unchanged_compose_is_not_special_cased(self):
        self.assertEqual(self.check(COMPOSE)[-1],1)


if __name__ == "__main__":
    unittest.main()
