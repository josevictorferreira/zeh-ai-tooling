# Shared by browser-dev-cycle and ultimate-browsing: the packages every
# browser-skill wrapper puts on PATH, plus the shared `browser-skills-runtime`
# wrapper both skills declare (identical definitions merge).
{ pkgs }:
rec {
  pythonEnv = pkgs.python3.withPackages (ps: [
    ps."curl-cffi"
    ps.beautifulsoup4
    ps.cryptography
    ps.pyyaml
    ps.secretstorage
    ps.feedparser
  ]);

  packages = [
    pkgs.nodejs
    pkgs.curl
    pkgs.gh
    pkgs.yt-dlp
    pkgs.agent-browser
    pkgs.mcporter
    pythonEnv
    pkgs.playwright
  ];

  wrappers.browser-skills-runtime.packages = packages;
}
