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
   `custom_components/ogg/manifest.json` (currently `0.1.2`).

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
