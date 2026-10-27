# PT-depiler upstream baseline

The Manifest V3 application framework under `app/` is derived from
[pt-plugins/PT-depiler](https://github.com/pt-plugins/PT-depiler) at commit
`15f9c4db00b673ff825d4969f1a05f7b54e95ea9` (2026-08-23).

The first controlled site-definition sync against this baseline adds only the
new static definitions `fhpt.ts` and `yzyy.ts`. Existing definitions are not
overwritten: PTPP carries local sign-in declarations, download-target fixes,
dead-site state and migration compatibility that must be reviewed field by
field before an upstream change is adopted.

See `docs/PTD_SITE_SYNC_15f9c4d.md` for the inventory and the explicit
non-overwrite boundary for this sync.

PT-depiler is distributed under the MIT License. The imported source keeps its
original history reference here so later upstream synchronization and license
attribution remain explicit. Product-specific behavior, migration code, and
the per-site downloader/directory mapping are maintained in this repository.
