{
  description = "AED Hub (HackNation 2026, Misja AED) dev environment";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  };

  outputs =
    { self, nixpkgs }:
    let
      supportedSystems = [
        "x86_64-linux"
        "aarch64-linux"
        "x86_64-darwin"
        "aarch64-darwin"
      ];
      forAllSystems = nixpkgs.lib.genAttrs supportedSystems;
      nixpkgsFor = forAllSystems (system: import nixpkgs { inherit system; });
    in
    {
      devShells = forAllSystems (
        system:
        let
          pkgs = nixpkgsFor.${system};
        in
        {
          default = pkgs.mkShell {
            packages = with pkgs; [
              nodejs_24
              pnpm
              jq
              # xmllint: validates the dane.gov.pl harvester feed against the portal's XSD.
              libxml2
              # mailpit: local SMTP server with a web inbox for the passport emails (pnpm dev:mail).
              mailpit
            ];

            shellHook = ''
              export PATH="$PWD/node_modules/.bin:$PATH"
            '';
          };
        }
      );
    };
}
