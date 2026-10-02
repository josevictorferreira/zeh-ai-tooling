# RTK (Rust Token Killer): CLI proxy that rewrites commands to cut LLM token use.
{ lib
, rustPlatform
, fetchFromGitHub
, pkg-config
, cmake
, openssl
}:
rustPlatform.buildRustPackage {
  pname = "rtk";
  version = "0.37.2";

  src = fetchFromGitHub {
    owner = "rtk-ai";
    repo = "rtk";
    rev = "v0.37.2";
    hash = "sha256-rNuu8B5TnKZHrbVSV8HkcTeTdcol26259GGJEPEMPZY=";
  };

  cargoHash = "sha256-61+PNuVF8H5+9PHc3MBt8V80ieBBi8HzSC9Gc/WUSzM=";

  nativeBuildInputs = [
    pkg-config
    cmake
  ];

  buildInputs = [ openssl ];

  meta = {
    description = "Rust Token Killer - CLI proxy that reduces LLM token consumption 60-90%";
    homepage = "https://github.com/rtk-ai/rtk";
    license = lib.licenses.mit;
    mainProgram = "rtk";
  };

  doCheck = false;
}
