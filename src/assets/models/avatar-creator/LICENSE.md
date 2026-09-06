# Avatar creator assets

Business avatar templates assembled from MakeHuman assets, obtained 2026-09-05.
The former Quaternius fantasy prototype is superseded and is not included in
these templates. No Avaturn, RPM, Mozilla Hackweek or M3 assets are included.

## Sources and authors

- MakeHuman Team: base human, Mixamo-compatible rig, skin, shoes01, low-poly eyes,
  eyebrow001, short01, short02, bob01, ponytail01, afro01. CC0 1.0.
  https://static.makehumancommunity.org/assets/assetpacks/makehuman_system_assets.html
- Margaret Toigo (MRT): male suit tie and jacket, male double-breasted suit,
  fisherman sweater, basic tucked T-shirt, wool pants. CC0 1.0.
  https://static.makehumancommunity.org/assets/assetpacks/suits01.html
  https://static.makehumancommunity.org/assets/assetpacks/shirts01.html
  https://static.makehumancommunity.org/assets/assetpacks/pants01.html
- Namuhekam: male polo shirt. CC0 1.0.
  https://static.makehumancommunity.org/assets/assetpacks/shirts01.html
- Mindfront: male trousers 1 and 2. CC BY 4.0 (embedded source MHCLO headers).
- punkduck: male classic jeans. CC BY 4.0 (embedded source MHCLO header).
  https://static.makehumancommunity.org/assets/assetpacks/pants02.html

License links:
https://creativecommons.org/publicdomain/zero/1.0/
https://creativecommons.org/licenses/by/4.0/
Retain the attribution and modification notice for CC-BY assets when distributing
avatars. The creator displays credits and retains them in glTF asset metadata.

## Modifications and build status

Fitted to two bodies, rigged, jackets separated from trousers, sweater clearance
and T-shirt hem adjusted, textures reduced to 512/1024 px, body occlusion prepared
per outfit combination, material transparency normalized, converted to GLB.
Five tops, five trousers, five hairstyles plus bald; independent selections.
Only selected resources are retained in each saved avatar.

MPFB v2.0.17 is an offline GPL build tool; its asset/output license is CC0, not
the code license. The application does not include MPFB Python code at runtime.
Portable assembly: scripts/build-business-avatar-assets.py (usage in its header).
Supply the pinned MPFB source directory, the extracted official asset packs and
a private output directory. Run once for each body (`--female` for the second).
Then use scripts/normalize-business-avatar.mjs to produce the checked-in GLBs.
The portable build was verified against its normalized output. Current templates
include the final lower-torso sweater clearance adjustment:
- Male SHA256 4b36b089b9dc5e6444f1a4d9e8e42d2aeef0440d9ee35e403fc3683b68c410d5
- Female SHA256 8bc11c691afdd8690c9bf6d490ac0873eec0708eec476b24fd37d7a87e8860f6
Do not use the superseded Quaternius build-avatar-creator-assets.py to rebuild
these MakeHuman templates.
