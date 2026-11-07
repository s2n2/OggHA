# Publishing OggHA

The repository root must contain `hacs.json`, `README.md` and the single
`custom_components/ogg` integration directory. Keep tests and examples outside
that directory. Do not upload compiled caches, local Home Assistant storage or
personal server addresses.

## First publication

1. Put this repository content on the default branch of
   [s2n2/OggHA](https://github.com/s2n2/OggHA), preserving the existing licence.
2. Set the repository description to **Discreet local device control for Home Assistant**.
3. Add topics such as `home-assistant`, `hacs`, `custom-component` and `ogg`.
4. Ensure issues are enabled and the repository is public. HACS custom
   repositories require a public GitHub repository.
5. Run the **Validate Ogg** workflow and review every job.
6. Create a GitHub release whose version matches
   `custom_components/ogg/manifest.json` (currently `0.1.12`).

HACS can install directly from the default branch before a release exists. A
release gives users a clearer update version. This is separate from submitting
Ogg for inclusion in HACS's default catalogue.

## Updates

Change the manifest and project versions together, describe changes in the
changelog, run tests, then publish the matching release. HACS replaces the
integration directory on update. Ogg's settings are stored using Home Assistant
storage rather than files inside the integration directory.

## Sources

- [HACS integration repository requirements](https://www.hacs.dev/docs/publish/integration/)
- [HACS general publishing requirements](https://hacs.dev/docs/publish/start/)
- [Adding a custom repository](https://hacs.dev/docs/faq/custom_repositories/)
- [HACS validation action](https://hacs.xyz/docs/publish/action/)
- [Home Assistant hassfest action](https://github.com/home-assistant/actions)

## Bundled Lovelace card

The dashboard JavaScript must be stored in
`custom_components/ogg/frontend/ogg-control-deck-card.js` because HACS only
installs `custom_components/ogg` for an Integration repository.

`async_setup` registers a static HTTP file route and, for storage-mode Lovelace
resources, one versioned JavaScript module. Release changes should increment
`CARD_VERSION` in `custom_components/ogg/dashboard_resource.py` to match the
manifest so browser caches are invalidated. Do not add a separate HACS
Dashboard repository for this bundled resource.

Do not alter existing user resource entries except an exact match for the
Ogg-managed route. YAML-managed resources require a manual configuration.
