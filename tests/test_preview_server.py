import unittest

from scripts.serve import ROOT, is_allowed_path


class PreviewServerScopeTests(unittest.TestCase):
    def test_portfolio_assets_are_allowed(self):
        for relative in ("index.html", "src/app.js", "src/styles.css", "docs/screenshots.md", "docs/homepage.jpg"):
            with self.subTest(path=relative):
                self.assertTrue(is_allowed_path(ROOT / relative))

    def test_workspace_files_and_hidden_paths_are_blocked(self):
        for relative in (
            "README.md",
            "package.json",
            "scripts/serve.py",
            "tests/model.test.js",
            ".aws/credentials",
            ".git/config",
            "../.aws/credentials",
        ):
            with self.subTest(path=relative):
                self.assertFalse(is_allowed_path(ROOT / relative))


if __name__ == "__main__":
    unittest.main()
